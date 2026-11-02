import "server-only";
import { getDb } from "./db/mongo";
import { C } from "./db/collections";
import { claude, resolvedModelId } from "./llm/claude";
import { assessmentId, contentHash, getAssessments, saveAssessments } from "./ai/assessments";
import { creatorEvidence, creatorReport, ratioText, topProducts, type PeerRef, type ProductRef } from "./evidence/creator";
import { compact } from "./format";
import { creatorVideoEvidence, type VideoRef } from "./evidence/creator-video";
import { validateReasons, type Reason } from "./evidence/validate";
import { asksAboutVoice, NO_AUDIO } from "./chat-rules";
import type { AnswerBlock, AskEvent, DataBlockId, StepKind } from "./chat-events";
import type { ChatMessage } from "./chat";

/**
 * Hỏi đáp về MỘT KOC ở trang hồ sơ — không có chiến dịch, nên không chấm điểm, không chia ngân
 * sách, không chạy lại pipeline. Chỉ trả lời từ dữ liệu đã thu thập:
 *  - bằng chứng do code sinh (`evidence/creator.ts`), percentile so với toàn pool đã crawl
 *  - kết quả S3/S4 đã cache nếu KOC từng được phân tích (campaign-independent theo thiết kế)
 *
 * Mọi con số trong câu trả lời phải nằm trong bằng chứng được trích, nếu không `validateReasons`
 * loại bỏ ý đó — cùng một hàng rào như S5.
 */
export const CREATOR_CHAT_VERSION = "koc-chat-v3";
const HISTORY_TURNS = 8;

/**
 * Vá lỗi hay gặp nhất của model: **dấu nháy kép chưa escape bên trong chuỗi** — vd
 * `"text": "Video "Ai đang phân vân..." có demo tốt"`. Một dấu `"` chỉ được coi là đóng chuỗi khi
 * ký tự kế tiếp (bỏ khoảng trắng) là `,` `:` `}` `]` hoặc hết chuỗi; còn lại thì escape nó.
 */
function repairQuotes(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inStr) {
      out += ch;
      if (ch === '"') inStr = true;
      continue;
    }
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      if (/^\s*([,:}\]]|$)/.test(s.slice(i + 1))) {
        out += ch;
        inStr = false;
      } else out += '\\"';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Đọc object JSON trong câu trả lời của model. Cách cũ (cắt từ `{` đầu tới `}` cuối) hỏng khi model
 * viết kèm văn xuôi có dấu ngoặc nhọn — đã gặp một lần model trả 8.658 token và câu trả lời thành
 * rỗng. Ở đây duyệt từng vị trí `{`, cân bằng ngoặc để lấy đúng một object, thử parse tới khi được.
 */
const parseObject = (text: string): Record<string, unknown> => {
  for (let i = text.indexOf("{"); i >= 0; i = text.indexOf("{", i + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        const raw = text.slice(i, j + 1);
        for (const candidate of [raw, repairQuotes(raw)]) {
          try {
            const o = JSON.parse(candidate) as Record<string, unknown>;
            if (o && typeof o === "object" && Object.keys(o).length) return o;
          } catch {
            /* thử bản đã vá, rồi tới vị trí `{` tiếp theo */
          }
        }
        break;
      }
    }
  }
  console.warn("[koc-chat] không đọc được JSON từ model:", text.slice(0, 200));
  return {};
};

/**
 * Một bước phân tích để hiển thị cho người dùng thấy AI đã làm gì (nội dung do code viết).
 * `kind` cho giao diện biết **dẫn chứng nào thuộc bước nào** — trước đây mọi dẫn chứng bị đổ chung
 * một khối nên người dùng không biết đâu là kết luận.
 */
export interface AnalysisStep {
  title: string;
  detail: string;
  kind?: "data" | "peers" | "videos" | "conclusion";
}

export interface CreatorChatOutcome {
  reply: string;
  reasons: Reason[];
  /** Các bước đã chạy để ra kết luận. */
  steps?: AnalysisStep[];
  /** Nhóm KOC cùng tầm dùng để đối chuẩn. */
  peers?: PeerRef[];
  /** Sản phẩm kèm ảnh bìa để hiển thị làm dẫn chứng trực quan. */
  products?: ProductRef[];
  /** Video đã được AI xem (khung hình) làm dẫn chứng cho kết luận về nội dung. */
  videos?: VideoRef[];
  cost_usd: number;
}

/** Nhận định AI đã có sẵn về KOC này (S3) và về video của họ (S4) — lấy từ cache, 0 token. */
async function aiNotes(creatorId: string): Promise<string> {
  const db = await getDb();
  const rows = await db.collection(C.campaignScores).find({ creator_id: creatorId, $or: [{ s3: { $exists: true } }, { s4: { $exists: true } }] }).sort({ created_at: -1 }).limit(1).toArray();
  const r = rows[0];
  if (!r) return "";
  const out: string[] = [];
  if (r.s3)
    out.push(
      `Nhận định nội dung (AI): phong cách ${r.s3.style ?? "không rõ"}; mức độ review ${r.s3.review_depth ?? "không rõ"}${
        (r.s3.niches ?? []).length ? `; chủ đề ${(r.s3.niches as string[]).join(", ")}` : ""
      }${(r.s3.risks ?? []).length ? `; lưu ý ${(r.s3.risks as string[]).join("; ")}` : ""}`,
    );
  for (const v of (r.s4?.videos ?? []) as { title?: string; summary?: string; product_demo?: string }[])
    out.push(`Nhận định video (AI): "${String(v.title ?? "").slice(0, 60)}" — demo ${v.product_demo ?? "không rõ"}; ${String(v.summary ?? "").slice(0, 90)}`);
  return out.length ? `${out.join("\n")}\n(Đây là nhận định do AI viết, không phải số liệu.)` : "";
}

