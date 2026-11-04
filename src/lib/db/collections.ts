import type { Db } from "mongodb";

// Collection names — see docs/03-database.md
export const C = {
  rawResponses: "raw_responses",
  apiCalls: "api_calls",
  categories: "categories", // cây danh mục đa ngành (cấp 1 ngành → 2 nhóm → 3 loại) + số liệu — scripts/build-categories.ts
  creators: "creators",
  creatorMetrics: "creator_metrics",
  products: "products",
  creatorProducts: "creator_products",
  videos: "videos",
  crawlRuns: "crawl_runs",
  avatars: "avatars", // creator avatar image bytes (Kalodata URLs expire after 5 min)
  favorites: "favorites", // KOCs saved with the star button
  campaigns: "campaigns", // deep-search briefs entered in the UI
  campaignScores: "campaign_scores", // S2: per (campaign, creator) eligibility + component scores
  evidence: "evidence", // one row per claim, cited by reasons (docs/02-tola-ai.md §5)
  shops: "shops", // người bán (seller) — tên shop do `crawl:shops` điền
  creatorShops: "creator_shops", // tab "Cửa hàng" của KOC: 1 KOC × 1 shop hợp tác × khoảng ngày (web /creator/detail/searchCooperativeShops)
  llmCache: "llm_cache",
  llmModels: "llm_models", // alias ("haiku") → full model id last seen, for version-aware cache keys
  aiAssessments: "ai_assessments", // per-KOC AI analyses keyed by (creator, content_hash, model_id, prompt_version) // identical LLM prompts → cached answer (0 tokens on repeat)
  videoMedia: "video_media", // resolved playable MP4 links per video (cache, refreshed after a few hours)
  creatorChats: "creator_chats", // hội thoại hỏi đáp ở trang hồ sơ từng KOC (tách khỏi `creators` vì doc đó do crawler ghi đè)
  tolaChats: "tola_chats", // hội thoại với trợ lý Tola — không gắn với KOC hay chiến dịch nào, ngữ cảnh nằm trong tag @handle của từng câu
  stageItems: "stage_items",
} as const;

export type StageStatus = "pending" | "running" | "done" | "failed";

export interface RawResponse {
  _id: string; // request_hash
  endpoint: string;
  request: unknown;
  response: unknown;
  credit_cost: number;
  fetched_at: Date;
  expires_at: Date;
}

export interface ApiCall {
  run_id?: string;
  model_id?: string;
  provider: "kalodata" | "claude";
  endpoint: string;
  credit: number;
  cost_usd: number;
  tokens_in?: number;
  tokens_out?: number;
  latency_ms: number;
  cache_hit: boolean;
  status: "ok" | "error";
  error?: string;
  created_at: Date;
}

export interface StageItem {
  run_id: string;
  stage: string;
  item_id: string;
  status: StageStatus;
  attempts: number;
  error?: string;
  updated_at: Date;
}

export async function ensureIndexes(db: Db): Promise<void> {
  // Raw responses are evidence: never auto-delete. `expires_at` only decides cache freshness.
  const raw = db.collection(C.rawResponses);
  const ttl = (await raw.indexes()).find((i) => i.key?.expires_at === 1 && i.expireAfterSeconds !== undefined);
  if (ttl?.name) await raw.dropIndex(ttl.name);
  await raw.createIndex({ expires_at: 1 });
  await db.collection(C.rawResponses).createIndex({ endpoint: 1, fetched_at: -1 });
  await db.collection(C.apiCalls).createIndex({ run_id: 1, created_at: 1 });
  await db.collection(C.creatorMetrics).createIndex(
    { creator_id: 1, date_range: 1, category_scope: 1 },
    { unique: true },
  );
  await db.collection(C.creatorProducts).createIndex(
    { creator_id: 1, product_id: 1, date_range: 1 },
    { unique: true },
  );
  await db.collection(C.creatorShops).createIndex({ creator_id: 1, seller_id: 1, date_range: 1 }, { unique: true });
  await db.collection(C.videos).createIndex({ creator_id: 1 });
  await db.collection(C.categories).createIndex({ parent_id: 1 });
  await db.collection(C.products).createIndex({ "category.l3.id": 1 });
  await db.collection(C.products).createIndex({ "category.l2.id": 1 });
  await db.collection(C.products).createIndex({ "category.l1.id": 1 });
  // Truy vấn theo ngành nhanh: doanh thu theo danh mục, KOC theo ngành/nhóm
  await db.collection(C.creatorProducts).createIndex({ "cat.l1": 1 });
  await db.collection(C.creatorProducts).createIndex({ "cat.l2": 1 });
  await db.collection(C.creatorProducts).createIndex({ "cat.l3": 1 });
  await db.collection(C.creators).createIndex({ "industry.l1.id": 1 });
  await db.collection(C.creators).createIndex({ "industry.l2.id": 1 });
  await db.collection(C.creators).createIndex({ "category_mix.id": 1 });
  await db.collection(C.stageItems).createIndex({ run_id: 1, stage: 1, item_id: 1 }, { unique: true });
  await db.collection(C.stageItems).createIndex({ run_id: 1, stage: 1, status: 1 });
}
