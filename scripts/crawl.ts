/**
 * Crawl KOC data from Kalodata into MongoDB (resumable).
 *
 *   npm run crawl                       # new run with defaults (sunscreen, VN)
 *   npm run crawl -- --pages 2 --top 40
 *   npm run crawl -- --resume <runId>   # continue an interrupted run
 *
 * Stages: creators (rank) → detail (all + skincare scope) → products → videos
 */
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C, ensureIndexes } from "../src/lib/db/collections";
import { KalodataClient, VN_DEFAULTS } from "../src/lib/kalodata/client";
import { Checkpoint } from "../src/lib/crawl/checkpoint";
import { runPool } from "../src/lib/crawl/pool";
import {
  toNumber,
  type CreatorDetail,
  type CreatorRankRow,
  type ProductRankRow,
  type VideoRankRow,
} from "../src/lib/kalodata/types";

// Category IDs (VN) found via `npm run probe` — docs/03-kalodata.md
const CATEGORY = { beauty: "601450", skincare: "848776", sunscreenFace: "601602" };

interface CrawlConfig {
  category_id: string;
  date_range: string;
  creator_type: "INDEPENDENT" | "BELONGED_TO_SELLER" | null; // INDEPENDENT drops brand-owned store accounts
  followers_range: string | null; // e.g. "10000-1000000" — budget fit (30M VND / 5 KOC)
  pages: number; // creator/rank pages × 100 rows
  top: number; // how many creators get detail/products/videos
  products_per_creator: number;
  videos_per_creator: number;
  concurrency: number;
}

const { values: args } = parseArgs({
  options: {
    resume: { type: "string" },
    pages: { type: "string", default: "1" },
    top: { type: "string", default: "30" },
    category: { type: "string", default: CATEGORY.sunscreenFace },
    followers: { type: "string", default: "10000-1000000" },
    "include-shops": { type: "boolean", default: false },
  },
});

const db = await getDb();
await ensureIndexes(db);

const runs = db.collection<{ _id: string; config: CrawlConfig; status: string; started_at: Date; finished_at?: Date }>(
  C.crawlRuns,
);

let runId: string;
let config: CrawlConfig;
if (args.resume) {
  const run = await runs.findOne({ _id: args.resume });
  if (!run) throw new Error(`run ${args.resume} not found`);
  runId = run._id;
  config = run.config;
  await runs.updateOne({ _id: runId }, { $set: { status: "running" } });
  console.log(`▶ resuming run ${runId}`);
} else {
  runId = randomUUID();
  config = {
    category_id: args.category!,
    date_range: "last30Day",
    creator_type: args["include-shops"] ? null : "INDEPENDENT",
    followers_range: args.followers || null,
    pages: Number(args.pages),
    top: Number(args.top),
    products_per_creator: 50,
    videos_per_creator: 30,
    concurrency: 5,
  };
  await runs.insertOne({ _id: runId, config, status: "running", started_at: new Date() });
  console.log(`▶ new run ${runId}`, config);
}

const kalo = new KalodataClient(db, runId);
const started = Date.now();
const balanceBefore = await kalo.creditBalance();
const base = { ...VN_DEFAULTS, date_range: config.date_range };
const now = () => new Date();

// ── Stage 1: candidate creators ranked by revenue in the target category ────────
const s1 = new Checkpoint(db, runId, "creators");
await s1.register(Array.from({ length: config.pages }, (_, i) => `page-${i + 1}`));
for (const pageId of await s1.todo()) {
  await s1.run(pageId, async () => {
    const page = Number(pageId.split("-")[1]);
    const rows = await kalo.post<CreatorRankRow[]>("/openapi/v1/tiktok/creator/rank", {
      ...base,
      sort_field: { field: "revenue", type: "DESC" },
      category_id_list: config.category_id,
      creator_type: config.creator_type ?? undefined,
      followers_range: config.followers_range ?? undefined,
      page_size: 100,
      page_number: page,
      need_category: 1,
      need_ter_category: 1,
    });
    await upsertCreatorsFromRank(db, rows, config, page);
    // Candidates are tracked per run so different filters/runs never mix
    await runs.updateOne(
      { _id: runId },
      {
        $push: {
          candidates: {
            $each: rows.map((r, i) => ({ creator_id: r.creator_id, rank: (page - 1) * 100 + i + 1, revenue: r.revenue })),
          },
        } as never,
      },
    );
  });
}
console.log("creators:", await s1.summary());