/**
 * Trả lời **đúng câu hỏi** từ bằng chứng đã có.
 *
 * Cache theo `(KOC, hash bằng chứng, hash CÂU HỎI, model, phiên bản prompt)` — câu hỏi nằm trong
 * khoá, nếu không thì mọi câu hỏi khác nhau sẽ nhận lại cùng một câu trả lời (lỗi đã gặp: hỏi
 * "chất lượng nội dung ra sao" lại nhận đúng bản đánh giá tổng quan). Hỏi lại **đúng câu đó** mới
 * là 0 token; phần đắt tiền (phân tích video) vẫn cache riêng theo video nên không trả lại.
 */
export const ANSWER_PROMPT_VERSION = "koc-answer-v9";

/**
 * **ĐANG TẮT CACHE CÂU TRẢ LỜI** (2026-11-02) — giai đoạn đang chỉnh chất lượng phân tích.
 *
 * Lý do: cache khoá theo `(KOC, bằng chứng, câu hỏi, prompt)` nên khi prompt/bằng chứng vừa đổi,
 * bộ test vẫn nhận lại **bản trả lời cũ** và che mất lỗi thật — đã mất mấy lượt chạy chỉ vì điều
 * này (ca báo "blocks rỗng" với giá $0 hoá ra là bản cache hỏng, không phải lỗi logic).
 *
 * Bật lại bằng `KOC_ANSWER_CACHE=1` trong `.env.local` khi chất lượng đã ổn định — lúc đó hỏi lại
 * cùng một câu sẽ về 0 token như trước. Phân tích video (`video_analysis`) **không** bị ảnh hưởng:
 * nó cache riêng theo video nên vẫn không tốn lại tiền.
 */
const ANSWER_CACHE_ENABLED = process.env.KOC_ANSWER_CACHE === "1";

/** Mô tả từng bảng cho model biết nó chứa gì (model chỉ chọn chèn, không viết số). */
const DATA_LABEL: Record<DataBlockId, string> = {
  overview: "tổng quan 30 ngày (doanh thu, số sản phẩm, số video, follower)",
  categories: "bảng danh mục bán chủ lực kèm doanh thu và tỉ trọng",
  top_products: "bảng top 10 sản phẩm bán chạy kèm doanh thu và tỉ trọng",
  peers: "danh sách KOC cùng quy mô follower để đối chuẩn",
  videos: "các video AI đã xem kèm nhận định",
};

const HIGHLIGHTS_SYSTEM = `[${ANSWER_PROMPT_VERSION}] Bạn trả lời câu hỏi của người bán về một KOC TikTok mỹ phẩm Việt Nam.
TRẢ LỜI ĐÚNG TRỌNG TÂM CÂU HỎI: hỏi về nội dung/video thì nói về nội dung và video; hỏi về doanh thu thì nói về doanh thu; không kể lể mọi chỉ số có trong bằng chứng.
Chỉ dựa vào danh sách bằng chứng {id, claim}. Mọi con số viết bằng CHỮ SỐ và chép đúng từ claim. Dùng đúng nhãn mức trong claim (nhóm dẫn đầu / trên trung bình / quanh mức trung bình / dưới trung bình / nhóm thấp), không tự nâng hay hạ.
Khi có claim về NHÓM CÙNG TẦM: bắt buộc có ít nhất một ý so sánh với nhóm đó, và nêu tên KOC đối chiếu nếu claim có tên. Không được trả lời chung chung kiểu "doanh thu cao" mà bỏ qua phần đối chuẩn.
Văn phong: tiếng Việt tự nhiên như người tư vấn nói chuyện với người bán hàng; câu hoàn chỉnh, không viết kiểu liệt kê cụt lủn hay dịch máy ("nhân tố mạnh mẽ", "tuyệt đối ưu việt" là sai văn phong).
Trong nội dung chuỗi JSON KHÔNG được dùng dấu nháy kép (trích tên video/sản phẩm thì dùng nháy đơn), vì nó làm hỏng JSON.

**BẠN TỰ DỰNG BỐ CỤC BÀI TRẢ LỜI** — không có khuôn cố định. Câu hỏi đơn giản thì 1 đoạn văn ngắn là đủ;
câu cần phân tích sâu thì mới chia tiêu đề, chèn bảng, liệt kê. Chỉ chèn bảng khi bảng đó thực sự trả lời câu hỏi.
Khối ĐẦU TIÊN luôn là một "para" trả lời thẳng câu hỏi trong 1-2 câu; đừng mở đầu bằng tiêu đề.
**TOÀN BỘ nội dung người dùng đọc nằm ở "blocks"** — "blocks" rỗng nghĩa là không trả lời gì cả.
Mọi con số chỉ được viết trong "para"/"bullets" và PHẢI kèm "evidence_ids"; câu có số mà thiếu evidence_ids sẽ bị xoá khỏi câu trả lời.
Ví dụ câu hỏi đơn giản ("khán giả là ai?") chỉ cần:
{"summary":"Khán giả chủ yếu là nữ trẻ.","blocks":[{"type":"para","text":"Khán giả chủ yếu là nữ, nhóm tuổi 25-34.","evidence_ids":["ev_koc_123_audience"]}],"follow_ups":[...]}

Trả về DUY NHẤT 1 object JSON:
{"summary": 1 câu tiếng Việt chốt lại, KHÔNG chứa con số — chỉ dùng nội bộ (đặt tên cuộc trò chuyện), NGƯỜI DÙNG KHÔNG THẤY câu này,
 "blocks": mảng các khối, tự chọn thứ tự và số lượng:
   {"type":"para","text":"đoạn văn tiếng Việt","evidence_ids":[...]} — có con số thì BẮT BUỘC trích bằng chứng
   {"type":"heading","text":"tiêu đề ngắn"} — chỉ dùng khi bài dài, cần chia phần
   {"type":"bullets","items":[{"text":"...","evidence_ids":[...]}]} — các ý rời, mỗi ý trích bằng chứng
   {"type":"data","data":"<id>","title":"tiêu đề bảng"} — chèn bảng số liệu do hệ thống dựng (bạn KHÔNG viết số)
   {"type":"closing","text":"1 câu mời người dùng hỏi tiếp, không chứa con số"}
 "follow_ups": 2-3 câu hỏi gợi ý tiếp theo (≤ 20 từ) mà hệ thống TRẢ LỜI ĐƯỢC từ dữ liệu hiện có — chỉ xoay quanh chính KOC này: danh mục/sản phẩm đã bán, doanh thu và độ ổn định, tương tác, khán giả, so sánh với nhóm cùng tầm, nội dung/demo trong video, chi phí ước tính. KHÔNG hỏi về giọng nói, xu hướng thị trường, dữ liệu ngoài KOC này, hay kịch bản livestream.}`;

