import "server-only";
import { CAMPAIGN_CATEGORIES } from "./campaign";
import { claude, type ClaudeResult } from "./llm/claude";
import { sanitizeExtracted, type Criteria } from "./brief";

/**
 * Step 3 — Brief parser. One small Haiku call turns a free-text brief into structured criteria
 * + up to 3 suggestions. The model only extracts what the user wrote (null otherwise); code
 * then sanitizes every value. Cached by prompt text, so re-confirming costs 0 tokens.
 */
export const BRIEF_PROMPT_VERSION = "brief-v2";

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
"suggestions": tối đa 3 câu tiếng Việt ngắn gợi ý bổ sung tiêu chí giúp chọn KOC tốt hơn (không nêu số liệu thị trường)}`;

export interface ParsedBrief {
  values: Partial<Criteria>;
  fields: (keyof Criteria)[];
  suggestions: string[];
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
  return { values, fields, suggestions, usage: res };
}
