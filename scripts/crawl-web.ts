/**
 * Crawl KOC data from the Kalodata web app (logged-in session) into MongoDB. Resumable.
 *
 *   npm run kalo:login                       # once, or when the session expires
 *   npm run crawl:web                        # new run: sunscreen, female-majority, 18-24 & 25-34
 *   npm run crawl:web -- --pages 2 --top 30
 *   npm run crawl:web -- --resume <runId>
 *
 * Stages: list (filtered by audience) → detail (audience, MCN, contacts) → totals → products → videos
 * Web plan quota: DETAIL.ACCESS_TIMES ≈ 1999 creator detail views / day.
 */
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C, ensureIndexes } from "../src/lib/db/collections";
import { KalodataWebClient } from "../src/lib/kalodata/web-client";
import { Checkpoint } from "../src/lib/crawl/checkpoint";
import { parseDurationSec, parseVnNumber as n } from "../src/lib/kalodata/parse";

const CATEGORY = { skincare: "848776", makeup: "848648", sunscreenFace: "601602" };
const PAGE_SIZE = 50; // web list rejects pageSize 100

interface WebCrawlConfig {
  category_ids: string[];
  category_id: string; // scope key stored on metrics = category_ids joined by ","
  pages_by_age?: Record<string, number>;
  start_date: string;
  end_date: string;
  follower_gender: string; // "2" = Majority Female (50%+)
  follower_ages: string[]; // majority age group, e.g. ["18-24", "25-34"]
  creator_type: string; // INDEPENDENT drops brand-operated accounts
  followers: string; // follower count range
  page_size: number;
  pages: number; // per age group
  top: number;
  products_per_creator: number;
  videos_per_creator: number;
  mode?: "discover" | "fill"; // fill = never add creators, only complete existing ones
}

const { values: args } = parseArgs({
  options: {
    resume: { type: "string" },
    until: { type: "string" }, // ISO datetime: stop cleanly (resumable) at this time
    "fill-missing": { type: "boolean", default: false }, // no list crawl: only complete creators already in the DB
    "extend-top": { type: "string" }, // on resume: raise how many creators get the deep crawl
    pages: { type: "string", default: "1" }, // number per age group, or "all"
    top: { type: "string", default: "30" },
    categories: { type: "string", default: CATEGORY.sunscreenFace }, // comma-separated
    ages: { type: "string", default: "18-24,25-34" },
    followers: { type: "string", default: "10000-1000000" }, // "" = no follower filter
  },
});

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const db = await getDb();
await ensureIndexes(db);
const runs = db.collection<{ _id: string; source: string; config: WebCrawlConfig; status: string; started_at: Date }>(
  C.crawlRuns,
);

let runId: string;
let config: WebCrawlConfig;
if (args.resume) {
  const run = await runs.findOne({ _id: args.resume });
  if (!run) throw new Error(`run ${args.resume} not found`);
  ({ _id: runId, config } = run);
  config.category_ids ??= config.category_id.split(","); // runs created before multi-category support
  if (args["extend-top"]) {
    config.top = Number(args["extend-top"]);
    await runs.updateOne({ _id: run._id }, { $set: { "config.top": config.top } });
  }
  await runs.updateOne({ _id: runId }, { $set: { status: "running" } });
  console.log(`▶ resuming web run ${runId}`);
} else {
  const end = new Date(Date.now() - 86_400_000); // Kalodata data lags one day
  const start = new Date(end.getTime() - 29 * 86_400_000);
  runId = randomUUID();
  const categoryIds = args.categories!.split(",").map((s) => s.trim());
  config = {
    category_ids: categoryIds,
    category_id: categoryIds.join(","),
    start_date: ymd(start),
    end_date: ymd(end),
    follower_gender: "2",
    follower_ages: args.ages!.split(","),
    creator_type: "INDEPENDENT",
    followers: args.followers === "none" ? "" : args.followers!, // "none" = no follower filter (empty args get dropped by shells)
    page_size: PAGE_SIZE,
    pages: args.pages === "all" ? -1 : Number(args.pages),
    top: Number(args.top),
    products_per_creator: 50,
    videos_per_creator: 30,
    mode: args["fill-missing"] ? "fill" : "discover",
  };
  if (config.mode === "fill") {
    // Same 30-day window as the stored list data, so metrics stay comparable
    const ref = await runs.findOne({ source: "kalodata_web", "config.category_id": config.category_id, "config.mode": { $ne: "fill" } }, { sort: { started_at: -1 } });
    if (ref) Object.assign(config, { start_date: ref.config.start_date, end_date: ref.config.end_date });
  }
  await runs.insertOne({ _id: runId, source: "kalodata_web", config, status: "running", started_at: new Date() });
  console.log(`▶ new web run ${runId}`, config);
}