/**
 * **Code chọn sẵn bằng chứng trọng tâm** cho câu hỏi, thay vì để model tự mò trong ~20 claim.
 *
 * Lỗi đã gặp (bộ test `metrics-*`): hỏi "doanh thu có ổn định không" thì model viết đoạn đúng ý
 * nhưng trích `..._revenue` chứ không trích `..._consistency`; hỏi tương tác thì trích `_views`.
 * Đây không phải nới kiểm chứng — chỉ là chỉ cho model *chỗ nên đọc*; `validateReasons()` và
 * `autoCite()` vẫn soi từng con số như trước.
 *
 * Lưu ý: `\b` không khớp tiếng Việt có dấu nên các mẫu dưới đây không dùng `\b`.
 */
const EVIDENCE_TOPICS: { re: RegExp; keys: string[] }[] = [
  { re: /ổn định|đều|thất thường|bấp bênh|duy trì|liên tục|bao nhiêu ngày|theo ngày/i, keys: ["consistency", "revenue", "sales"] },
  { re: /tương tác|engagement|like|lượt thích|bình luận|comment|chia sẻ/i, keys: ["engagement", "views", "followers"] },
  { re: /lượt xem|view|độ phủ|reach/i, keys: ["views", "engagement"] },
  { re: /so (với|sánh)|cùng tầm|cùng quy mô|đối chuẩn|xếp hạng|hơn ai|thứ mấy|mặt bằng/i, keys: ["peer_revenue", "peer_engagement", "peer_top"] },
  { re: /bán hàng|doanh thu|doanh số|hiệu suất|bán được|gmv|chuyển đổi|live/i, keys: ["revenue", "sales", "live_conversion", "channel_mix"] },
  { re: /danh mục|mặt hàng|bán gì|bán chạy|sản phẩm/i, keys: ["category_mix", "subcategory_mix", "products", "brand_focus"] },
  { re: /thương hiệu|brand|phụ thuộc|độc lập/i, keys: ["brand_focus", "independence", "products"] },
  { re: /liên hệ|liên lạc|contact|email|zalo|số điện thoại|inbox/i, keys: ["contact"] },
  { re: /mcn|công ty|đại diện|quản lý|follower|người theo dõi|quy mô/i, keys: ["followers", "contact"] },
  { re: /chi phí|giá|booking|báo giá|bao nhiêu tiền|ngân sách|thuê/i, keys: ["cost", "followers"] },
  { re: /khán giả|người xem|đối tượng|tệp khách|độ tuổi|giới tính|nữ|nam/i, keys: ["audience", "followers"] },
];

/**
 * Các `evidence_id` đáng trích nhất cho câu hỏi này (đã lọc theo bằng chứng thật sự có).
 * Câu hỏi về nội dung thì ưu tiên toàn bộ claim video (`_video_...`).
 */
function focusEvidenceIds(question: string, ev: Map<string, string>): string[] {
  const wanted = new Set<string>();
  for (const t of EVIDENCE_TOPICS) if (t.re.test(question)) for (const k of t.keys) wanted.add(k);
  const ids: string[] = [];
  for (const id of ev.keys()) {
    const key = id.replace(/^ev_koc_\d+_/, "");
    if (key.startsWith("video_") ? /nội dung|review|demo|video|clip|hình ảnh|lên hình/i.test(question) : wanted.has(key)) ids.push(id);
  }
  return ids.slice(0, 8);
}

