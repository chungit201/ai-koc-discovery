import "server-only";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";
import { claude } from "../llm/claude";
import { validateReasons, type Reason } from "../evidence/validate";

/**
 * S5 — final recommendation.
 *  1. Pick N KOCs by code: best final rank first; skip KOCs scoring < MIN_SCORE (never pad the list
 *     with weak picks), whose minimum estimated cost exceeds the per-KOC cap, or that would break
 *     the total budget; at most 2 KOCs from the same MCN (diversity).
 *  2. Allocate the budget by code: everyone starts at their minimum estimate, the rest is spread
 *     by score up to min(max estimate, cap); rounded to 100k VND, never above the total.
 *  3. One Haiku call writes 2–3 short reasons + 1 caution per KOC, each citing evidence ids.
 *  4. validateReasons() drops anything citing unknown evidence or numbers not in the evidence.
 */
export const S5_PROMPT_VERSION = "s5-v1";
const MAX_PER_MCN = 2;
const STEP = 100_000;
export const MIN_SCORE = 55;
const CAP_FACTOR = 1.5; // per-KOC cap = 1.5 × (total ÷ N) when the brief sets no max per KOC
// Brief asks for reach / big names → no automatic cap
const REACH = /độ phủ|reach|kol lớn|koc lớn|nhiều follower|người nổi tiếng|tối đa lượt xem/i;

/** Per-KOC spending cap shared by S4 (which KOCs get their videos watched) and S5 (who can be picked). */
export function perKocCap(camp: Record<string, unknown>): number {
  const { budget_total, budget_max_per_koc, koc_count, prompt } = camp as { budget_total?: number; budget_max_per_koc?: number; koc_count?: number; prompt?: string };
  if (budget_max_per_koc) return budget_max_per_koc;
  if (prompt && REACH.test(prompt)) return Infinity;
  if (budget_total && koc_count) return (CAP_FACTOR * budget_total) / koc_count;
  return Infinity;
}

const SYSTEM = `[${S5_PROMPT_VERSION}] Bạn viết lý do đề xuất KOC TikTok cho nhãn hàng mỹ phẩm Việt Nam.
Mỗi KOC có danh sách bằng chứng {id, claim}. CHỈ được dựa trên các claim đó; mọi con số phải chép đúng từ claim, không tự tính hay bịa số.
Trả về DUY NHẤT mảng JSON, mỗi phần tử:
{"id": string (giữ nguyên), "reasons": 2-3 phần tử {"text": câu tiếng Việt ≤ 22 từ, "evidence_ids": [id bằng chứng được trích]},
"caution": {"text": 1 lưu ý ≤ 18 từ, "evidence_ids": [...]} hoặc null}`;

interface Cand {
  creator_id: string;
  mcn: string | null;
  score: number;
  cost: { min: number; max: number; mid: number };
  evidence_ids: string[];
}

export interface S5Pick {
  creator_id: string;
  budget: number;
  reasons: Reason[];
  caution: Reason | null;
}