const web = new KalodataWebClient(db, runId);
await web.open();
const started = Date.now();
const dateRange = `${config.start_date}~${config.end_date}`;
const range = { startDate: config.start_date, endDate: config.end_date };
const now = () => new Date();

const listFilter = (age: string) => ({
  country: "VN",
  ...range,
  cateIds: config.category_ids,
  showCateIds: config.category_ids,
  sort: [{ field: "revenue", type: "DESC" }],
  "creator.filter.follower_gender": config.follower_gender,
  "creator.filter.follower_age": age,
  "creator.filter.creator_type": config.creator_type,
  ...(config.followers ? { "creator.filter.followers": config.followers } : {}),
});

try {
  let topIds: string[];
  if (config.mode === "fill") {
    // ── Fill mode: no list crawl, never adds creators. Complete the saved top list only. ──
    const top = await db.collection<{ _id: string; ranking: { id: string }[] }>("top_kocs").findOne({ _id: `top${config.top}` });
    if (!top) throw new Error(`top_kocs/top${config.top} not found — run \`npm run top-kocs -- --n ${config.top} --apply\` first`);
    const runDoc = (await runs.findOne({ _id: runId })) as { deep_crawl_ids?: string[] } | null;
    if (runDoc?.deep_crawl_ids?.length) {
      topIds = runDoc.deep_crawl_ids;
    } else {
      const detailed = new Set(
        (await db.collection(C.creators).find({ detail_updated_at: { $exists: true } }, { projection: { _id: 1 } }).toArray()).map((c) => String(c._id)),
      );
      topIds = top.ranking.map((r) => r.id).filter((id) => !detailed.has(id));
      await runs.updateOne({ _id: runId }, { $set: { deep_crawl_ids: topIds, candidates_unique: top.ranking.length } });
    }
    console.log(`fill mode: ${topIds.length} creators in top${config.top} still missing detail`);
  } else {
  // ── Stage 1: list, filtered by audience gender/age at the source ────────────
  if (!config.pages_by_age) {
    const pagesByAge: Record<string, number> = {};
    for (const age of config.follower_ages) {
      const total = await web.post<number>("/creator/count", { ...listFilter(age), pageNo: 1, pageSize: PAGE_SIZE });
      pagesByAge[age] = config.pages === -1 ? Math.ceil(total / PAGE_SIZE) : Math.min(config.pages, Math.ceil(total / PAGE_SIZE));
      console.log(`age ${age}: ${total} creators → ${pagesByAge[age]} pages`);
    }
    config.pages_by_age = pagesByAge;
    await runs.updateOne({ _id: runId }, { $set: { "config.pages_by_age": pagesByAge } });
  }
  const s1 = new Checkpoint(db, runId, "web:list");
  await s1.register(
    Object.entries(config.pages_by_age).flatMap(([age, pages]) => Array.from({ length: pages }, (_, i) => `${age}|${i + 1}`)),
  );
  const listTodo = await s1.todo();
  let listDone = 0;
  for (const item of listTodo) {
    await s1.run(item, async () => {
      const [age, page] = item.split("|");
      const rows = await web.post<Record<string, unknown>[]>("/creator/queryList", {
        ...listFilter(age),
        pageNo: Number(page),
        pageSize: config.page_size,
      });
      await saveListRows(db, rows, age, Number(page));
    });
    if (++listDone % 25 === 0) console.log(`  list ${listDone}/${listTodo.length}`);
  }
  console.log("list:", await s1.summary());

  topIds = await pickTop(db, config.top);
  console.log(`deep crawl top ${topIds.length}`);
  }

  // ── Stage 2: one complete KOC at a time, best-scored first ──────────────────
  // detail (audience, MCN, contacts) → totals + daily history → products → videos  (6 requests)
  // Each finished KOC is fully usable even if the run pauses on the daily cap.
  const s2 = new Checkpoint(db, runId, "web:koc");
  await s2.register(topIds);
  const todo = new Set(await s2.todo());
  let n = 0;
  const deadline = args.until ? new Date(args.until).getTime() : Infinity;
  for (const id of topIds.filter((x) => todo.has(x))) {
    if (Date.now() >= deadline) {
      console.log(`⏸ deadline ${args.until} reached — stopping; resume later with --resume ${runId}`);
      break;
    }
    await s2.run(id, async () => {
      const body = { id, cateIds: [], ...range, sellerId: "", authority: true };
      await web.post("/creator/detail/access", body, 24 * 7);
      const d = await web.post<Record<string, string | number | string[]>>("/creator/detail", body, 24 * 7);
      await saveDetail(db, id, d);

      const total = await web.post<Record<string, string>>("/creator/detail/total", body);
      const history = await web.post<Record<string, number | string>[]>("/creator/detail/history/total", body);
      await saveTotals(db, id, "all", total, history);

      const products = await web.post<Record<string, string>[]>("/creator/detail/searchProducts", {
        ...body, pageNo: 1, pageSize: config.products_per_creator, sort: [{ field: "revenue", type: "DESC" }],
      });
      await saveProducts(db, id, products);

      const videos = await web.post<Record<string, unknown>[]>("/creator/detail/video/queryList", {
        ...body, pageNo: 1, pageSize: config.videos_per_creator, sort: [{ field: "revenue", type: "DESC" }], videoType: "",
      });
      await saveVideos(db, id, videos);
    });
    if (++n % 10 === 0) console.log(`  koc ${n}/${todo.size}`, await s2.summary());
  }
  console.log("koc:", await s2.summary());
} catch (err) {
  const kind = (err as { kind?: string }).kind;
  await runs.updateOne({ _id: runId }, { $set: { status: kind === "locked" ? "locked" : "partial", halted_reason: String(err), finished_at: now() } });
  console.error(`✖ run ${runId} stopped: ${err instanceof Error ? err.message : err}`);
  await web.close();
  await closeDb();
  process.exit(kind === "locked" ? 3 : 1); // 3 = account warning/lock → the daemon must NOT retry
} finally {
  await web.close();
}

