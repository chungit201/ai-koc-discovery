import "server-only";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";
import { claude, resolvedModelId } from "../llm/claude";
import { assessmentId, contentHash, getAssessments, saveAssessments, type Assessment } from "../ai/assessments";
import { runPool } from "../crawl/pool";
import { frameSheet } from "../media/frames";
import { perKocCap } from "./s5-recommend";
import { focusPattern } from "../scoring/rules";
import { DEFAULT_CRITERIA, type Criteria } from "../brief";

/**
 * S4 — AI video analysis (Claude Sonnet vision) for the top of the S3 ranking.
 * Per video we send ONE small keyframe sheet (4 frames, 1080×480) + its title — never the whole video.
 * The analysis describes what is visible and is campaign-independent → cached per
 * (video_id, content_hash(sheet + title), model_id, prompt_version) and reused by later campaigns.
 * Campaign fit (does the product shown match the brief?) is computed by code afterwards.
 */
export const S4_PROMPT_VERSION = "s4-v1"; // prompt only — scoring tweaks below never invalidate cached analyses
const MODEL = "sonnet" as const;
const VIDEOS_PER_KOC = 2;
const PARALLEL = 6;
export const S4_KOCS = (n: number) => Math.min(10, Math.max(6, n * 2));

export interface VideoAnalysis {
  product_demo: "có" | "không" | "không rõ";
  demo_score: number; // 0–100: how clearly a product is shown, applied, tested
  products_seen: string[];
  presenter: { visible: boolean; gender: "nữ" | "nam" | null; age_range: string | null };
  production_quality: number; // 0–100
  authenticity: number; // 0–100: natural, trustworthy vs. hard-sell / staged
  frames: { i: number; note: string }[]; // per keyframe (1–4)
  risks: string[];
  summary: string;
}

export const S4_SYSTEM = `[${S4_PROMPT_VERSION}] Bạn phân tích video TikTok của KOC mỹ phẩm Việt Nam qua 4 khung hình (trái → phải là khung 1→4 theo thời gian) và tiêu đề.
Chỉ mô tả điều THẤY được, không suy đoán doanh số. Trả về DUY NHẤT 1 object JSON:
{"product_demo": "có"|"không"|"không rõ" (có thoa/thử/cầm cận cảnh sản phẩm không),
"demo_score": 0-100, "products_seen": tối đa 3 mô tả ngắn sản phẩm thấy được (vd "kem chống nắng dạng tuýp"),
"presenter": {"visible": bool, "gender": "nữ"|"nam"|null, "age_range": "18-24"|"25-34"|"35-44"|"45+"|null (ước tính ngoại hình)},
"production_quality": 0-100 (ánh sáng, nét, bố cục), "authenticity": 0-100 (tự nhiên, đáng tin vs. quảng cáo gượng ép),
"frames": [{"i": 1-4, "note": mô tả ≤ 12 từ}], "risks": tối đa 2 lưu ý an toàn thương hiệu (rỗng nếu không),
"summary": 1 câu tiếng Việt ≤ 25 từ}`;

/**
 * Which videos S4 looks at: top KOCs (S3 order, or S2 order for the early prefetch) × 2 videos —
 * best on-topic by views + best by revenue.
 */
async function pickVideos(campaignId: string, crit: Criteria, order: "s3" | "s2", extraKocs = 0) {
  const db = await getDb();
  const focus = focusPattern(crit.category_id, crit.product_focus);
  // Only KOCs S5 could pick (min cost within the per-KOC cap), so no recommendation is left unwatched
  const camp = await db.collection(C.campaigns).findOne({ _id: campaignId as never });
  const cap = camp ? perKocCap(camp) : Infinity;
  const top = (
    await db
      .collection(C.campaignScores)
      .find({ campaign_id: campaignId, shortlisted: true })
      .sort(order === "s3" ? { s3_rank: 1, rank: 1 } : { rank: 1 })
      .toArray()
  )
    .filter((t) => !(t.cost_estimate?.min > cap))
    .slice(0, S4_KOCS(crit.koc_count) + extraKocs);
  const picks: Pick[] = [];
  for (const t of top) {
    const vids = await db.collection(C.videos).find({ creator_id: t.creator_id }).project<{ _id: string; title?: string; views?: number; revenue?: number }>({ title: 1, views: 1, revenue: 1 }).toArray();
    const byViews = [...vids].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
    const chosen = [byViews.find((v) => focus.test(v.title ?? "")), [...vids].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0], ...byViews];
    const seen = new Set<string>();
    for (const v of chosen) {
      if (!v || seen.has(String(v._id))) continue;
      seen.add(String(v._id));
      picks.push({ creator_id: String(t.creator_id), video_id: String(v._id), title: String(v.title ?? "").slice(0, 150), views: v.views ?? 0 });
      if (seen.size >= VIDEOS_PER_KOC) break;
    }
  }
  return { top, picks };
}

