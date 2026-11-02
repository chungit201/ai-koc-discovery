import "server-only";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";
import { claude, resolvedModelId } from "../llm/claude";
import { assessmentId, contentHash, getAssessments, saveAssessments, type Assessment } from "../ai/assessments";
import { runPool } from "../crawl/pool";

/**
 * S3 — content screening with Claude Haiku on the S2 shortlist.
 * The AI judges each KOC's CONTENT (niche, style, how much they actually review/demo products, risks)
 * from text we already have — bio, top video titles, best-selling product names. It gives no numbers
 * about performance; those stay code-computed. Results are campaign-independent and cached per KOC
 * (content_hash + model_id + prompt_version), so the next campaign reuses them at 0 tokens.
 */
export const S3_PROMPT_VERSION = "s3-v1";
const MODEL = "haiku" as const;
const BATCH = 10;
const PARALLEL = 3;

export interface ContentScreen {
  niches: string[]; // e.g. ["chăm sóc da", "trang điểm"]
  style: string; // e.g. "review chi tiết", "bán hàng/livestream", "đời sống"
  review_depth: number; // 0–100: how much the content reviews/demos products (vs. pure selling)
  risks: string[]; // brand-safety notes, e.g. "nội dung gây tranh cãi", "bán nhiều thương hiệu cạnh tranh"
  summary: string; // one Vietnamese sentence
}

const SYSTEM = `[${S3_PROMPT_VERSION}] Bạn đánh giá NỘI DUNG của KOC TikTok mỹ phẩm Việt Nam cho thương hiệu, chỉ dựa trên dữ liệu được cung cấp (bio, tiêu đề video, tên sản phẩm đã bán).
Không bịa số liệu, không đoán doanh thu/follower. Trả về DUY NHẤT một mảng JSON, mỗi phần tử:
{"id": string (giữ nguyên id), "niches": tối đa 3 chủ đề chính (chuỗi ngắn tiếng Việt), "style": một trong "review chi tiết" | "hướng dẫn/tutorial" | "bán hàng/livestream" | "đời sống/giải trí" | "hỗn hợp",
"review_depth": số 0-100 (mức độ video thật sự review/thử/demo sản phẩm thay vì chỉ chào bán),
"risks": mảng tối đa 2 lưu ý an toàn thương hiệu ngắn (rỗng nếu không có),
"summary": 1 câu tiếng Việt ≤ 25 từ nhận xét phong cách nội dung}`;

interface Input {
  id: string;
  bio: string;
  videos: string[];
  products: string[];
}