export interface Highlights {
  summary: string;
  points: Reason[];
  caution: Reason | null;
  /** Bố cục bài trả lời do model tự dựng (đã lọc khối không hợp lệ). */
  blocks?: AnswerBlock[];
  /** Câu hỏi gợi ý tiếp theo — chỉ giữ những câu hệ thống thật sự trả lời được. */
  follow_ups?: string[];
}

/**
 * Tự tìm nguồn cho một câu có số nhưng model quên gắn `evidence_ids`.
 *
 * Đây **không phải nới lỏng kiểm chứng**: vẫn đòi mọi con số trong câu phải xuất hiện trong claim
 * được trích. Khác biệt là code tự dò xem claim nào chứa đủ các số đó thay vì bắt model nhớ gắn id —
 * model quên gắn id là chuyện thường xuyên, và hậu quả trước đây là xoá sạch nội dung, chỉ còn câu
 * dẫn trống rỗng.
 */
function autoCite(text: string, ev: Map<string, string>, focus: string[] = []): string[] {
  const nums = (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
  if (!nums.length) return [];
  const ids: string[] = [];
  const covered = new Set<string>();
  // Dò bằng chứng trọng tâm TRƯỚC: cùng một con số có thể nằm trong nhiều claim (vd doanh thu ngày
  // cao nhất xuất hiện ở cả `_revenue` và `_consistency`), thứ tự map sẽ gắn nguồn lệch trọng tâm.
  const ordered: [string, string][] = [
    ...focus.filter((f) => ev.has(f)).map((f) => [f, ev.get(f)!] as [string, string]),
    ...[...ev.entries()].filter(([id]) => !focus.includes(id)),
  ];
  for (const [id, claim] of ordered) {
    const inClaim = new Set((claim.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, "")));
    const hits = nums.filter((n) => inClaim.has(n));
    if (!hits.length) continue;
    ids.push(id);
    for (const h of hits) covered.add(h);
    if (covered.size === new Set(nums).size) break;
  }
  // Chỉ nhận khi MỌI con số đều tìm được nguồn; thiếu một số là câu vẫn bị loại như trước
  return covered.size === new Set(nums).size ? ids : [];
}

/**
 * Lọc bố cục model trả về: bỏ khối sai loại, bỏ bảng mà bước tương ứng chưa chạy (không có dữ liệu
 * thì không được chèn), và cho mọi câu chữ có số đi qua `validateReasons`.
 */
function sanitizeBlocks(raw: unknown, ev: Map<string, string>, available: Set<DataBlockId>, focus: string[] = []): AnswerBlock[] {
  const out: AnswerBlock[] = [];
  const hasDigit = (s: string) => /\d/.test(s);
  const keep = (text: string, ids: string[]) => validateReasons([{ text, evidence_ids: ids }], ev).kept.length > 0;

  for (const b of Array.isArray(raw) ? raw : []) {
    const o = (b ?? {}) as Record<string, unknown>;
    const text = String(o.text ?? "").trim();
    switch (String(o.type)) {
      case "heading":
        if (text) out.push({ type: "heading", text: text.slice(0, 90) });
        break;
      case "para": {
        if (!text) break;
        const ids = (Array.isArray(o.evidence_ids) ? o.evidence_ids : []).map(String);
        // Đoạn có số mà không dẫn được nguồn thì bỏ hẳn — đây là chỗ dễ bịa nhất
        let cite = ids;
        if (hasDigit(text) && !keep(text, cite)) cite = autoCite(text, ev, focus); // model hay quên gắn id
        if (hasDigit(text) && !keep(text, cite)) {
          console.warn("[koc-answer] bỏ đoạn vì số không có nguồn:", text.slice(0, 90));
          break;
        }
        out.push({ type: "para", text: text.slice(0, 600), evidence_ids: cite });
        break;
      }
      case "bullets": {
        const items = (Array.isArray(o.items) ? o.items : [])
          .map((i) => {
            const x = (i ?? {}) as Record<string, unknown>;
            return { text: String(x.text ?? "").trim().slice(0, 260), evidence_ids: (Array.isArray(x.evidence_ids) ? x.evidence_ids : []).map(String) };
          })
          .map((i) => (hasDigit(i.text) && !keep(i.text, i.evidence_ids) ? { ...i, evidence_ids: autoCite(i.text, ev, focus) } : i))
          .filter((i) => i.text && (!hasDigit(i.text) || keep(i.text, i.evidence_ids)));
        if (items.length) out.push({ type: "bullets", items });
        break;
      }
      case "data": {
        const id = String(o.data ?? "") as DataBlockId;
        if (available.has(id)) out.push({ type: "data", data: id, title: text ? text.slice(0, 90) : undefined });
        break;
      }
      case "closing":
        if (text && !hasDigit(text)) out.push({ type: "closing", text: text.slice(0, 220) });
        break;
    }
  }
  return out;
}

/**
 * Bài trả lời không được mở đầu bằng một cái bảng trơ. Đoạn dẫn của model có thể bị bộ lọc xoá
 * (viết số mà quên trích nguồn), nên khi đó dùng chính `summary` — câu một dòng do model viết,
 * không chứa số nên không cần kiểm bằng chứng. Áp cho cả bản mới lẫn bản lấy từ cache.
 */