/**
 * Started right after S2, in parallel with S3: builds the keyframe sheets (no AI, no cost) for the
 * S2 top KOCs + a margin, so by the time S4 runs most sheets are on disk and S4 is mostly AI time.
 */
export async function prefetchS4Frames(campaignId: string) {
  const db = await getDb();
  const camp = await db.collection(C.campaigns).findOne({ _id: campaignId as never });
  if (!camp) return;
  const crit: Criteria = { ...DEFAULT_CRITERIA, audience_ages: [], ...((camp.criteria as Partial<Criteria>) ?? {}) };
  const { picks } = await pickVideos(campaignId, crit, "s2", 2);
  await runPool(picks, PARALLEL, async (pk) => {
    await frameSheet(pk.video_id).catch(() => undefined); // S4 retries and reports failures itself
  });
}

interface Pick {
  creator_id: string;
  video_id: string;
  title: string;
  views: number;
}

export async function runS4(campaignId: string) {
  const started = Date.now();
  const db = await getDb();
  const camp = await db.collection(C.campaigns).findOne({ _id: campaignId as never });
  if (!camp) throw new Error("Không tìm thấy chiến dịch");
  const crit: Criteria = { ...DEFAULT_CRITERIA, audience_ages: [], ...((camp.criteria as Partial<Criteria>) ?? {}) };
  const focus = focusPattern(crit.category_id, crit.product_focus);

  const { top, picks } = await pickVideos(campaignId, crit, "s3");
  if (!top.length) return null;

  // ── Analyse (cached per video + content + model + prompt version) ──
  const modelId = await resolvedModelId(MODEL);
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  let fromCache = 0;
  const failed: string[] = [];
  const results = new Map<string, Assessment<VideoAnalysis> & { times: number[] }>();

  await runPool(picks, PARALLEL, async (pk) => {
    try {
      const sheet = await frameSheet(pk.video_id);
      const hash = contentHash({ sheet: sheet.base64.length, sheetHead: sheet.base64.slice(0, 2048), title: pk.title });
      const id = assessmentId("video_analysis", pk.video_id, hash, modelId, S4_PROMPT_VERSION);
      const hit = (await getAssessments<VideoAnalysis>([id])).get(id);
      if (hit) {
        fromCache++;
        results.set(pk.video_id, { ...hit, times: sheet.times });
        return;
      }
      const res = await claude({
        system: S4_SYSTEM,
        prompt: `Tiêu đề: ${pk.title}\nThời điểm 4 khung (giây): ${sheet.times.join(", ")}`,
        model: MODEL,
        purpose: "s4-video",
        images: [{ media_type: "image/jpeg", data: sheet.base64 }],
      });
      tokensIn += res.tokens_in;
      tokensOut += res.tokens_out;
      cost += res.cost_usd;
      const a: Assessment<VideoAnalysis> = {
        _id: assessmentId("video_analysis", pk.video_id, hash, res.model_id, S4_PROMPT_VERSION),
        kind: "video_analysis",
        subject_id: pk.video_id,
        content_hash: hash,
        model_id: res.model_id,
        prompt_version: S4_PROMPT_VERSION,
        result: sanitize(parseObject(res.text)),
        created_at: new Date(),
      };
      await saveAssessments([a]);
      results.set(pk.video_id, { ...a, times: sheet.times });
    } catch (err) {
      failed.push(pk.video_id);
      console.error("S4 video failed", pk.video_id, err instanceof Error ? err.message : err);
    }
  });

  // ── Campaign-specific scoring by code + evidence ──
  const short = campaignId.slice(0, 8);
  const evidence: Record<string, unknown>[] = [];
  const perKoc = new Map<string, { score: number; videos: { video_id: string; title: string; a: VideoAnalysis; times: number[]; match: boolean; score: number }[] }>();
  for (const pk of picks) {
    const r = results.get(pk.video_id);
    if (!r) continue;
    const a = r.result;
    const match = a.products_seen.some((p) => focus.test(p)) || focus.test(pk.title);
    const vScore = Math.min(100, 0.4 * a.demo_score + 0.3 * a.production_quality + 0.3 * a.authenticity);
    const k = perKoc.get(pk.creator_id) ?? { score: 0, videos: [] };
    k.videos.push({ video_id: pk.video_id, title: pk.title, a, times: r.times, match, score: vScore });
    perKoc.set(pk.creator_id, k);

    const best = a.frames.find((f) => /thoa|thử|cầm|cận|demo|bôi|swatch|texture|kết cấu/i.test(f.note)) ?? a.frames[0];
    const sec = best ? r.times[Math.max(0, Math.min(r.times.length - 1, best.i - 1))] : null;
    evidence.push({
      _id: `ev_${short}_${pk.creator_id}_video_${pk.video_id}`,
      campaign_id: campaignId,
      creator_id: pk.creator_id,
      key: `video_${pk.video_id}`,
      type: "video_moment",
      claim: `AI xem video “${pk.title.slice(0, 60)}${pk.title.length > 60 ? "…" : ""}”${sec !== null ? ` (giây ${Math.round(sec)})` : ""}: ${a.summary}`,
      value: a.demo_score,
      source: { collection: C.aiAssessments, ref: r._id },
      video_id: pk.video_id,
      timestamp_sec: sec,
      strength: a.demo_score >= 70 && match ? "strong" : a.demo_score >= 40 ? "medium" : "weak",
      created_at: new Date(),
    });
  }

  // KOC video score = best video. With a named product, only on-product videos count fully;
  // a KOC whose analysed videos never show the product gets their best score × 0.6.
  for (const k of perKoc.values()) {
    const on = k.videos.filter((v) => v.match);
    k.score = crit.product_focus
      ? on.length
        ? Math.max(...on.map((v) => v.score))
        : 0.6 * Math.max(...k.videos.map((v) => v.score))
      : Math.max(...k.videos.map((v) => v.score));
  }

  const rows = await db.collection(C.campaignScores).find({ campaign_id: campaignId, shortlisted: true }).toArray();
  const ranked = rows
    .map((s) => {
      const base = typeof s.s3_total === "number" ? s.s3_total : s.total;
      const k = perKoc.get(String(s.creator_id));
      // KOCs not video-analysed keep their score but rank after analysed ones of similar quality
      // Visual proof weighs 40%: it is the strongest evidence that a KOC really demos the product
      const final = k ? Math.round((0.6 * base + 0.4 * k.score) * 10) / 10 : Math.round(base * 0.85 * 10) / 10;
      return { s, k, final };
    })
    .sort((a, b) => b.final - a.final);

  await db.collection(C.evidence).deleteMany({ campaign_id: campaignId, type: "video_moment" });
  if (evidence.length) await db.collection(C.evidence).insertMany(evidence as never[]);
  await db.collection(C.campaignScores).bulkWrite(
    ranked.map((r, i) => {
      const evIds = (r.s.evidence_ids as string[]).filter((e) => !e.includes("_video_"));
      const videoEv = evidence.filter((e) => e.creator_id === r.s.creator_id).map((e) => String(e._id));
      return {
        updateOne: {
          filter: { _id: r.s._id },
          update: {
            $set: {
              s4: r.k
                ? {
                    score: Math.round(r.k.score * 10) / 10,
                    videos: r.k.videos.map((v) => ({ video_id: v.video_id, title: v.title, times: v.times, product_match: v.match, video_score: Math.round(v.score), ...v.a })),
                  }
                : null,
              s4_total: r.final,
              s4_rank: i + 1,
              evidence_ids: [...evIds, ...videoEv],
            },
          },
        },
      };
    }),
  );

  const summary = {
    prompt_version: S4_PROMPT_VERSION,
    model_id: modelId,
    kocs: top.length,
    videos: picks.length,
    from_cache: fromCache,
    analysed: picks.length - fromCache - failed.length,
    failed: failed.length,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: Math.round(cost * 1e5) / 1e5,
    duration_ms: Date.now() - started,
    analysed_at: new Date(),
  };
  await db.collection(C.campaigns).updateOne({ _id: campaignId as never }, { $set: { s4: summary } });
  return summary;
}

