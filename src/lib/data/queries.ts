import type { S5Pick } from "../pipeline/s5-recommend";
import "server-only";
import { connection } from "next/server";
import { getDb as getMongo } from "../db/mongo";

/** Data here is live (crawl in progress) — always render at request time. */
async function getDb() {
  await connection();
  return getMongo();
}
import { C } from "../db/collections";
import { defaultPlan, type BriefPlan } from "../plan";
import type { ChatMessage } from "../chat";

export const CATEGORY_NAMES: Record<string, string> = {
  "601450": "Làm đẹp",
  "848776": "Chăm sóc da",
  "848648": "Trang điểm",
  "601602": "Kem chống nắng da mặt",
  "848776,848648": "Mỹ phẩm (Chăm sóc da + Trang điểm)",
  all: "Tất cả ngành",
};

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

/** Headline numbers for the explorer: computed from stored rows, never estimated. */
export async function kocSummary(runId?: string) {
  const db = await getDb();
  const id = runId ?? (await defaultRun())?.id;
  const scope = id ? await getRunScope(id) : null;
  if (!scope) return null;
  const [agg] = await db
    .collection(C.creatorMetrics)
    .aggregate<{ n: number; revenue: number; sales: number; engagements: number[] }>([
      { $match: { category_scope: scope.category_id, date_range: scope.date_range, source: "web:creator/queryList" } },
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          revenue: { $sum: { $ifNull: ["$revenue", 0] } },
          sales: { $sum: { $ifNull: ["$sales_volume", 0] } },
          engagements: { $push: "$video_engagement_rate" },
        },
      },
    ])
    .toArray();
  const detailed = await db.collection(C.creators).countDocuments({ detail_updated_at: { $exists: true } });
  const eng = (agg?.engagements ?? []).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
  return {
    kocs: agg?.n ?? 0,
    revenue: agg?.revenue ?? 0,
    sales: agg?.sales ?? 0,
    medianEngagement: eng.length ? eng[Math.floor(eng.length / 2)] : null,
    detailed,
  };
}

// ── Campaigns (deep-search briefs) ───────────────────────────────────────────

export interface CampaignView {
  id: string;
  mode: "prompt" | "advanced";
  prompt: string | null;
  category_id: string | null;
  category_name: string | null;
  budget_total: number | null;
  budget_max_per_koc: number | null;
  budget_min_per_koc: number | null;
  koc_count: number | null;
  status: string;
  /** Hội thoại nhiều lượt trên chiến dịch này (lượt đầu = brief, nằm ở `prompt`). */
  messages: ChatMessage[];
  /**
   * Tiến độ để hiển thị ở danh sách. `status` một mình không đủ: "scored" mới xong S2,
   * còn chiến dịch hoàn tất là "recommended" (do S5 đặt).
   */
  progress: "done" | "running" | "halted";
  created_at: Date;
}

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toCampaign = (d: Record<string, unknown>): CampaignView => ({
  id: String(d._id),
  mode: d.mode === "prompt" ? "prompt" : "advanced",
  prompt: (d.prompt as string) ?? null,
  category_id: (d.category_id as string) ?? null,
  category_name: (d.category_name as string) ?? null,
  budget_total: numOrNull(d.budget_total),
  budget_max_per_koc: numOrNull(d.budget_max_per_koc),
  budget_min_per_koc: numOrNull(d.budget_min_per_koc),
  koc_count: numOrNull(d.koc_count),
  status: String(d.status),
  messages: ((d.messages as ChatMessage[]) ?? []).slice(-40),
  progress: campaignProgress(d),
  created_at: d.created_at as Date,
});

/** Giống quy ước ở trang chi tiết: xong khi có S5; dừng khi lỗi hoặc không còn tiến trình giữ lease. */
function campaignProgress(d: Record<string, unknown>): CampaignView["progress"] {
  if ((d.pipeline as { stage?: string } | undefined)?.stage === "done") return "done";
  if (d.pipeline_error) return "halted";
  const lease = (d.pipeline as { lease_until?: Date } | undefined)?.lease_until;
  const alive = lease && new Date(lease).getTime() > Date.now();
  const young = Date.now() - new Date((d.created_at as Date) ?? 0).getTime() <= 30_000;
  return alive || young ? "running" : "halted";
}

