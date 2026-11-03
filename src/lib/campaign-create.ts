import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db/mongo";
import { C } from "./db/collections";
import { CAMPAIGN_CATEGORIES } from "./campaign";
import { DEFAULT_CRITERIA, sanitizeExtracted, type Criteria } from "./brief";
import { sanitizePlan, type BriefPlan } from "./plan";
import { parseBrief } from "./brief-parser";

/**
 * Tạo chiến dịch từ một brief văn xuôi — dùng chung cho nút "Chiến dịch mới" và cho công cụ
 * `create_campaign` của trợ lý Tola.
 *
 * **Không tự chạy pipeline.** Công cụ MCP sống trong tiến trình con chết ngay sau lượt hỏi, nên
 * `void runPipeline()` ở đó sẽ bị giết giữa chừng. Thay vào đó đánh dấu `pipeline.queued_by` rồi để
 * tiến trình Next (route `/api/tola/ask`) nhặt lên chạy sau khi lượt kết thúc.
 */
export async function createCampaignFromBrief(prompt: string, queuedBy?: string): Promise<{ id: string; criteria: Criteria; plan: BriefPlan; cost_usd: number }> {
  const parsed = await parseBrief(prompt);
  const { values } = sanitizeExtracted(parsed.values as unknown as Record<string, unknown>);
  const criteria: Criteria = { ...DEFAULT_CRITERIA, audience_ages: [], ...values };
  const plan = sanitizePlan({ plan: parsed.plan.steps, rank_by: parsed.plan.rank_by, questions: [] }, criteria);

  const id = randomUUID();
  const db = await getDb();
  await db.collection(C.campaigns).insertOne({
    _id: id as never,
    mode: "prompt",
    prompt: prompt.slice(0, 1000),
    criteria,
    plan,
    criteria_sources: Object.fromEntries(parsed.fields.map((f) => [f, "prompt"])),
    ai_suggestions: parsed.suggestions.slice(0, 3),
    brief_llm: {
      used: true,
      tokens_in: parsed.usage.tokens_in,
      tokens_out: parsed.usage.tokens_out,
      cost_usd: parsed.usage.cost_usd,
      cached: parsed.usage.cache_hit,
      latency_ms: parsed.usage.latency_ms,
    },
    // bản sao phẳng cho trang danh sách / chi tiết
    category_id: criteria.category_id,
    category_name: CAMPAIGN_CATEGORIES.find((c) => c.id === criteria.category_id)?.name ?? criteria.category_id,
    budget_total: criteria.budget_total,
    budget_min_per_koc: criteria.budget_min_per_koc,
    budget_max_per_koc: criteria.budget_max_per_koc,
    koc_count: criteria.koc_count,
    status: "confirmed",
    ...(queuedBy ? { pipeline: { queued_by: queuedBy } } : {}),
    created_at: new Date(),
  });

  return { id, criteria, plan, cost_usd: parsed.usage.cost_usd };
}

/**
 * Chiến dịch do trợ lý tạo mà chưa ai chạy pipeline. Gọi từ tiến trình Next (nơi sống đủ lâu) ngay
 * sau khi lượt hỏi kết thúc. `runPipeline` tự có lease nên gọi trùng cũng vô hại.
 */
export async function pendingTolaCampaigns(): Promise<string[]> {
  const db = await getDb();
  const docs = await db
    .collection(C.campaigns)
    .find({ "pipeline.queued_by": "tola", "pipeline.runs_started_at": { $exists: false } }, { projection: { _id: 1 } })
    .toArray();
  return docs.map((d) => String(d._id));
}
