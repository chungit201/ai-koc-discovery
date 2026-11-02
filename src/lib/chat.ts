import "server-only";
import { getDb } from "./db/mongo";
import { C } from "./db/collections";
import { claude } from "./llm/claude";
import { sanitizeExtracted, type Criteria } from "./brief";
import { CAPABILITIES, defaultPlan, sanitizePlan, type BriefPlan, type Capability } from "./plan";
import { validateReasons, type Reason } from "./evidence/validate";
import type { AnswerBlock, ReportData } from "./chat-events";
import { DEEPEN_TOO_MANY, NO_AUDIO, asksAboutVoice, limitDeepen, limitExclude, wantsBulk } from "./chat-rules";

/**
 * Chat nhiều lượt trên một chiến dịch đã có (docs/01-plan.md — Step 10b).
 *
 * AI **chỉ phân loại ý định** trong danh sách đóng và đề xuất thay đổi tiêu chí; **code quyết định
 * chạy lại từ bước nào** (bảng `RERUN_FROM`). Nhờ cache theo KOC/video, chạy lại gần như 0 token
 * cho S3/S4 — chỉ S5 là tốn thêm vài cent.
 *
 * Kết quả **ghi đè**: chiến dịch luôn giữ một bản đề xuất mới nhất, lịch sử nằm ở `messages`.
 */
export const CHAT_PROMPT_VERSION = "chat-v3";
/** Số lượt gần nhất đưa vào ngữ cảnh — đủ để hiểu "em xem đi" nói về KOC nào. */
const HISTORY_TURNS = 8;

export type Intent = "refine_criteria" | "exclude_koc" | "deepen" | "explain" | "out_of_scope";

/** Đổi gì thì phải chạy lại từ đâu — bảng này nằm trong code, AI không được quyết. */
const RERUN_FROM: Record<Intent, Capability | null> = {
  refine_criteria: "score_fit", // điểm phụ thuộc tiêu chí → chấm lại, S3/S4 dựng lại từ cache
  exclude_koc: "recommend", // chỉ đổi danh sách được chọn
  deepen: "analyse_videos", // xem thêm video rồi chọn lại
  explain: null, // không đổi dữ liệu
  out_of_scope: null,
};

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Lượt của trợ lý có thể kèm kế hoạch chạy lại + lý do dẫn bằng chứng. */
  intent?: Intent;
  reruns?: Capability[];
  reasons?: Reason[];
  /** Dẫn chứng trực quan ở chat hồ sơ KOC: ảnh bìa sản phẩm bán chạy và video AI đã xem. */
  products?: { product_id: string; name: string; revenue: number; share: number }[];
  videos?: { video_id: string; title: string; views: number; times: number[]; summary: string; demo: string }[];
  /** Các bước phân tích đã chạy + nhóm KOC cùng tầm dùng để đối chuẩn (chat hồ sơ KOC). */
  steps?: { title: string; detail: string; kind?: "data" | "peers" | "videos" | "conclusion" }[];
  peers?: { creator_id: string; name: string; followers: number; revenue: number; engagement: number; analysed?: boolean }[];
  /** Bảng số liệu của báo cáo (code dựng từ DB). */
  report?: ReportData;
  /** Câu hỏi gợi ý tiếp theo, bấm là hỏi luôn. */
  follow_ups?: string[];
  /** Bố cục bài trả lời do model tự dựng (đoạn văn, tiêu đề, bảng nào được chèn). */
  blocks?: AnswerBlock[];
  created_at: Date;
}