function withLeadParagraph(d: Highlights): Highlights {
  const summary = (d.summary ?? "").trim();
  if (!summary) return d;
  const blocks = [...(d.blocks ?? [])];
  if (blocks[0]?.type !== "para") blocks.unshift({ type: "para", text: summary.slice(0, 400) });
  return { ...d, blocks };
}

export async function creatorHighlights(
  creatorId: string,
  ev: Map<string, string>,
  question: string,
  /** Ngữ cảnh thêm: lịch sử hội thoại + nhận định S3/S4 đã có. Nằm trong khoá cache để không lẫn. */
  context = "",
  /** Bảng số liệu đang có sẵn (theo các bước đã chạy) — model chỉ được chèn trong số này. */
  available: DataBlockId[] = [],
): Promise<{ data: Highlights; cost_usd: number; cached: boolean }> {
  const modelId = await resolvedModelId("haiku");
  const focus = focusEvidenceIds(question, ev);
  const hash = contentHash({ ev: [...ev.entries()].sort(), q: question.trim().toLowerCase(), context, available: [...available].sort(), focus });
  const id = assessmentId("creator_answer", creatorId, hash, modelId, ANSWER_PROMPT_VERSION);
  const hit = ANSWER_CACHE_ENABLED ? (await getAssessments<Highlights>([id])).get(id) : undefined;
  // Chuẩn hoá cả bản lấy từ cache: bản cũ có thể thiếu câu dẫn (sinh trước khi vá)
  if (hit) return { data: withLeadParagraph(hit.result), cost_usd: 0, cached: true };

  const res = await claude({
    system: HIGHLIGHTS_SYSTEM,
    prompt: [
      `Bằng chứng:\n${[...ev.entries()].map(([k, v]) => `- ${k}: ${v}`).join("\n")}`,
      // Code đã khoanh vùng chỗ nên đọc — model vẫn được dùng claim khác, chỉ là phải bám trọng tâm
      focus.length
        ? `TRỌNG TÂM CÂU HỎI nằm ở các bằng chứng sau — ít nhất một ý trong câu trả lời PHẢI trích id trong danh sách này:\n${focus.map((f) => `- ${f}`).join("\n")}`
        : "",
      available.length
        ? `Bảng số liệu có thể chèn (dùng đúng id này ở khối "data"):\n${available.map((a) => `- ${a}: ${DATA_LABEL[a]}`).join("\n")}`
        : "Hiện không có bảng số liệu nào để chèn — chỉ viết chữ.",
      context,
      `Câu hỏi của người bán: ${question}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    model: "haiku",
    purpose: "koc-answer",
  });
  const out = parseObject(res.text);
  const toReason = (p: unknown): Reason => {
    const o = (p ?? {}) as Record<string, unknown>;
    return { text: String(o.text ?? "").slice(0, 220), evidence_ids: (Array.isArray(o.evidence_ids) ? o.evidence_ids : []).map(String) };
  };
  const points = validateReasons((Array.isArray(out.points) ? out.points : []).map(toReason).filter((p) => p.text), ev).kept;
  const caution = out.caution ? validateReasons([toReason(out.caution)].filter((p) => p.text), ev).kept[0] ?? null : null;
  // Lọc gợi ý: bỏ câu hỏi về giọng nói/âm thanh (hệ thống không trả lời được — xem chat-rules.ts)
  const follow_ups = (Array.isArray(out.follow_ups) ? out.follow_ups : [])
    .filter((q): q is string => typeof q === "string" && q.trim().length > 8)
    .map((q) => q.trim().slice(0, 120))
    .filter((q) => !asksAboutVoice(q))
    .slice(0, 3);
  const blocks = sanitizeBlocks(out.blocks, ev, new Set(available), focus);
  // `points` giữ lại để tương thích (tiêu đề cuộc trò chuyện, bộ test, tin nhắn cũ): gom từ blocks
  const fromBlocks: Reason[] = blocks.flatMap((b) =>
    b.type === "bullets" ? b.items : b.type === "para" && b.evidence_ids?.length ? [{ text: b.text, evidence_ids: b.evidence_ids }] : [],
  );
  const data = withLeadParagraph({ summary: String(out.summary ?? "").slice(0, 400), points: points.length ? points : fromBlocks, caution, blocks, follow_ups });

  // Chỉ cache khi thật sự có câu trả lời: cache một kết quả rỗng sẽ khiến mọi lần hỏi lại đều
  // nhận "chưa trả lời được" với giá 0 token, che mất lỗi thật (đã gặp đúng tình huống này).
  // Không ý nào có nguồn = câu trả lời không kiểm chứng được → coi như hỏng, không cache
  if (!data.points.length) console.warn("[koc-answer] không có ý nào trích được bằng chứng", { creatorId, question: question.slice(0, 80) });
  if (ANSWER_CACHE_ENABLED && (data.points.length || data.blocks?.length)) {
    await saveAssessments<Highlights>([
      { _id: assessmentId("creator_answer", creatorId, hash, res.model_id, ANSWER_PROMPT_VERSION), kind: "creator_answer", subject_id: creatorId, content_hash: hash, model_id: res.model_id, prompt_version: ANSWER_PROMPT_VERSION, result: data, created_at: new Date() },
    ]);
  } else {
    console.warn("[koc-answer] model không trả về nội dung dùng được, không cache", { creatorId, question: question.slice(0, 80) });
  }
  return { data, cost_usd: res.cost_usd, cached: false };
}

/**
 * Đánh dấu KOC nào trong nhóm cùng tầm **đã có sẵn phân tích trong cache** — người dùng bấm sang
 * hồ sơ họ là có kết quả ngay, không tốn token.
 */
async function markAnalysed(peers: PeerRef[]): Promise<PeerRef[]> {
  if (!peers.length) return peers;
  const db = await getDb();
  const ids = peers.map((p) => p.creator_id);
  const rows = await db
    .collection(C.aiAssessments)
    .find({ kind: { $in: ["creator_highlights", "content_screen"] }, subject_id: { $in: ids } }, { projection: { subject_id: 1 } })
    .toArray();
  const done = new Set(rows.map((r) => String(r.subject_id)));
  return peers.map((p) => ({ ...p, analysed: done.has(p.creator_id) }));
}

/**
 * Kế hoạch phân tích **đọc từ chính câu hỏi**: AI chọn các bước cần chạy trong danh sách năng lực
 * có thật và tự đặt tên bước theo câu hỏi. Trước đây kế hoạch cứng 4 bước nên câu hỏi nào cũng ra
 * một quy trình y hệt.
 */
export const PLAN_PROMPT_VERSION = "koc-plan-v1";

/** Năng lực có thật — AI không được bịa bước ngoài danh sách này. */
const CAPS = {
  profile: "Đọc hồ sơ KOC",
  read_data: "Đọc dữ liệu 30 ngày của KOC",
  peers: "Lập nhóm cùng tầm & so sánh",
  videos: "Xem video bằng AI",
  answer: "Tổng hợp câu trả lời",
} as const;
type Cap = keyof typeof CAPS;
const CAP_ORDER: Cap[] = ["profile", "read_data", "peers", "videos", "answer"];

const PLAN_SYSTEM = `[${PLAN_PROMPT_VERSION}] Bạn lập kế hoạch phân tích để trả lời câu hỏi của người bán về MỘT KOC TikTok mỹ phẩm.
Chỉ được dùng các bước có sẵn:
- "profile": đọc hồ sơ KOC (handle TikTok, MCN, kênh liên hệ công khai, số follower, khán giả) — dùng cho câu hỏi về liên hệ, MCN, quy mô, thông tin cơ bản. RẺ, không cần số liệu bán hàng.
- "read_data": đọc chỉ số 30 ngày trong DB (doanh thu, lượt xem, tương tác, sản phẩm đã bán, độ ổn định theo ngày) — chỉ chọn khi câu hỏi liên quan tới bán hàng, doanh thu, sản phẩm, danh mục, hiệu suất.
- "peers": lập nhóm KOC cùng quy mô follower và so sánh — chỉ khi câu hỏi cần đối chuẩn/so sánh/xếp hạng.
- "videos": AI xem khung hình video — chỉ khi câu hỏi liên quan nội dung, cách review, demo sản phẩm, chất lượng hình ảnh, cách lên hình.
- "answer": tổng hợp câu trả lời — LUÔN cần, luôn là bước cuối.
Trả về DUY NHẤT 1 object JSON: {"steps":[{"capability":"...","title":"câu tiếng Việt ngắn mô tả bước đó theo đúng câu hỏi"}]}
**Đừng chọn thừa bước** — mỗi bước thừa làm người dùng thấy dữ liệu không liên quan:
- Hỏi liên hệ / MCN / follower → chỉ "profile" + "answer".
- Hỏi danh mục, sản phẩm, doanh thu, độ ổn định → "read_data" + "answer".
- Hỏi chi phí hợp tác → "profile" + "answer" (chi phí ước tính theo bậc follower).
- Chỉ thêm "peers" khi câu hỏi có ý so sánh/xếp hạng; chỉ thêm "videos" khi hỏi về nội dung, cách review, demo, hình ảnh.`;

async function planAnalysis(question: string): Promise<{ steps: { capability: Cap; title: string }[]; cost_usd: number }> {
  let raw: Record<string, unknown> = {};
  let cost = 0;
  try {
    const res = await claude({ system: PLAN_SYSTEM, prompt: `Câu hỏi: ${question}`, model: "haiku", purpose: "koc-plan" });
    raw = parseObject(res.text);
    cost = res.cost_usd;
  } catch (err) {
    console.error("[koc-plan] lỗi, dùng kế hoạch mặc định", err);
  }

  const seen = new Map<Cap, string>();
  for (const s of Array.isArray(raw.steps) ? raw.steps : []) {
    const o = (s ?? {}) as Record<string, unknown>;
    const cap = String(o.capability ?? "") as Cap;
    if (!CAP_ORDER.includes(cap) || seen.has(cap)) continue;
    seen.set(cap, typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 90) : CAPS[cap]);
  }
  /**
   * Ràng buộc cứng bằng code: câu hỏi về bán hàng thì **phải** có bước đọc chỉ số, không để planner
   * tự quyết. Đã gặp: hỏi "chủ yếu bán danh mục và sản phẩm nào" mà planner chỉ chọn "profile",
   * nên giao diện mất bảng danh mục và top sản phẩm.
   */
  const SALES = /danh mục|sản phẩm|doanh thu|bán hàng|bán gì|mặt hàng|hiệu suất|ổn định|lượt xem|tương tác|top|bán chạy|thương hiệu|brand/i;
  /**
   * Câu hỏi về nội dung/hình ảnh thì **phải** xem video. Lưu ý: "demo sản phẩm" cũng khớp SALES
   * ở trên (vì có chữ "sản phẩm"), nên nếu không ép riêng thì planner có thể chỉ đọc chỉ số —
   * đúng lỗi bộ test bắt được ở ca `content-demo`.
   */
  // Không khớp chữ "video" trần: "bao nhiêu một video" là đơn vị tính giá, không phải hỏi nội dung
  const CONTENT_Q =
    /nội dung|review|demo|quay (phim|video|clip)|hình ảnh|chỉn chu|lên hình|cách giới thiệu|(xem|chất lượng|phong cách|phân tích)[^.?!]{0,14}video|video[^.?!]{0,20}(demo|review|chất lượng|nội dung|thế nào|ra sao|có hay)/i;
  /** Chỉ ép đọc chỉ số khi câu hỏi thật sự nói về bán hàng, không phải vì trùng chữ "sản phẩm". */
  const SALES_STRICT = /danh mục|doanh thu|bán hàng|bán gì|mặt hàng|hiệu suất|ổn định|lượt xem|tương tác|bán chạy|thương hiệu|brand|top \d/i;
  if (CONTENT_Q.test(question)) seen.set("videos", seen.get("videos") ?? CAPS.videos);
  if (CONTENT_Q.test(question) ? SALES_STRICT.test(question) : SALES.test(question)) seen.set("read_data", seen.get("read_data") ?? CAPS.read_data);
  if (!seen.has("profile") && !seen.has("read_data")) seen.set("profile", CAPS.profile);
  if (!seen.has("answer")) seen.set("answer", CAPS.answer);
  return { steps: CAP_ORDER.filter((c) => seen.has(c)).map((c) => ({ capability: c, title: seen.get(c)! })), cost_usd: cost };
}

/**
 * Luồng phân tích phát sự kiện theo **từng bước**: gửi kế hoạch trước, rồi chạy và trả kết quả
 * từng bước một, cuối cùng mới tới kết luận. Giao diện nhờ đó hiện dần thay vì quay vòng chờ cả
 * phút. `handleCreatorTurn` bên dưới chỉ là bản gom hết sự kiện lại (dùng cho CLI/kịch bản test),
 * nên logic chỉ có một nguồn duy nhất.
 */
export async function* analyseCreatorStream(creatorId: string, text: string, threadId?: string): AsyncGenerator<AskEvent> {
  // Luật khoá cứng: không có audio thì nói thẳng, không bày kế hoạch cho có
  if (asksAboutVoice(text)) {
    yield { type: "plan", steps: [{ title: "Kiểm tra phạm vi dữ liệu", kind: "conclusion" }] };
    yield { type: "step_start", index: 0 };
    yield { type: "step_done", index: 0, detail: "Dữ liệu video chỉ có khung hình, không có âm thanh" };
    yield { type: "conclusion", text: NO_AUDIO, reasons: [] };
    yield { type: "done", cost_usd: 0 };
    return;
  }

  const db = await getDb();
  const creator = await db.collection(C.creators).findOne({ _id: creatorId as never });
  if (!creator) {
    yield { type: "error", message: "Không tìm thấy KOC" };
    return;
  }

  // Kế hoạch do AI đọc từ chính câu hỏi (danh sách bước là đóng, thứ tự do code ép)
  const { steps: plan, cost_usd: planCost } = await planAnalysis(text);
  const at = (c: Cap) => plan.findIndex((s) => s.capability === c);
  const KIND_OF: Record<Cap, StepKind> = { profile: "data", read_data: "data", peers: "peers", videos: "videos", answer: "conclusion" };
  yield { type: "plan", steps: plan.map((s) => ({ title: s.title, kind: KIND_OF[s.capability] })) };
  let cost = planCost;
  const salesFocus = at("read_data") >= 0; // câu hỏi có liên quan bán hàng/sản phẩm hay không

  // ── Đọc dữ liệu + bằng chứng (code, 0 token) ──
  const readIdx = salesFocus ? at("read_data") : at("profile");
  yield { type: "step_start", index: readIdx };
  const { claims: ev, peers } = await creatorEvidence(creatorId);
  if (!ev.size) {
    yield { type: "step_done", index: readIdx, detail: "Chưa có dữ liệu đã thu thập cho KOC này" };
    yield { type: "conclusion", text: "Mình chưa có đủ dữ liệu đã thu thập về KOC này để trả lời.", reasons: [] };
    yield { type: "done", cost_usd: cost };
    return;
  }
  // Hỏi về hồ sơ/liên hệ thì KHÔNG kèm thẻ sản phẩm — dẫn chứng không liên quan chỉ làm nhiễu
  const products = salesFocus ? await topProducts(creatorId) : [];
  yield {
    type: "step_done",
    index: readIdx,
    detail: salesFocus
      ? `${ev.size} chỉ số từ DB: doanh thu, lượt xem, tương tác, sản phẩm, độ ổn định theo ngày`
      : `Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả`,
    payload: salesFocus ? { products } : undefined,
  };

  // ── Nhóm cùng tầm (code, 0 token) — chỉ khi kế hoạch có ──
  if (at("peers") >= 0) {
    yield { type: "step_start", index: at("peers") };
    yield {
      type: "step_done",
      index: at("peers"),
      detail: peers
        ? `${peers.count} KOC mỹ phẩm ${compact(peers.band.lo)}–${compact(peers.band.hi)} follower · doanh thu ${ratioText(peers.my_revenue, peers.median_revenue)} · tương tác ${ratioText(
            peers.my_engagement,
            peers.median_engagement,
          )}`
        : "Chưa đủ 5 KOC cùng quy mô follower trong dữ liệu đã thu thập để đối chuẩn",
      payload: { peers: await markAnalysed(peers?.top ?? []) },
    };
  }

  // ── Xem video (dùng chung cache với S4) — chỉ khi kế hoạch có ──
  const videoClaims = new Map<string, string>();
  if (at("videos") >= 0) {
    yield { type: "step_start", index: at("videos") };
    const vid = await creatorVideoEvidence(creatorId);
    cost += vid.cost_usd;
    for (const [k, v] of vid.claims) videoClaims.set(k, v);
    yield {
      type: "step_done",
      index: at("videos"),
      detail: vid.videos.length ? `Đã xem ${vid.videos.length} video, mỗi video 4 khung hình` : "Chưa lấy được khung hình video của KOC này",
      payload: { videos: vid.videos },
    };
  }

  // ── Trả lời đúng câu hỏi (cache có cả câu hỏi trong khoá) ──
  yield { type: "step_start", index: at("answer") };
  // Ngữ cảnh: các lượt trước trong cùng cuộc trò chuyện + nhận định S3/S4 đã có (0 token)
  const chat = threadId ? await db.collection(C.creatorChats).findOne({ _id: threadId as never }) : null;
  const history = ((chat?.messages as ChatMessage[]) ?? [])
    .slice(-HISTORY_TURNS)
    .map((m) => `${m.role === "user" ? "Người dùng" : "Bạn"}: ${m.text}`)
    .join("\n");
  const context = [history ? `Hội thoại trước đó:\n${history}` : "", await aiNotes(creatorId)].filter(Boolean).join("\n\n");
  // Bảng nào đang thực sự có dữ liệu thì mới cho model chèn
  const available: DataBlockId[] = [];
  if (salesFocus) available.push("overview", "categories", "top_products");
  if (at("peers") >= 0 && peers) available.push("peers");
  if (at("videos") >= 0 && videoClaims.size) available.push("videos");
  const h = await creatorHighlights(creatorId, new Map([...ev, ...videoClaims]), text, context, available);
  cost += h.cost_usd;
  // Bảng báo cáo (tổng quan + danh mục + top sản phẩm) chỉ hợp khi câu hỏi về bán hàng.
  // Hỏi liên hệ mà vẫn đổ bảng top sản phẩm ra là nhiễu — lỗi đã gặp.
  const report = salesFocus ? await creatorReport(creatorId) : null;
  yield {
    type: "step_done",
    index: at("answer"),
    // Không nói chuyện cache/token ở đây — đó là chi tiết nội bộ, người bán chỉ cần biết kết quả
    detail: `Tổng hợp từ bằng chứng · ${h.data.points.length} ý có nguồn`,
    payload: report ? { report } : undefined,
  };
  yield {
    type: "conclusion",
    text: h.data.summary || "Mình chưa trả lời được câu này từ dữ liệu hiện có.",
    reasons: [...h.data.points, ...(h.data.caution ? [{ ...h.data.caution, text: `Lưu ý: ${h.data.caution.text}` }] : [])],
    blocks: h.data.blocks ?? [],
    follow_ups: h.data.follow_ups ?? [],
  };
  yield { type: "done", cost_usd: cost };
}

/**
 * Bản không streaming: gom hết sự kiện của `analyseCreatorStream` thành một kết quả.
 * Dùng cho CLI (`npm run koc:chat`) và bất cứ chỗ nào không cần hiện dần.
 */
export async function handleCreatorTurn(creatorId: string, text: string, threadId?: string): Promise<CreatorChatOutcome> {
  const steps: AnalysisStep[] = [];
  const out: CreatorChatOutcome = { reply: "", reasons: [], steps, cost_usd: 0 };
  const KIND: AnalysisStep["kind"][] = ["data", "peers", "videos", "conclusion"];

  for await (const e of analyseCreatorStream(creatorId, text, threadId)) {
    if (e.type === "plan") for (const [i, s] of e.steps.entries()) steps.push({ title: s.title, detail: "", kind: KIND[i] });
    else if (e.type === "step_done") {
      if (steps[e.index]) steps[e.index].detail = e.detail;
      if (e.payload?.products) out.products = e.payload.products;
      if (e.payload?.peers) out.peers = e.payload.peers;
      if (e.payload?.videos) out.videos = e.payload.videos;
    } else if (e.type === "conclusion") {
      out.reply = e.text;
      out.reasons = e.reasons;
    } else if (e.type === "done") out.cost_usd = e.cost_usd;
    else if (e.type === "error") throw new Error(e.message);
  }
  return out;
}