// ── Pick the top N for deeper crawling ─────────────────────────────────────────
const runDoc = (await runs.findOne({ _id: runId })) as { candidates?: { creator_id: string; rank: number }[] } | null;
const topIds = [...new Map((runDoc?.candidates ?? []).map((c) => [c.creator_id, c])).values()]
  .sort((a, b) => a.rank - b.rank)
  .slice(0, config.top)
  .map((c) => c.creator_id);
console.log(`candidates: ${runDoc?.candidates?.length ?? 0} → deep crawl top ${topIds.length}`);

// ── Stage 2: creator detail (all categories + skincare scope) ──────────────────
const s2 = new Checkpoint(db, runId, "detail");
await s2.register(topIds);
await runPool(await s2.todo(), config.concurrency, (id) =>
  s2.run(id, async () => {
    const all = await kalo.post<CreatorDetail>("/openapi/v1/tiktok/creator/detail", {
      ...base,
      creator_id: id,
      need_extra: true,
    });
    const skincare = await kalo.post<CreatorDetail>("/openapi/v1/tiktok/creator/detail", {
      ...base,
      creator_id: id,
      category_ids: [CATEGORY.skincare],
      need_extra: true,
    });
    await saveCreatorDetail(db, all, "all", config.date_range);
    await saveCreatorDetail(db, skincare, CATEGORY.skincare, config.date_range);
  }),
);
console.log("detail:", await s2.summary());

// ── Stage 3: products each creator sold ────────────────────────────────────────
const s3 = new Checkpoint(db, runId, "products");
await s3.register(topIds);
await runPool(await s3.todo(), config.concurrency, (id) =>
  s3.run(id, async () => {
    const rows = await kalo.post<ProductRankRow[]>("/openapi/v1/tiktok/product/rank", {
      ...base,
      sort_field: { field: "revenue", type: "DESC" },
      creator_id: id,
      page_size: config.products_per_creator,
      page_number: 1,
      need_extra: true,
    });
    await saveCreatorProducts(db, id, rows, config.date_range);
  }),
);
console.log("products:", await s3.summary());

// ── Stage 4: creator videos ────────────────────────────────────────────────────
const s4 = new Checkpoint(db, runId, "videos");
await s4.register(topIds);
await runPool(await s4.todo(), config.concurrency, (id) =>
  s4.run(id, async () => {
    const rows = await kalo.post<VideoRankRow[]>("/openapi/v1/tiktok/video/rank", {
      ...base,
      sort_field: { field: "views", type: "DESC" },
      creator_id: id,
      page_size: config.videos_per_creator,
      page_number: 1,
    });
    await saveVideos(db, id, rows, config.date_range);
  }),
);
console.log("videos:", await s4.summary());

// ── Summary ────────────────────────────────────────────────────────────────────
const balanceAfter = await kalo.creditBalance();
const usage = await db
  .collection(C.apiCalls)
  .aggregate<{ _id: null; calls: number; cache_hits: number; credit: number; errors: number }>([
    { $match: { run_id: runId } },
    {
      $group: {
        _id: null,
        calls: { $sum: 1 },
        cache_hits: { $sum: { $cond: ["$cache_hit", 1, 0] } },
        credit: { $sum: "$credit" },
        errors: { $sum: { $cond: [{ $eq: ["$status", "error"] }, 1, 0] } },
      },
    },
  ])
  .next();
const failed = await db.collection(C.stageItems).countDocuments({ run_id: runId, status: "failed" });
await runs.updateOne(
  { _id: runId },
  { $set: { status: failed ? "partial" : "done", finished_at: now(), usage, balance: { before: balanceBefore, after: balanceAfter } } },
);
console.log(
  `✔ run ${runId} ${failed ? `(${failed} failed items — rerun with --resume ${runId})` : "done"}\n` +
    `  time ${((Date.now() - started) / 1000).toFixed(1)}s · calls ${usage?.calls ?? 0} (cache ${usage?.cache_hits ?? 0}, errors ${usage?.errors ?? 0})\n` +
    `  credit est ${usage?.credit.toFixed(2)} · balance ${balanceBefore.totalRemain} → ${balanceAfter.totalRemain}`,
);
await closeDb();

// ── Persistence helpers ────────────────────────────────────────────────────────