export async function runS3(campaignId: string) {
  const started = Date.now();
  const db = await getDb();
  const shortlist = await db.collection(C.campaignScores).find({ campaign_id: campaignId, shortlisted: true }).sort({ rank: 1 }).toArray();
  if (!shortlist.length) return null;
  const ids = shortlist.map((s) => String(s.creator_id));

  // ── Build the compact text input per KOC (~300 tokens each) ──
  const creators = new Map((await db.collection(C.creators).find({ _id: { $in: ids as never[] } }).toArray()).map((c) => [String(c._id), c]));
  const vids = await db
    .collection(C.videos)
    .aggregate<{ _id: string; titles: string[] }>([
      { $match: { creator_id: { $in: ids } } },
      { $sort: { views: -1 } },
      { $group: { _id: "$creator_id", titles: { $push: "$title" } } },
    ])
    .toArray();
  const prods = await db
    .collection(C.creatorProducts)
    .aggregate<{ _id: string; names: string[] }>([
      { $match: { creator_id: { $in: ids } } },
      { $sort: { revenue: -1 } },
      { $lookup: { from: C.products, localField: "product_id", foreignField: "_id", as: "p" } },
      { $group: { _id: "$creator_id", names: { $push: { $first: "$p.name" } } } },
    ])
    .toArray();
  const vBy = new Map(vids.map((v) => [v._id, v.titles]));
  const pBy = new Map(prods.map((p) => [p._id, p.names]));
  const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const inputs: Input[] = ids.map((id) => ({
    id,
    bio: clip(creators.get(id)?.bio, 160),
    videos: (vBy.get(id) ?? []).filter(Boolean).slice(0, 10).map((t) => clip(t, 90)),
    products: (pBy.get(id) ?? []).filter(Boolean).slice(0, 8).map((t) => clip(t, 70)),
  }));

  // ── Cache lookup: (creator, content_hash, model_id, prompt_version) ──
  const modelId = await resolvedModelId(MODEL);
  const keyOf = (i: Input, m = modelId) => assessmentId("content_screen", i.id, contentHash({ bio: i.bio, videos: i.videos, products: i.products }), m, S3_PROMPT_VERSION);
  const cached = await getAssessments<ContentScreen>(inputs.map((i) => keyOf(i)));
  const todo = inputs.filter((i) => !cached.has(keyOf(i)));

  // ── Batched Haiku calls for the uncached KOCs ──
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  const fresh: Assessment<ContentScreen>[] = [];
  const batches: Input[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  await runPool(batches, PARALLEL, async (batch) => {
    const res = await claude({ system: SYSTEM, prompt: JSON.stringify(batch), model: MODEL, purpose: "s3-content-screen" });
    tokensIn += res.tokens_in;
    tokensOut += res.tokens_out;
    cost += res.cost_usd;
    const arr = parseArray(res.text);
    const batchFresh: Assessment<ContentScreen>[] = [];
    for (const raw of arr) {
      const input = batch.find((b) => b.id === String(raw.id));
      if (!input) continue; // ignore ids the model invented
      batchFresh.push({
        _id: keyOf(input, res.model_id),
        kind: "content_screen",
        subject_id: input.id,
        content_hash: contentHash({ bio: input.bio, videos: input.videos, products: input.products }),
        model_id: res.model_id,
        prompt_version: S3_PROMPT_VERSION,
        result: sanitize(raw),
        created_at: new Date(),
      });
    }
    // Save per batch → an interruption keeps the finished batches (resume only redoes the rest)
    await saveAssessments(batchFresh);
    fresh.push(...batchFresh);
  });

  // ── Combine with S2 and re-rank the shortlist (campaign-specific part = code) ──
  const all = new Map([...cached.values(), ...fresh].map((a) => [a.subject_id, a]));
  const evidence: Record<string, unknown>[] = [];
  const short = campaignId.slice(0, 8);
  const updates = shortlist.map((s) => {
    const a = all.get(String(s.creator_id));
    const depth = a?.result.review_depth ?? 50;
    const penalty = (a?.result.risks.length ?? 0) * 3; // AI lists risks generously → small nudge only
    const final = Math.round((0.75 * s.total + 0.25 * depth - penalty) * 10) / 10;
    const evId = `ev_${short}_${s.creator_id}_ai_content`;
    if (a)
      evidence.push({
        _id: evId,
        campaign_id: campaignId,
        creator_id: s.creator_id,
        key: "ai_content",
        type: "ai",
        claim: `AI nhận xét: ${a.result.summary}${a.result.risks.length ? ` Lưu ý: ${a.result.risks.join("; ")}.` : ""}`,
        value: depth,
        source: { collection: C.aiAssessments, ref: a._id },
        strength: depth >= 70 ? "strong" : depth >= 40 ? "medium" : "weak",
        created_at: new Date(),
      });
    return { s, a, final, evId };
  });
  updates.sort((x, y) => y.final - x.final);
  await db.collection(C.evidence).deleteMany({ campaign_id: campaignId, key: "ai_content" });
  if (evidence.length) await db.collection(C.evidence).insertMany(evidence as never[]);
  await db.collection(C.campaignScores).bulkWrite(
    updates.map((u, i) => ({
      updateOne: {
        filter: { _id: u.s._id },
        update: {
          $set: {
            s3: u.a ? { ...u.a.result, assessment_id: u.a._id, model_id: u.a.model_id } : null,
            s3_total: u.final,
            s3_rank: i + 1,
            evidence_ids: u.a && !(u.s.evidence_ids as string[]).includes(u.evId) ? [...(u.s.evidence_ids as string[]), u.evId] : u.s.evidence_ids,
          },
        },
      },
    })),
  );

  const summary = {
    prompt_version: S3_PROMPT_VERSION,
    model_id: modelId,
    kocs: inputs.length,
    from_cache: inputs.length - todo.length,
    analysed: fresh.length,
    calls: batches.length,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: Math.round(cost * 1e5) / 1e5,
    duration_ms: Date.now() - started,
    screened_at: new Date(),
  };
  await db.collection(C.campaigns).updateOne({ _id: campaignId as never }, { $set: { s3: summary } });
  return summary;
}

function parseArray(text: string): Record<string, unknown>[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const STYLES = ["review chi tiết", "hướng dẫn/tutorial", "bán hàng/livestream", "đời sống/giải trí", "hỗn hợp"];
function sanitize(x: Record<string, unknown>): ContentScreen {
  const strs = (v: unknown, n: number, len: number) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, len)).slice(0, n) : [];
  const depth = Number(x.review_depth);
  return {
    niches: strs(x.niches, 3, 40),
    style: STYLES.includes(String(x.style)) ? String(x.style) : "hỗn hợp",
    review_depth: Number.isFinite(depth) ? Math.max(0, Math.min(100, Math.round(depth))) : 50,
    risks: strs(x.risks, 2, 120),
    summary: String(x.summary ?? "").trim().slice(0, 220),
  };
}