const failed = await db.collection(C.stageItems).countDocuments({ run_id: runId, status: "failed" });
const calls = await db.collection(C.apiCalls).countDocuments({ run_id: runId, cache_hit: false });
await runs.updateOne({ _id: runId }, { $set: { status: failed ? "partial" : "done", finished_at: now() } });
console.log(
  `✔ web run ${runId} ${failed ? `(${failed} failed — rerun with --resume ${runId})` : "done"} · ` +
    `${calls} network calls · ${((Date.now() - started) / 1000).toFixed(0)}s`,
);
await closeDb();

/**
 * Choose which creators get the expensive deep crawl: percentile blend of category revenue (0.5),
 * video engagement rate (0.3) and views (0.2) across this run's list. Pure code, no AI.
 * Blending keeps smaller, highly engaged creators (budget-friendly) in the pool, not only the biggest sellers.
 */
async function pickTop(db: Db, top: number): Promise<string[]> {
  const runDoc = (await runs.findOne({ _id: runId })) as {
    candidates?: { creator_id: string }[];
    deep_crawl_ids?: string[];
  } | null;
  // Stable selection across resumes; only recompute when the run is extended to more creators
  if (runDoc?.deep_crawl_ids && runDoc.deep_crawl_ids.length >= Math.min(top, new Set(runDoc.candidates?.map((c) => c.creator_id)).size))
    return runDoc.deep_crawl_ids.slice(0, top);
  const ids = [...new Set((runDoc?.candidates ?? []).map((c) => c.creator_id))];
  const metrics = await db
    .collection(C.creatorMetrics)
    .find({ creator_id: { $in: ids }, date_range: dateRange, category_scope: config.category_id })
    .project<{ creator_id: string; revenue: number | null; video_engagement_rate: number | null; views: number | null }>({
      creator_id: 1, revenue: 1, video_engagement_rate: 1, views: 1,
    })
    .toArray();
  const pct = (key: "revenue" | "video_engagement_rate" | "views") => {
    const sorted = metrics.map((m) => m[key] ?? 0).sort((a, b) => a - b);
    return (v: number | null) => {
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < (v ?? 0)) lo = mid + 1; else hi = mid; }
      return sorted.length ? lo / sorted.length : 0;
    };
  };
  const [pRev, pEng, pViews] = [pct("revenue"), pct("video_engagement_rate"), pct("views")];
  const scored = metrics.map((m) => ({
    id: m.creator_id,
    s: 0.5 * pRev(m.revenue) + 0.3 * pEng(m.video_engagement_rate) + 0.2 * pViews(m.views),
  }));
  scored.sort((a, b) => b.s - a.s);
  const picked = scored.slice(0, top).map((x) => x.id);
  await runs.updateOne({ _id: runId }, { $set: { deep_crawl_ids: picked, candidates_unique: ids.length } });
  return picked;
}