export async function runS5(campaignId: string) {
  const started = Date.now();
  const db = await getDb();
  const camp = await db.collection(C.campaigns).findOne({ _id: campaignId as never });
  if (!camp) return null;
  const n: number = camp.koc_count ?? 5;
  const total: number | null = camp.budget_total ?? null;

  const rows = await db
    .collection(C.campaignScores)
    .find({ campaign_id: campaignId, shortlisted: true })
    .sort(camp.s4 ? { s4_rank: 1 } : camp.s3 ? { s3_rank: 1 } : { rank: 1 })
    .toArray();
  const creators = new Map(
    (await db.collection(C.creators).find({ _id: { $in: rows.map((r) => r.creator_id) as never[] } }, { projection: { mcn: 1 } }).toArray()).map((c) => [String(c._id), c]),
  );
  const cands: Cand[] = rows.map((r) => ({
    creator_id: String(r.creator_id),
    mcn: (creators.get(String(r.creator_id))?.mcn as string) || null,
    score: r.s4_total ?? r.s3_total ?? r.total,
    cost: r.cost_estimate,
    evidence_ids: r.evidence_ids ?? [],
  }));

  // ── 1. Pick ──
  const cap = perKocCap(camp);
  const picked: Cand[] = [];
  const overCap: Cand[] = []; // better-scored KOCs left out only because of the cap → explained in the UI
  const mcnCount = new Map<string, number>();
  let minSum = 0;
  for (const c of cands) {
    if (picked.length >= n) break;
    if (c.score < MIN_SCORE) continue;
    if (c.cost.min > cap) {
      overCap.push(c);
      continue;
    }
    if (c.mcn && (mcnCount.get(c.mcn) ?? 0) >= MAX_PER_MCN) continue;
    if (total && minSum + c.cost.min > total) continue;
    picked.push(c);
    minSum += c.cost.min;
    if (c.mcn) mcnCount.set(c.mcn, (mcnCount.get(c.mcn) ?? 0) + 1);
  }
  const lowest = Math.min(...picked.map((c) => c.score));
  const skipped = overCap.filter((c) => !picked.length || c.score > lowest).slice(0, 3);

  // ── 2. Allocate: start at min, spread the rest by score up to min(max, cap) ──
  const round = (v: number) => Math.round(v / STEP) * STEP;
  let alloc = picked.map((c) => c.cost.min);
  if (total) {
    let spare = total - minSum;
    for (let k = 0; k < 6 && spare > STEP; k++) {
      const head = picked.map((c, i) => Math.max(0, Math.min(c.cost.max, cap) - alloc[i]));
      const w = picked.map((c, i) => (head[i] > 0 ? c.score : 0));
      const ws = w.reduce((a, b) => a + b, 0);
      if (!ws) break;
      let used = 0;
      alloc = alloc.map((a, i) => {
        const add = Math.min(head[i], (spare * w[i]) / ws);
        used += add;
        return a + add;
      });
      spare -= used;
    }
  } else {
    alloc = picked.map((c) => Math.min(c.cost.mid, cap));
  }
  const budgets = alloc.map((a, i) => Math.max(picked[i].cost.min, round(a)));
  // Rounding must never push the plan over budget
  if (total) for (let i = budgets.length - 1; i >= 0 && budgets.reduce((a, b) => a + b, 0) > total; i--) budgets[i] = Math.max(picked[i].cost.min, budgets[i] - STEP);

  // ── 3. Reasons (one Haiku call; llm_cache makes reruns free) ──
  const evDocs = await db
    .collection(C.evidence)
    .find({ _id: { $in: picked.flatMap((c) => c.evidence_ids) as never[] } }, { projection: { claim: 1, creator_id: 1 } })
    .toArray();
  const evBy = new Map<string, Map<string, string>>();
  for (const e of evDocs) {
    const m = evBy.get(String(e.creator_id)) ?? new Map<string, string>();
    m.set(String(e._id), String(e.claim));
    evBy.set(String(e.creator_id), m);
  }
  const input = picked.map((c) => ({ id: c.creator_id, evidence: [...(evBy.get(c.creator_id) ?? new Map())].map(([id, claim]) => ({ id, claim })) }));
  const brief = `Chiến dịch: ${camp.category_name ?? ""}${camp.prompt ? ` — "${String(camp.prompt).slice(0, 300)}"` : ""}`;

  let cost = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let modelId = "haiku";
  let raw: Record<string, unknown>[] = [];
  if (picked.length) {
    const res = await claude({ system: SYSTEM, prompt: `${brief}\n${JSON.stringify(input)}`, model: "haiku", purpose: "s5-reasons" });
    cost = res.cost_usd;
    tokensIn = res.tokens_in;
    tokensOut = res.tokens_out;
    modelId = res.model_id;
    raw = parseArray(res.text);
  }

  // ── 4. Validate ──
  let dropped = 0;
  const toReason = (x: unknown): Reason | null =>
    x && typeof x === "object" && typeof (x as Reason).text === "string"
      ? { text: (x as Reason).text.trim(), evidence_ids: Array.isArray((x as Reason).evidence_ids) ? (x as Reason).evidence_ids.map(String) : [] }
      : null;
  const picks: S5Pick[] = picked.map((c, i) => {
    const out = raw.find((r) => String(r.id) === c.creator_id);
    const ev = evBy.get(c.creator_id) ?? new Map<string, string>();
    const reasons = validateReasons(((out?.reasons as unknown[]) ?? []).map(toReason).filter(Boolean) as Reason[], ev);
    const caution = validateReasons([toReason(out?.caution)].filter(Boolean) as Reason[], ev);
    dropped += reasons.dropped.length + caution.dropped.length;
    return { creator_id: c.creator_id, budget: budgets[i], reasons: reasons.kept.slice(0, 3), caution: caution.kept[0] ?? null };
  });

  const summary = {
    prompt_version: S5_PROMPT_VERSION,
    model_id: modelId,
    picks,
    budget_total: total,
    allocated: budgets.reduce((a, b) => a + b, 0),
    cap: Number.isFinite(cap) ? cap : null,
    min_score: MIN_SCORE,
    wanted: n,
    skipped_over_cap: skipped.map((c) => ({ creator_id: c.creator_id, score: c.score, cost_min: c.cost.min })),
    dropped_reasons: dropped,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: Math.round(cost * 1e5) / 1e5,
    duration_ms: Date.now() - started,
    recommended_at: new Date(),
  };
  await db.collection(C.campaigns).updateOne({ _id: campaignId as never }, { $set: { s5: summary, status: "recommended" } });
  return summary;
}

function parseArray(text: string): Record<string, unknown>[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const v = JSON.parse(m[0]);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