/** Short title: the category for structured briefs; prompt-only briefs show their text in their own block. */
export const campaignTitle = (c: CampaignView) => c.category_name ?? "Chiến dịch từ mô tả";

/** One-line preview of the free-text brief for lists. */
export const promptPreview = (c: CampaignView, n = 90) => (c.prompt ? (c.prompt.length > n ? `${c.prompt.slice(0, n)}…` : c.prompt) : null);

export async function listCampaigns(): Promise<CampaignView[]> {
  const db = await getDb();
  const rows = await db.collection(C.campaigns).find({}).sort({ created_at: -1 }).limit(50).toArray();
  return rows.map(toCampaign);
}

export async function getCampaign(id: string): Promise<CampaignView | null> {
  const db = await getDb();
  const d = await db.collection(C.campaigns).findOne({ _id: id as never });
  return d ? toCampaign(d) : null;
}

/** How many stored creators can be evaluated for this campaign right now (code-only counts). */
export async function campaignPool(c: CampaignView) {
  const db = await getDb();
  // Same pool as S2: crawled cosmetics list + the campaign's own category scope (if crawled separately)
  const scopes = [...new Set(["848776,848648", c.category_id ?? "848776,848648"])];
  const inScope = await db.collection(C.creatorMetrics).distinct("creator_id", { category_scope: { $in: scopes }, source: "web:creator/queryList" });
  const detailed = await db.collection(C.creators).countDocuments({ _id: { $in: inScope as never[] }, detail_updated_at: { $exists: true } });
  return { inScope: inScope.length, detailed };
}

// ── S2 results ───────────────────────────────────────────────────────────────

export interface ShortlistRow {
  rank: number;
  creator_id: string;
  handle: string;
  nickname: string;
  followers: number | null;
  mcn: string | null;
  audience_age: string | null;
  total: number;
  scores: Record<string, number>;
  cost: { min: number; max: number; confidence: string; method: string };
  evidence: { id: string; type: string; claim: string; strength: string }[];
  ai: { style: string; niches: string[]; review_depth: number; risks: string[]; summary: string } | null;
  videos: {
    video_id: string;
    title: string;
    times: number[];
    product_match: boolean;
    product_demo: string;
    demo_score: number;
    summary: string;
    frames: { i: number; note: string }[];
  }[];
}

export interface ScoringSummary {
  version: string;
  weights?: Record<string, number>;
  pool: number;
  eligible: number;
  excluded: number;
  shortlisted: number;
  evidence: number;
  excluded_by_reason: Record<string, number>;
  tokens: number;
  duration_ms: number;
  scored_at: Date;
}