const SYSTEM = `[${CHAT_PROMPT_VERSION}] Bạn là trợ lý tìm KOC TikTok mỹ phẩm Việt Nam, đang trao đổi tiếp về một chiến dịch đã chạy.
Khả năng thật của hệ thống: phân tích video chỉ đọc 4 KHUNG HÌNH TĨNH, không có âm thanh và không có lời thoại — tuyệt đối không hứa đánh giá giọng nói, nhạc nền hay nội dung nói.
Dựa vào HỘI THOẠI TRƯỚC ĐÓ để hiểu câu nói tắt: "em xem đi", "ok làm đi", "người đó", "bạn ấy" trỏ tới KOC vừa được nhắc ở lượt trước — tự điền creator_ids tương ứng, đừng hỏi lại.
Phân loại yêu cầu mới của người dùng và trả về DUY NHẤT 1 object JSON, không giải thích:
{"intent": một trong "refine_criteria" (đổi tiêu chí: ngân sách, số KOC, follower, MCN, danh mục, sản phẩm),
   "exclude_koc" (bỏ/thay một hoặc vài KOC khỏi đề xuất), "deepen" (muốn xem kỹ video nhiều KOC hơn),
   "explain" (hỏi vì sao, giải thích, so sánh — không đổi gì), "out_of_scope" (ngoài dữ liệu: ngành ngoài mỹ phẩm, nền tảng khác, việc hệ thống không làm được),
 "criteria": chỉ khi intent="refine_criteria" — các trường thay đổi, dùng đúng schema tiêu chí (budget_total, budget_min_per_koc, budget_max_per_koc, koc_count, followers_min, followers_max, product_focus, category_id, mcn, audience_gender, audience_ages). Tiền theo VND. Không nhắc tới thì bỏ qua.
 "creator_ids": khi intent="exclude_koc" hoặc "deepen" — mảng id lấy TỪ DANH SÁCH KOC bên dưới, không bịa id mới. Người dùng đòi xem video "tất cả"/"toàn bộ" thì trả về mảng rỗng,
 "reply": 1-2 câu tiếng Việt trả lời người dùng, nói rõ bạn sắp làm gì. KHÔNG nêu con số nào không có trong dữ liệu được cung cấp.}`;

const EXPLAIN_SYSTEM = `[${CHAT_PROMPT_VERSION}] Bạn trả lời câu hỏi về các KOC đã đề xuất, dựa HOÀN TOÀN vào danh sách bằng chứng {id, claim} được cung cấp.
Mọi con số phải chép đúng từ claim, không tự tính hay bịa.
Viết số bằng CHỮ SỐ (vd "48%", "20 triệu"), không viết số bằng chữ — viết bằng chữ là cách lách kiểm tra bằng chứng.
Khi claim có nhãn mức (nhóm dẫn đầu / trên trung bình / quanh mức trung bình / dưới trung bình / nhóm thấp), dùng đúng nhãn đó, không tự nâng hay hạ.
Trả về DUY NHẤT 1 object JSON:
{"answer": 1-3 câu tiếng Việt mở đầu, không chứa con số,
 "points": 1-4 phần tử {"text": câu tiếng Việt ≤ 25 từ, "evidence_ids": [id bằng chứng được trích]}}`;