// ── Persistence ──────────────────────────────────────────────────────────────

async function saveListRows(db: Db, rows: Record<string, unknown>[], age: string, page: number) {
  if (!rows.length) return;
  await db.collection(C.creators).bulkWrite(
    rows.map((r) => ({
      updateOne: {
        filter: { _id: String(r.id) as never },
        update: {
          $set: {
            handle: `@${r.handle}`,
            nickname: r.nickname,
            bio: r.signature ?? null,
            followers: n(r.followers),
            debut_date: r.creatorDebut ?? null,
            // From the list filter: Kalodata places this creator in a female-majority, `age`-majority bucket
            "audience.gender_majority": "female",
            "audience.source": "kalodata_web",
            updated_at: now(),
          },
          $addToSet: { "audience.age_buckets_matched": age },
        },
        upsert: true,
      },
    })),
  );
  await db.collection(C.creatorMetrics).bulkWrite(
    rows.map((r) => ({
      updateOne: {
        filter: { creator_id: String(r.id), date_range: dateRange, category_scope: config.category_id },
        update: {
          $set: {
            source: "web:creator/queryList",
            revenue: n(r.revenue),
            sales_volume: n(r.sale),
            unit_price: n(r.unit_price),
            views: n(r.views),
            new_followers: n(r.new_followers),
            video_engagement_rate: n(r.video_engagement_rate),
            revenue_growth_rate: r.revenue_grouping_rate ?? null,
            revenue_trend: r.revenue_trend ?? [],
            views_trend: r.views_trend ?? [],
            updated_at: now(),
          },
        },
        upsert: true,
      },
    })),
  );
  await runs.updateOne(
    { _id: runId },
    {
      $push: {
        candidates: { $each: rows.map((r, i) => ({ creator_id: String(r.id), age, page, pos: i, revenue: n(r.revenue) ?? 0 })) },
      } as never,
    },
  );
}