function parseObject(text: string): Record<string, unknown> {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  try {
    return s >= 0 && e > s ? JSON.parse(text.slice(s, e + 1)) : {};
  } catch {
    return {};
  }
}

const n100 = (v: unknown, d = 50) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : d;
};
const strs = (v: unknown, n: number, len: number) =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, len)).slice(0, n) : [];

function sanitize(x: Record<string, unknown>): VideoAnalysis {
  const p = (x.presenter ?? {}) as Record<string, unknown>;
  const frames = Array.isArray(x.frames)
    ? (x.frames as Record<string, unknown>[])
        .map((f) => ({ i: Math.max(1, Math.min(4, Math.round(Number(f.i) || 1))), note: String(f.note ?? "").trim().slice(0, 100) }))
        .filter((f) => f.note)
        .slice(0, 4)
    : [];
  return {
    product_demo: x.product_demo === "có" || x.product_demo === "không" ? x.product_demo : "không rõ",
    demo_score: n100(x.demo_score, 30),
    products_seen: strs(x.products_seen, 3, 60),
    presenter: {
      visible: Boolean(p.visible),
      gender: p.gender === "nữ" || p.gender === "nam" ? p.gender : null,
      age_range: typeof p.age_range === "string" && /^\d{2}(-\d{2}|\+)$/.test(p.age_range) ? p.age_range : null,
    },
    production_quality: n100(x.production_quality),
    authenticity: n100(x.authenticity),
    frames,
    risks: strs(x.risks, 2, 120),
    summary: String(x.summary ?? "").trim().slice(0, 220),
  };
}