async function upsertCreatorsFromRank(db: Db, rows: CreatorRankRow[], cfg: CrawlConfig, page: number) {
  if (!rows.length) return;
  await db.collection(C.creators).bulkWrite(
    rows.map((r) => ({
      updateOne: {
        filter: { _id: r.creator_id as never },
        update: {
          $set: {
            handle: r.creator_handle,
            nickname: r.creator_nickname,
            followers: toNumber(r.creator_followers),
            top_categories: r.category_list ?? [],
            top_ter_categories: r.ter_category_list ?? [],
            updated_at: now(),
          },
        },
        upsert: true,
      },
    })),
  );
  await db.collection(C.creatorMetrics).bulkWrite(
    rows.map((r, i) => ({
      updateOne: {
        filter: { creator_id: r.creator_id, date_range: cfg.date_range, category_scope: cfg.category_id },
        update: {
          $set: {
            source: "creator/rank",
            rank: (page - 1) * 100 + i + 1,
            revenue: r.revenue,
            revenue_growth_rate: r.revenue_growth_rate,
            sales_volume: r.sales_volumn,
            video_revenue: r.video_revenue,
            live_revenue: r.live_revenue,
            content_views: toNumber(r.content_views),
            updated_at: now(),
          },
        },
        upsert: true,
      },
    })),
  );
}

async function saveCreatorDetail(db: Db, d: CreatorDetail, scope: string, dateRange: string) {
  const {
    creator_id,
    creator_handle,
    creator_nickname,
    creator_region,
    creator_status,
    creator_bio,
    creator_followers,
    sales_volumn,
    ...rest
  } = d;
  // Contact & shop fields belong on the creator doc, not on time-ranged metrics
  const metrics = Object.fromEntries(
    Object.entries(rest).filter(([k]) => !k.startsWith("creator_contact_") && k !== "creator_belonged_shop_id"),
  );
  if (scope === "all") {
    await db.collection(C.creators).updateOne(
      { _id: creator_id as never },
      {
        $set: {
          handle: creator_handle,
          nickname: creator_nickname,
          region: creator_region,
          status: creator_status,
          belonged_shop_id: d.creator_belonged_shop_id || null,
          bio: creator_bio ?? null,
          followers: toNumber(creator_followers),
          contact: {
            email: d.creator_contact_email ?? null,
            tiktok: d.creator_contact_tiktok ?? null,
            zalo: d.creator_contact_zalo ?? null,
            instagram: d.creator_contact_ins ?? null,
            facebook: d.creator_contact_facebook ?? null,
            whatsapp: d.creator_contact_whatsapp ?? null,
          },
          detail_updated_at: now(),
        },
      },
      { upsert: true },
    );
  }
  await db.collection(C.creatorMetrics).updateOne(
    { creator_id, date_range: dateRange, category_scope: scope },
    { $set: { source: "creator/detail", ...metrics, sales_volume: sales_volumn, updated_at: now() } },
    { upsert: true },
  );
}

async function saveCreatorProducts(db: Db, creatorId: string, rows: ProductRankRow[], dateRange: string) {
  if (!rows.length) return;
  await db.collection(C.products).bulkWrite(
    rows.map((p) => ({
      updateOne: {
        filter: { _id: p.product_id as never },
        update: {
          $set: {
            name: p.product_name,
            seller_id: p.seller_id,
            seller_name: p.seller_name,
            unit_price: p.unit_price,
            commission_rate: p.commission_rate,
            launch_date: p.launch_date,
            category_l1: p.pri_category ?? null,
            category_l2: p.sec_category ?? null,
            category_l3: p.ter_category ?? null,
            updated_at: now(),
          },
        },
        upsert: true,
      },
    })),
  );
  await db.collection(C.creatorProducts).bulkWrite(
    rows.map((p) => ({
      updateOne: {
        filter: { creator_id: creatorId, product_id: p.product_id, date_range: dateRange },
        update: {
          $set: {
            revenue: p.revenue,
            sales_volume: p.sales_volumn,
            video_revenue: p.video_revenue,
            live_revenue: p.live_revenue,
            showcase_revenue: p.showcase_revenue,
            unit_price: p.unit_price,
            category_l3_id: p.ter_category?.category_id ?? null,
            updated_at: now(),
          },
        },
        upsert: true,
      },
    })),
  );
}

async function saveVideos(db: Db, creatorId: string, rows: VideoRankRow[], dateRange: string) {
  if (!rows.length) return;
  await db.collection(C.videos).bulkWrite(
    rows.map((v) => ({
      updateOne: {
        filter: { _id: v.video_id as never },
        update: {
          $set: {
            creator_id: creatorId,
            title: v.video_title,
            publish_date: v.publish_date,
            date_range: dateRange,
            views: v.views,
            likes: v.digg_count,
            comments: v.comment_count,
            shares: v.share_count,
            revenue: v.revenue,
            revenue_growth_rate: v.revenue_growth_rate,
            ads_roas: v.ads_roas,
            ad_revenue_ratio: v.ad_revenue_ratio,
            ad_view_ratio: v.ad_view_ratio,
            is_ad: v.ad === 1,
            is_ai_video: v.ai_video === 1,
            updated_at: now(),
          },
        },
        upsert: true,
      },
    })),
  );
}