async function saveDetail(db: Db, id: string, d: Record<string, string | number | string[]>) {
  const gender = d.followerSex === "Majority Female" ? "female" : d.followerSex === "Majority Male" ? "male" : null;
  await db.collection(C.creators).updateOne(
    { _id: id as never },
    {
      $set: {
        handle: `@${d.handle}`,
        nickname: d.nickname,
        bio: d.signature ?? null,
        status: d.creator_type,
        region: d.region,
        followers_display: d.follower_count,
        product_count: n(d.product_count),
        debut_date: d.creatorDebut ?? null,
        mcn: d.has_mcn ? String(d.mcn_name ?? "") : null,
        shop_name: d.shop_name || null,
        main_categories: d.main_category ?? [],
        "audience.gender_majority": gender,
        "audience.age_majority": d.followerAgeMax || null,
        "audience.raw": { followerSex: d.followerSex, followerAgeMax: d.followerAgeMax },
        "audience.source": "kalodata_web",
        contact: {
          email: d.email || null,
          zalo: d.zalo || null,
          whatsapp: d.whatsapp || null,
          facebook: d.facebook || null,
          instagram: d.ins_id || null,
          line: d.line || null,
          homepage: d.personal_homepage || null,
        },
        detail_updated_at: now(),
      },
    },
    { upsert: true },
  );
}

async function saveTotals(
  db: Db,
  id: string,
  scope: string,
  t: Record<string, string>,
  history: Record<string, number | string>[],
) {
  await db.collection(C.creatorMetrics).updateOne(
    { creator_id: id, date_range: dateRange, category_scope: scope },
    {
      $set: {
        source: "web:creator/detail/total",
        revenue: n(t.revenue),
        sales_volume: n(t.sale),
        unit_price: n(t.unit_price),
        video_revenue: n(t.video_revenue),
        live_revenue: n(t.live_revenue),
        shop_revenue: n(t.shop_revenue),
        video_views: n(t.video_views),
        live_views: n(t.live_views),
        daily: history.map((h) => ({
          day: h.partition_day,
          revenue: n(h.revenue),
          sales: n(h.sale),
          video_revenue: n(h.video_revenue),
          live_revenue: n(h.live_revenue),
        })),
        updated_at: now(),
      },
    },
    { upsert: true },
  );
}

async function saveProducts(db: Db, id: string, rows: Record<string, string>[]) {
  if (!rows.length) return;
  await db.collection(C.products).bulkWrite(
    rows.map((p) => ({
      updateOne: {
        filter: { _id: String(p.id) as never },
        update: { $set: { name: p.product_title, seller_id: p.seller_id, updated_at: now() } },
        upsert: true,
      },
    })),
  );
  await db.collection(C.creatorProducts).bulkWrite(
    rows.map((p) => ({
      updateOne: {
        filter: { creator_id: id, product_id: String(p.id), date_range: dateRange },
        update: {
          $set: {
            source: "web",
            revenue: n(p.revenue),
            sales_volume: n(p.sale),
            unit_price: n(p.unit_price),
            updated_at: now(),
          },
        },
        upsert: true,
      },
    })),
  );
}

async function saveVideos(db: Db, id: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  await db.collection(C.videos).bulkWrite(
    rows.map((v) => ({
      updateOne: {
        filter: { _id: String(v.id) as never },
        update: {
          $set: {
            creator_id: id,
            title: v.description,
            publish_date: v.create_time,
            duration_sec: (v.original_duration as number) ?? parseDurationSec(v.duration),
            content_type: v.content_type,
            product_ids: v.product_ids ?? [],
            views: n(v.views),
            revenue: n(v.revenue),
            sales: n(v.sale),
            gpm: n(v.gpm),
            is_ad: v.ad === 1,
            is_ai_video: v.ai_video === 1,
            ad_view_ratio: n(v.ad_view_ratio),
            ad_revenue_ratio: n(v.ad_revenue_ratio),
            ad_cost: n(v.ad2Cost),
            ad_roas: n(v.ad2Roas),
            ad_cpa: n(v.ad_cpa),
            date_range: dateRange,
            source: "web",
            updated_at: now(),
          },
        },
        upsert: true,
      },
    })),
  );
}