const parseObject = (text: string): Record<string, unknown> => {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  try {
    return s >= 0 && e > s ? (JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export interface ChatOutcome {
  intent: Intent;
  reply: string;
  reruns: Capability[];
  reasons: Reason[];
  cost_usd: number;
}

/**
 * Xử lý một lượt chat: phân loại → áp thay đổi vào chiến dịch → báo cho pipeline biết phải chạy
 * lại từ bước nào. Việc chạy lại do `runPipeline` làm sau đó (đã có lease chống chạy trùng).
 */
export async function handleTurn(campaignId: string, text: string, opts: { dryRun?: boolean } = {}): Promise<ChatOutcome> {
  const db = await getDb();
  const col = db.collection(C.campaigns);
  const camp = await col.findOne({ _id: campaignId as never });
  if (!camp) throw new Error("Không tìm thấy chiến dịch");

  // Danh sách KOC hiện tại để AI chỉ được chọn id có thật (gồm cả nhóm dự phòng, vì người dùng
  // có thể muốn xem kỹ một người chưa được chọn)
  const picks = (camp.s5?.picks ?? []) as { creator_id: string }[];
  const pickedIds = new Set(picks.map((p) => p.creator_id));
  const shortlistIds = (
    await db.collection(C.campaignScores).find({ campaign_id: campaignId, shortlisted: true }, { projection: { creator_id: 1 } }).toArray()
  ).map((r) => String(r.creator_id));
  const rosterIds = [...new Set([...picks.map((p) => p.creator_id), ...shortlistIds])];
  const creators = await db
    .collection(C.creators)
    .find({ _id: { $in: rosterIds as never[] } }, { projection: { handle: 1, nickname: 1 } })
    .toArray();
  const nameOf = new Map(creators.map((c) => [String(c._id), String(c.nickname || c.handle || c._id)]));
  const roster = rosterIds
    .map((cid, i) => `${i + 1}. ${nameOf.get(cid) ?? cid} (id ${cid})${pickedIds.has(cid) ? " — đang được đề xuất" : " — dự phòng"}`)
    .join("\n");

  // Lịch sử gần nhất: không có nó thì câu kiểu "em xem đi" / "người đó" không hiểu được là ai
  const history = ((camp.messages as ChatMessage[]) ?? [])
    .slice(-HISTORY_TURNS)
    .map((m) => `${m.role === "user" ? "Người dùng" : "Bạn"}: ${m.text}`)
    .join("\n");

  const prompt = [
    await campaignState(campaignId, camp, nameOf),
    picks.length ? `KOC đang được đề xuất:\n${roster}` : `Danh sách KOC:\n${roster}`,
    history ? `Hội thoại trước đó:\n${history}` : "",
    `Yêu cầu mới của người dùng: ${text}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await claude({ system: SYSTEM, prompt, model: "haiku", purpose: "chat-turn" });
  const out = parseObject(res.text);
  const intent: Intent = (["refine_criteria", "exclude_koc", "deepen", "explain", "out_of_scope"] as Intent[]).includes(out.intent as Intent)
    ? (out.intent as Intent)
    : "explain";
  let reply = typeof out.reply === "string" ? out.reply.trim().slice(0, 400) : "";
  let cost = res.cost_usd;
  let reasons: Reason[] = [];

  // Chiến dịch tạo trước khi có tính năng kế hoạch thì chưa có `plan` — phải dùng kế hoạch mặc định
  // (đủ 4 bước) làm điểm xuất phát, nếu không một lượt chat sẽ vô tình cắt mất S3/S4.
  const basePlan: BriefPlan = (camp.plan as BriefPlan | undefined) ?? defaultPlan((camp.criteria as Partial<Criteria>) ?? {});

  const set: Record<string, unknown> = {};
  const unset: Record<string, string> = {};
  let from = RERUN_FROM[intent];

  // Luật khoá cứng: hỏi về giọng nói/âm thanh thì nói thẳng là không có dữ liệu, không hứa xem video
  if (asksAboutVoice(text)) {
    return { intent: "out_of_scope", reply: NO_AUDIO, reruns: [], reasons: [], cost_usd: cost };
  }

  if (intent === "refine_criteria") {
    const { values } = sanitizeExtracted((out.criteria ?? {}) as Record<string, unknown>);
    if (!Object.keys(values).length) {
      // AI nói đổi tiêu chí nhưng không rút ra được giá trị hợp lệ → không chạy lại cho chắc
      from = null;
      reply = reply || "Mình chưa rõ cần đổi tiêu chí nào — bạn nói rõ con số giúp mình nhé.";
    } else {
      const criteria: Criteria = { ...(camp.criteria as Criteria), ...values };
      Object.assign(set, {
        criteria,
        // bản sao phẳng dùng cho danh sách/chi tiết
        ...("budget_total" in values ? { budget_total: criteria.budget_total } : {}),
        ...("budget_min_per_koc" in values ? { budget_min_per_koc: criteria.budget_min_per_koc } : {}),
        ...("budget_max_per_koc" in values ? { budget_max_per_koc: criteria.budget_max_per_koc } : {}),
        ...("koc_count" in values ? { koc_count: criteria.koc_count } : {}),
      });
      // có ngân sách rồi thì kế hoạch được phép có bước đề xuất
      const steps = [...basePlan.steps];
      if (!steps.some((s) => s.capability === "recommend")) steps.push({ capability: "recommend", title: CAPABILITIES.recommend.title });
      set.plan = sanitizePlan({ plan: steps, rank_by: basePlan.rank_by, questions: [] }, criteria);
    }
  }

  const roster_ids = new Set(rosterIds);
  const asked = (Array.isArray(out.creator_ids) ? out.creator_ids : []).map(String);

  if (intent === "exclude_koc") {
    const check = limitExclude(asked, new Set(picks.map((p) => p.creator_id)));
    if (!check.ok) {
      from = null;
      reply = check.reply!;
    } else {
      set.excluded_creator_ids = [...new Set([...((camp.excluded_creator_ids as string[]) ?? []), ...check.ids])];
    }
  }

  if (intent === "deepen") {
    // Luật khoá cứng: mỗi lượt chỉ xem video của 1 KOC được chỉ đích danh (xem chat-rules.ts)
    const check = wantsBulk(text) ? { ok: false as const, ids: [], reply: DEEPEN_TOO_MANY } : limitDeepen(asked, roster_ids);
    if (!check.ok) {
      from = null;
      reply = check.reply!;
    } else {
      set.deep_creator_ids = [...new Set([...((camp.deep_creator_ids as string[]) ?? []), ...check.ids])];
      const steps = [...basePlan.steps];
      if (!steps.some((s) => s.capability === "analyse_videos")) steps.push({ capability: "analyse_videos", title: CAPABILITIES.analyse_videos.title });
      set.plan = sanitizePlan({ plan: steps, rank_by: basePlan.rank_by, questions: [] }, (camp.criteria as Partial<Criteria>) ?? {});
      const name = nameOf.get(check.ids[0]) ?? check.ids[0];
      reply = reply || `Mình sẽ xem video của ${name} và cập nhật lại đánh giá.`;
    }
  }

  if (intent === "explain") {
    const explained = await explain(campaignId, text);
    reply = explained.answer || reply;
    reasons = explained.points;
    cost += explained.cost_usd;
  }

  // Xoá summary của bước phải chạy lại trở đi → pipeline dựng lại, phần đã cache vẫn 0 token
  const reruns: Capability[] = [];
  if (from) {
    const order = CAPABILITIES[from].order;
    for (const [cap, meta] of Object.entries(CAPABILITIES) as [Capability, { order: number }][]) {
      if (meta.order < order) continue;
      reruns.push(cap);
      unset[({ score_fit: "scoring", screen_content: "s3", analyse_videos: "s4", recommend: "s5" } as const)[cap]] = "";
    }
    unset.pipeline_error = "";
    set["pipeline.stage"] = "queued";
  }

  // Lượt chỉ hỏi han (hoặc bị luật chặn) thì không đụng gì tới chiến dịch
  const update = { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) };
  if (Object.keys(update).length && !opts.dryRun) await col.updateOne({ _id: campaignId as never }, update);
  return { intent, reply: reply || "Đã ghi nhận.", reruns, reasons, cost_usd: cost };
}

/**
 * Tóm tắt **kết luận hiện có của chiến dịch** để mọi lượt chat đều có cùng ngữ cảnh: đã chạy tới
 * bước nào, chọn ai, điểm và ngân sách ra sao, S3 nhận xét gì, S4 đã xem video của ai. Không có
 * khối này thì AI trả lời như chưa từng chạy chiến dịch ("KOC nào?", "xong chưa?" không biết đáp).
 * Mọi con số ở đây do code lấy từ DB.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function campaignState(campaignId: string, c: Record<string, any>, nameOf: Map<string, string>): Promise<string> {
  const db = await getDb();
  const m = (v?: number | null) => (v ? `${Math.round(v / 1e5) / 10} triệu` : "chưa đặt");
  const done: string[] = [];
  if (c.scoring) done.push(`đã lọc ${c.scoring.pool} KOC → ${c.scoring.eligible} đạt tiêu chí`);
  if (c.s3) done.push(`đã đọc nội dung ${c.s3.kocs} KOC`);
  if (c.s4) done.push(`đã xem ${c.s4.videos} video của ${c.s4.kocs} KOC`);
  if (c.s5) done.push(`đã chọn ${c.s5.picks.length} KOC và chia ngân sách ${m(c.s5.allocated)}`);

  const scores = await db
    .collection(C.campaignScores)
    .find({ campaign_id: campaignId, shortlisted: true })
    .sort(c.s4 ? { s4_rank: 1 } : c.s3 ? { s3_rank: 1 } : { rank: 1 })
    .limit(10)
    .toArray();
  const budgetOf = new Map(((c.s5?.picks ?? []) as { creator_id: string; budget: number }[]).map((p) => [p.creator_id, p.budget]));
  const lines = scores.map((s) => {
    const id = String(s.creator_id);
    const score = Math.round((s.s4_total ?? s.s3_total ?? s.total) as number);
    const bits = [`điểm ${score}`];
    if (budgetOf.has(id)) bits.push(`ngân sách ${m(budgetOf.get(id))}`);
    if (s.s3?.review_depth) bits.push(`review ${s.s3.review_depth}`);
    if (s.s3?.style) bits.push(String(s.s3.style).slice(0, 40));
    const vids = (s.s4?.videos ?? []) as { summary?: string }[];
    if (vids.length) bits.push(`đã xem ${vids.length} video: ${vids.map((v) => String(v.summary ?? "").slice(0, 60)).join(" / ")}`);
    return `- ${nameOf.get(id) ?? id} (id ${id}): ${bits.join(" · ")}`;
  });

  return [
    `Tiêu chí hiện tại: ${JSON.stringify(c.criteria ?? {})}`,
    `Tiến độ: ${done.length ? done.join("; ") : "chưa chạy bước nào"}${c.pipeline?.stage === "done" ? " — đã chạy xong" : c.pipeline?.stage ? ` — đang ở bước ${c.pipeline.stage}` : ""}`,
    lines.length ? `Kết luận về từng KOC (do code tính từ dữ liệu):\n${lines.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Trả lời câu hỏi bằng đúng bằng chứng đã có (0 lần chạy lại, 1 call Haiku). */
async function explain(campaignId: string, question: string): Promise<{ answer: string; points: Reason[]; cost_usd: number }> {
  const db = await getDb();
  const rows = await db.collection(C.campaignScores).find({ campaign_id: campaignId, shortlisted: true }).toArray();
  const ids = rows.flatMap((r) => (r.evidence_ids as string[]) ?? []);
  const evDocs = await db.collection(C.evidence).find({ _id: { $in: ids as never[] } }).toArray();
  const ev = new Map(evDocs.map((e) => [String(e._id), String(e.claim)]));
  if (!ev.size) return { answer: "Chiến dịch chưa có bằng chứng nào để mình dựa vào.", points: [], cost_usd: 0 };

  const creators = await db
    .collection(C.creators)
    .find({ _id: { $in: rows.map((r) => r.creator_id) as never[] } }, { projection: { handle: 1, nickname: 1 } })
    .toArray();
  const nameOf = new Map(creators.map((c) => [String(c._id), String(c.nickname || c.handle || c._id)]));
  const block = rows
    .slice(0, 12)
    .map((r) => {
      const list = ((r.evidence_ids as string[]) ?? []).filter((id) => ev.has(id)).map((id) => `  - ${id}: ${ev.get(id)}`);
      return `${nameOf.get(String(r.creator_id)) ?? r.creator_id}:\n${list.join("\n")}`;
    })
    .join("\n\n");

  const res = await claude({ system: EXPLAIN_SYSTEM, prompt: `Bằng chứng:\n${block}\n\nCâu hỏi: ${question}`, model: "haiku", purpose: "chat-explain" });
  const out = parseObject(res.text);
  const points = (Array.isArray(out.points) ? out.points : [])
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return { text: String(o.text ?? "").slice(0, 220), evidence_ids: (Array.isArray(o.evidence_ids) ? o.evidence_ids : []).map(String) };
    })
    .filter((p) => p.text);
  const { kept, dropped } = validateReasons(points, ev); // câu nào không có bằng chứng thật thì bỏ
  if (dropped.length) console.warn(`[chat] bỏ ${dropped.length}/${points.length} ý vì bằng chứng:`, dropped.map((d) => d.why).join(","));
  return { answer: String(out.answer ?? "").slice(0, 400), points: kept, cost_usd: res.cost_usd };
}
