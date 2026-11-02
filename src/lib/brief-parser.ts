import "server-only";
import { CAMPAIGN_CATEGORIES } from "./campaign";
import { claude, type ClaudeResult } from "./llm/claude";
import { sanitizeExtracted, type Criteria } from "./brief";
import { sanitizePlan, type BriefPlan } from "./plan";

/**
 * Step 3 — Brief parser. One small Haiku call turns a free-text brief into structured criteria
 * + up to 3 suggestions. The model only extracts what the user wrote (null otherwise); code
 * then sanitizes every value. Cached by prompt text, so re-confirming costs 0 tokens.
 */
export const BRIEF_PROMPT_VERSION = "brief-v4";

const SYSTEM = `[${BRIEF_PROMPT_VERSION}] Bạn trích xuất tiêu chí tìm KOC TikTok Việt Nam từ mô tả chiến dịch. CHỈ trả về 1 object JSON, không giải thích.
Quy tắc: chỉ điền giá trị người dùng nói rõ hoặc suy ra trực tiếp; không có thì null. Không bịa số.
Tiền tính bằng VND (30 triệu = 30000000; 2M = 2000000). Follower: 10k = 10000.
Chọn category_id: kem chống nắng/chống nắng → "601602"; serum, kem dưỡng, sữa rửa mặt, toner, mặt nạ, trị mụn (chăm sóc da nói chung) → "848776"; son, phấn, cushion, kem nền, mascara (trang điểm) → "848648"; chỉ nói chung "mỹ phẩm/beauty/làm đẹp" hoặc cả da lẫn trang điểm → "848776,848648".
Schema:
{"category_id": one of ${CAMPAIGN_CATEGORIES.map((c) => `"${c.id}"(${c.name})`).join(", ")} or null,
"product_focus": string|null (sản phẩm cụ thể, vd "kem chống nắng"),
"followers_min": number|null, "followers_max": number|null,
"audience_gender": "female"|"male"|null,
"audience_ages": array of "18-24","25-34","35-44","45-54","55+" phủ độ tuổi được nhắc (vd 18–30 → ["18-24","25-34"]) or [],
"budget_total": number|null, "budget_min_per_koc": number|null, "budget_max_per_koc": number|null,
"koc_count": number|null, "mcn": "no"|"yes"|null,
"suggestions": tối đa 3 câu tiếng Việt ngắn gợi ý bổ sung tiêu chí giúp chọn KOC tốt hơn (không nêu số liệu thị trường),
"rank_by": "revenue" nếu người dùng muốn xếp theo doanh thu, còn lại "fit",
"plan": kế hoạch các bước sẽ chạy, mảng {"capability","title"} theo thứ tự. CHỈ dùng capability có sẵn:
  - "score_fit": lọc theo tiêu chí và chấm điểm bằng dữ liệu (luôn có, không tốn token)
  - "screen_content": AI đọc bio, tiêu đề video, sản phẩm đã bán của từng KOC
  - "analyse_videos": AI xem khung hình video của nhóm dẫn đầu (đắt — chỉ chọn khi cần kiểm chứng cách review/demo sản phẩm)
  - "recommend": chọn KOC trong ngân sách, chia ngân sách và viết lý do kèm bằng chứng (chỉ chọn khi biết ngân sách)
  "title": câu tiếng Việt ngắn mô tả bước đó theo đúng yêu cầu người dùng, vd "Xếp KOC theo doanh thu giảm dần".
  Quy tắc chọn bước: yêu cầu chỉ để xem/xếp hạng danh sách (không nêu sản phẩm lẫn ngân sách) → chỉ "score_fit".
  Có nêu sản phẩm hoặc nói tới review/demo/chất lượng nội dung → PHẢI có "screen_content" và "analyse_videos".
  Có ngân sách → PHẢI có "recommend". Không bỏ bước chỉ vì muốn tiết kiệm chi phí.
"questions": tối đa 2 câu hỏi lại khi thiếu thông tin quan trọng, mảng {"field","question"}; field thuộc "budget_total","product_focus","koc_count","category_id". Chỉ hỏi thứ người dùng CHƯA nói.}`;

export interface ParsedBrief {
  values: Partial<Criteria>;
  fields: (keyof Criteria)[];
  suggestions: string[];
  /** Các bước AI định chạy cho đúng yêu cầu này + câu hỏi lại nếu thiếu thông tin. */
  plan: BriefPlan;
  usage: ClaudeResult;
}

export async function parseBrief(prompt: string): Promise<ParsedBrief> {
  const res = await claude({ system: SYSTEM, prompt, model: "haiku", purpose: "brief-parser" });
  const json = res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("AI chưa hiểu được mô tả — thử viết rõ hơn hoặc dùng Bộ lọc nâng cao");
  }
  const { values, fields } = sanitizeExtracted(raw);
  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, 200)).slice(0, 3)
    : [];
  return { values, fields, suggestions, plan: sanitizePlan(raw, values), usage: res };
}
