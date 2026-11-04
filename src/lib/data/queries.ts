import "server-only";
import { connection } from "next/server";
import { getDb as getMongo } from "../db/mongo";

/** Data here is live (crawl in progress) — always render at request time. */
async function getDb() {
  await connection();
  return getMongo();
}
import { C } from "../db/collections";
import type { ChatMessage } from "../chat";

// Tên ngành khai báo tập trung ở lib/industries.ts — DB có nhiều ngành, không riêng mỹ phẩm
import { CATEGORY_NAMES } from "../industries";
export { CATEGORY_NAMES };

export interface CrawlRunView {
  id: string;
  source: string;
  status: string;
  started_at: Date;
  finished_at?: Date;
  category: string;
  date_range: string;
  candidates: number;
  deep: number;
  stages: { stage: string; done: number; total: number; failed: number; running: number }[];
}

export async function listCrawlRuns(): Promise<CrawlRunView[]> {
  const db = await getDb();
  const runs = await db
    .collection(C.crawlRuns)
    .find({}, { projection: { candidates: 0 } })
    .sort({ started_at: -1 })
    .limit(20)
    .toArray();
  const ids = runs.map((r) => r._id);
  const stageRows = await db
    .collection(C.stageItems)
    .aggregate<{ _id: { run: string; stage: string; status: string }; n: number }>([
      { $match: { run_id: { $in: ids } } },
      { $group: { _id: { run: "$run_id", stage: "$stage", status: "$status" }, n: { $sum: 1 } } },
    ])
    .toArray();
  const candidateCounts = await db
    .collection(C.crawlRuns)
    .aggregate<{ _id: string; n: number }>([
      { $match: { _id: { $in: ids } } },
      { $project: { n: { $size: { $ifNull: ["$candidates", []] } } } },
    ])
    .toArray();

  return runs.map((r) => {
    const stages = new Map<string, { stage: string; done: number; total: number; failed: number; running: number }>();
    for (const s of stageRows.filter((x) => x._id.run === String(r._id))) {
      const st = stages.get(s._id.stage) ?? { stage: s._id.stage, done: 0, total: 0, failed: 0, running: 0 };
      st.total += s.n;
      if (s._id.status === "done") st.done += s.n;
      if (s._id.status === "failed") st.failed += s.n;
      if (s._id.status === "running") st.running += s.n;
      stages.set(s._id.stage, st);
    }
    const cfg = (r.config ?? {}) as Record<string, unknown>;
    return {
      id: String(r._id),
      source: (r.source as string) ?? "kalodata_api",
      status: r.status as string,
      started_at: r.started_at as Date,
      finished_at: r.finished_at as Date | undefined,
      category: CATEGORY_NAMES[String(cfg.category_id)] ?? String(cfg.category_id),
      date_range: cfg.start_date ? `${cfg.start_date} → ${cfg.end_date}` : String(cfg.date_range ?? ""),
      candidates: (r.candidates_unique as number) ?? candidateCounts.find((c) => String(c._id) === String(r._id))?.n ?? 0,
      deep: ((r.deep_crawl_ids as string[]) ?? []).length || Number(cfg.top ?? 0),
      stages: [...stages.values()],
    };
  });
}

export async function dbCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const names = [C.creators, C.creatorMetrics, C.products, C.creatorProducts, C.videos, C.rawResponses];
  const counts = await Promise.all(names.map((n) => db.collection(n).estimatedDocumentCount()));
  return Object.fromEntries(names.map((n, i) => [n, counts[i]]));
}

// ── KOC explorer ─────────────────────────────────────────────────────────────

export interface KocFilters {
  run?: string;
  q?: string;
  age?: string;
  minFollowers?: number;
  maxFollowers?: number;
  mcn?: "yes" | "no";
  deep?: "yes";
  sort?: "revenue" | "engagement" | "views" | "followers";
  page?: number;
}

export interface KocRow {
  id: string;
  handle: string;
  nickname: string;
  followers: number | null;
  age_majority: string | null;
  age_buckets: string[];
  mcn: string | null;
  revenue: number | null;
  engagement: number | null;
  views: number | null;
  unit_price: number | null;
  sales: number | null;
  new_followers: number | null;
  revenue_trend: number[];
  views_trend: number[];
  deep: boolean;
  favorite: boolean;
}

export const PAGE_SIZE = 50;

/** Latest web run that crawled the cosmetics scope (or any run if none). */
export async function defaultRun(): Promise<{ id: string; category_id: string; date_range: string } | null> {
  const db = await getDb();
  const run =
    (await db.collection(C.crawlRuns).findOne(
      { source: "kalodata_web", "config.category_id": "848776,848648" },
      { sort: { started_at: -1 }, projection: { config: 1 } },
    )) ??
    (await db.collection(C.crawlRuns).findOne({ source: "kalodata_web" }, { sort: { started_at: -1 }, projection: { config: 1 } }));
  if (!run) return null;
  const cfg = run.config as Record<string, string>;
  return { id: String(run._id), category_id: cfg.category_id, date_range: `${cfg.start_date}~${cfg.end_date}` };
}