export async function getShortlist(
  campaignId: string,
): Promise<{
  summary: ScoringSummary | null;
  /** Kế hoạch AI lập cho chiến dịch này — quyết định các bước hiển thị và bước nào được chạy. */
  plan: BriefPlan;
  /** Pipeline đã chạy hết kế hoạch (không suy từ S5: kế hoạch có thể không có bước đề xuất). */
  finished: boolean;
  screened: boolean;
  videoDone: boolean;
  s3: { kocs: number; duration_ms: number } | null;
  s4: { kocs: number; videos: number; duration_ms: number } | null;
  error: string | null;
  stalled: boolean;
  s5: {
    picks: S5Pick[];
    budget_total: number | null;
    allocated: number;
    cap: number | null;
    wanted: number;
    min_score: number;
    skipped_over_cap: { creator_id: string; score: number; cost_min: number }[];
  } | null;
  rows: ShortlistRow[];
}> {
  const db = await getDb();
  const camp = await db
    .collection(C.campaigns)
    .findOne({ _id: campaignId as never }, { projection: { scoring: 1, s3: 1, s4: 1, s5: 1, plan: 1, criteria: 1, pipeline_error: 1, pipeline: 1, created_at: 1 } });
  const plan: BriefPlan = (camp?.plan as BriefPlan) ?? defaultPlan((camp?.criteria as Record<string, never>) ?? {});
  const finished = camp?.pipeline?.stage === "done";
  const screened = Boolean(camp?.s3);
  const videoDone = Boolean(camp?.s4);
  // After S3 the order is the content-screened ranking; before it, the S2 ranking
  const scores = await db
    .collection(C.campaignScores)
    .find({ campaign_id: campaignId, shortlisted: true })
    .sort(videoDone ? { s4_rank: 1 } : screened ? { s3_rank: 1 } : { rank: 1 })
    .toArray();
  const ids = scores.map((s) => s.creator_id);
  const creators = new Map((await db.collection(C.creators).find({ _id: { $in: ids as never[] } }).toArray()).map((c) => [String(c._id), c]));
  const ev = new Map(
    (await db.collection(C.evidence).find({ campaign_id: campaignId, creator_id: { $in: ids } }).toArray()).map((e) => [String(e._id), e]),
  );
  const rows = scores.map((s) => {
    const c = creators.get(s.creator_id) ?? {};
    return {
      rank: videoDone && s.s4_rank ? s.s4_rank : screened && s.s3_rank ? s.s3_rank : s.rank,
      creator_id: s.creator_id,
      handle: (c as Record<string, string>).handle ?? s.creator_id,
      nickname: (c as Record<string, string>).nickname ?? "",
      followers: (c as Record<string, number>).followers ?? null,
      mcn: ((c as Record<string, string>).mcn as string) || null,
      audience_age: (c as { audience?: { age_majority?: string } }).audience?.age_majority ?? null,
      total: videoDone && typeof s.s4_total === "number" ? s.s4_total : screened && typeof s.s3_total === "number" ? s.s3_total : s.total,
      scores: s.scores,
      videos: (s.s4?.videos ?? []).map((v: Record<string, unknown>) => ({
        video_id: String(v.video_id),
        title: String(v.title ?? ""),
        times: (v.times as number[]) ?? [],
        product_match: Boolean(v.product_match),
        product_demo: String(v.product_demo ?? "không rõ"),
        demo_score: Number(v.demo_score ?? 0),
        summary: String(v.summary ?? ""),
        frames: (v.frames as { i: number; note: string }[]) ?? [],
      })),
      ai: s.s3 ? { style: s.s3.style, niches: s.s3.niches ?? [], review_depth: s.s3.review_depth, risks: s.s3.risks ?? [], summary: s.s3.summary } : null,
      cost: s.cost_estimate,
      evidence: (s.evidence_ids as string[])
        .map((id) => ev.get(id))
        .filter(Boolean)
        .map((e) => ({ id: String(e!._id), type: String(e!.type), claim: String(e!.claim), strength: String(e!.strength) })),
    };
  });
  return {
    summary: (camp?.scoring as ScoringSummary) ?? null,
    plan,
    finished,
    screened,
    videoDone,
    s3: camp?.s3 ? { kocs: camp.s3.kocs, duration_ms: camp.s3.duration_ms } : null,
    s4: camp?.s4 ? { kocs: camp.s4.kocs, videos: camp.s4.videos, duration_ms: camp.s4.duration_ms } : null,
    error: (camp?.pipeline_error as string) ?? null,
    // Not finished, no runner holding the lease, and past the start-up grace → interrupted
    stalled:
      !finished &&
      !camp?.pipeline_error &&
      !(camp?.pipeline?.lease_until && new Date(camp.pipeline.lease_until).getTime() > Date.now()) &&
      Date.now() - new Date(camp?.created_at ?? 0).getTime() > 30_000,
    s5: camp?.s5
      ? {
          picks: camp.s5.picks,
          budget_total: camp.s5.budget_total,
          allocated: camp.s5.allocated,
          cap: camp.s5.cap ?? null,
          wanted: camp.s5.wanted ?? camp.s5.picks.length,
          min_score: camp.s5.min_score ?? 0,
          skipped_over_cap: camp.s5.skipped_over_cap ?? [],
        }
      : null,
    rows,
  };
}

// ── KOC detail ───────────────────────────────────────────────────────────────

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
  // Các cuộc trò chuyện hỏi đáp về chính KOC này (mỗi cuộc là một doc trong `creator_chats`)
  const threads = (await db.collection(C.creatorChats).find({ creator_id: id }).sort({ updated_at: -1 }).limit(20).toArray()).map((t) => ({
    id: String(t._id),
    title: String(t.title ?? "Cuộc trò chuyện"),
    updated_at: (t.updated_at as Date) ?? (t.created_at as Date) ?? new Date(),
    messages: ((t.messages as ChatMessage[]) ?? []).slice(-40),
  }));
  return { creator, metrics, products, videos, threads };
}