export async function getRunScope(runId: string) {
  const db = await getDb();
  const run = await db.collection(C.crawlRuns).findOne({ _id: runId as never }, { projection: { config: 1, deep_crawl_ids: 1 } });
  if (!run) return null;
  const cfg = run.config as Record<string, string>;
  return {
    id: runId,
    category_id: cfg.category_id,
    date_range: `${cfg.start_date}~${cfg.end_date}`,
    deep_ids: (run.deep_crawl_ids as string[]) ?? [],
  };
}

export async function searchKocs(f: KocFilters): Promise<{ rows: KocRow[]; total: number; scope: Awaited<ReturnType<typeof getRunScope>> }> {
  const db = await getDb();
  const runId = f.run ?? (await defaultRun())?.id;
  const scope = runId ? await getRunScope(runId) : null;
  if (!scope) return { rows: [], total: 0, scope: null };

  const sortField = { revenue: "m.revenue", engagement: "m.video_engagement_rate", views: "m.views", followers: "followers" }[
    f.sort ?? "revenue"
  ];
  const creatorMatch: Record<string, unknown> = {};
  if (f.q) creatorMatch.$or = [{ handle: { $regex: f.q, $options: "i" } }, { nickname: { $regex: f.q, $options: "i" } }];
  if (f.age) creatorMatch["audience.age_buckets_matched"] = f.age;
  if (f.minFollowers || f.maxFollowers)
    creatorMatch.followers = { ...(f.minFollowers ? { $gte: f.minFollowers } : {}), ...(f.maxFollowers ? { $lte: f.maxFollowers } : {}) };
  if (f.mcn === "yes") creatorMatch.mcn = { $nin: [null, ""] };
  if (f.mcn === "no") creatorMatch.mcn = { $in: [null, ""] };
  if (f.deep === "yes") creatorMatch.detail_updated_at = { $exists: true };

  const pipeline = [
    { $match: { category_scope: scope.category_id, date_range: scope.date_range, source: "web:creator/queryList" } },
    { $project: { _id: 0, m: "$$ROOT" } },
    { $lookup: { from: C.creators, localField: "m.creator_id", foreignField: "_id", as: "c" } },
    { $unwind: "$c" },
    { $replaceRoot: { newRoot: { $mergeObjects: ["$c", { m: "$m" }] } } },
    ...(Object.keys(creatorMatch).length ? [{ $match: creatorMatch }] : []),
    {
      $facet: {
        total: [{ $count: "n" }],
        rows: [{ $sort: { [sortField]: -1 } }, { $skip: ((f.page ?? 1) - 1) * PAGE_SIZE }, { $limit: PAGE_SIZE }],
      },
    },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- joined Mongo docs
  type Joined = Record<string, any>;
  const [res] = await db.collection(C.creatorMetrics).aggregate<{ total: { n: number }[]; rows: Joined[] }>(pipeline).toArray();
  const deepSet = new Set(scope.deep_ids);
  const pageIds = (res?.rows ?? []).map((r) => String(r._id));
  const favSet = new Set(
    (await db.collection(C.favorites).find({ _id: { $in: pageIds as never[] } }, { projection: { _id: 1 } }).toArray()).map((f) => String(f._id)),
  );
  const rows: KocRow[] = (res?.rows ?? []).map((r) => ({
    id: String(r._id),
    handle: r.handle,
    nickname: r.nickname,
    followers: r.followers ?? null,
    age_majority: r.audience?.age_majority ?? null,
    age_buckets: r.audience?.age_buckets_matched ?? [],
    mcn: r.mcn || null,
    revenue: r.m.revenue ?? null,
    engagement: r.m.video_engagement_rate ?? null,
    views: r.m.views ?? null,
    unit_price: r.m.unit_price ?? null,
    sales: r.m.sales_volume ?? null,
    new_followers: r.m.new_followers ?? null,
    revenue_trend: r.m.revenue_trend ?? [],
    views_trend: r.m.views_trend ?? [],
    deep: deepSet.has(String(r._id)) || Boolean(r.detail_updated_at),
    favorite: favSet.has(String(r._id)),
  }));
  return { rows, total: res?.total[0]?.n ?? 0, scope };
}

// ── Tola (trợ lý) ────────────────────────────────────────────────────────────

export interface TolaThreadView {
  id: string;
  title: string;
  updated_at: Date;
}

/** Danh sách hội thoại với trợ lý, mới nhất trước — dựng thanh lịch sử bên trái. */
export async function listTolaThreads(limit = 40): Promise<TolaThreadView[]> {
  const db = await getDb();
  const rows = await db.collection(C.tolaChats).find({}, { projection: { title: 1, updated_at: 1 } }).sort({ updated_at: -1 }).limit(limit).toArray();
  return rows.map((t) => ({ id: String(t._id), title: String(t.title ?? "Hội thoại"), updated_at: (t.updated_at as Date) ?? new Date() }));
}

export interface TolaSubject {
  id: string;
  handle: string;
  name: string;
}

/** KOC mà người dùng mang từ trang hồ sơ sang `/tola?koc=<id>`; `null` khi id không tồn tại. */
export async function getTolaSubject(id: string): Promise<TolaSubject | null> {
  const db = await getDb();
  const c = await db.collection(C.creators).findOne({ _id: id as never }, { projection: { handle: 1, nickname: 1 } });
  if (!c) return null;
  const handle = String(c.handle ?? "").replace(/^@/, "");
  return { id, handle, name: String(c.nickname || handle || id) };
}

/** Một hội thoại cụ thể; `null` khi id không tồn tại. */
export async function getTolaThread(id: string): Promise<{ id: string; title: string; messages: ChatMessage[] } | null> {
  const db = await getDb();
  const t = await db.collection(C.tolaChats).findOne({ _id: id as never });
  if (!t) return null;
  return { id, title: String(t.title ?? "Hội thoại"), messages: ((t.messages as ChatMessage[]) ?? []).slice(-60) };
}

/**
 * Khối truy vấn chiến dịch (`listCampaigns`, `getCampaign`, `getShortlist`, `campaignPool`…) đã bỏ
 * cùng trang /campaigns: pipeline S2→S5 giờ chạy ngay trong lượt hỏi Tola (`lib/tola-deep.ts`) và
 * agent đọc kết quả qua công cụ `campaign_context`. Cần lại thì lấy trong git history của file này.
 */

// ── KOC detail ───────────────────────────────────────────────────────────────

/** Thông tin một sản phẩm gắn trong video. Số bán là của CHÍNH KOC này, kỳ 30 ngày mới nhất (null nếu không lọt top sản phẩm đã crawl). */
export interface VideoProductInfo {
  name: string;
  seller_id: string | null;
  seller_name: string | null;
  unit_price: number | null;
  revenue: number | null;
  sales: number | null;
}

export async function getKoc(id: string) {
  const db = await getDb();
  const creator = await db.collection(C.creators).findOne({ _id: id as never });
  if (!creator) return null;
  const metrics = await db.collection(C.creatorMetrics).find({ creator_id: id }).sort({ updated_at: -1 }).toArray();
  const products = await db
    .collection(C.creatorProducts)
    .aggregate([
      { $match: { creator_id: id } },
      { $sort: { revenue: -1 } },
      { $group: { _id: "$product_id", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
      { $sort: { revenue: -1 } },
      { $limit: 50 },
      { $lookup: { from: C.products, localField: "product_id", foreignField: "_id", as: "p" } },
      { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
    ])
    .toArray();
  const videos = await db.collection(C.videos).find({ creator_id: id }).sort({ revenue: -1, views: -1 }).limit(30).toArray();
  // Tab "Cửa hàng": chỉ khoảng ngày mới nhất (mỗi lần crawl một cửa sổ 30 ngày — gộp các kỳ sẽ cộng trùng)
  const lastShop = await db.collection(C.creatorShops).findOne({ creator_id: id }, { sort: { date_range: -1 }, projection: { date_range: 1 } });
  const shops = lastShop
    ? await db.collection(C.creatorShops).find({ creator_id: id, date_range: lastShop.date_range }).sort({ revenue: -1 }).toArray()
    : [];
  // Popup hỏi đáp dùng chung lịch sử với /tola (`tola_chats`) — hiện mọi hội thoại, không lọc theo KOC
  const threads = (await db.collection(C.tolaChats).find({}).sort({ updated_at: -1 }).limit(20).toArray()).map((t) => ({
    id: String(t._id),
    title: String(t.title ?? "Cuộc trò chuyện"),
    updated_at: (t.updated_at as Date) ?? (t.created_at as Date) ?? new Date(),
    messages: ((t.messages as ChatMessage[]) ?? []).slice(-40),
  }));
  // Sản phẩm gắn trong video → thẻ thông tin khi hover ảnh sản phẩm ở bảng video (tên, shop, giá, KOC bán được bao nhiêu)
  const vpids = [...new Set(videos.flatMap((v) => (v.product_ids as string[]) ?? []))];
  const [vprods, vsales] = await Promise.all([
    db.collection(C.products).find({ _id: { $in: vpids as never[] } }, { projection: { name: 1, seller_id: 1, seller_name: 1 } }).toArray(),
    db.collection(C.creatorProducts).find({ creator_id: id, product_id: { $in: vpids } }).sort({ date_range: -1 }).toArray(),
  ]);
  const saleOf = new Map<string, (typeof vsales)[number]>();
  for (const s of vsales) if (!saleOf.has(String(s.product_id))) saleOf.set(String(s.product_id), s); // kỳ mới nhất
  const videoProducts: Record<string, VideoProductInfo> = Object.fromEntries(
    vprods.map((p) => {
      const s = saleOf.get(String(p._id));
      return [
        String(p._id),
        {
          name: String(p.name ?? ""),
          seller_id: p.seller_id ? String(p.seller_id) : null,
          seller_name: p.seller_name ? String(p.seller_name) : null,
          unit_price: typeof s?.unit_price === "number" ? s.unit_price : null,
          revenue: typeof s?.revenue === "number" ? s.revenue : null,
          sales: typeof s?.sales_volume === "number" ? s.sales_volume : null,
        },
      ];
    }),
  );
  return { creator, metrics, products, videos, shops, threads, videoProducts };
}
