// Kế hoạch xử lý do AI lập cho từng brief (chia sẻ giữa server và bước xác nhận ở client).
import type { Criteria } from "./brief";

/**
 * Danh mục năng lực **có thật** của hệ thống. AI chỉ được chọn trong danh sách này và chỉ được
 * đặt tên bước; phần thực thi vẫn là code cũ, nên kế hoạch không thể hứa điều hệ thống không làm được.
 * `order` quyết định thứ tự chạy, `cost` để hiển thị cho người dùng biết bước nào tốn tiền.
 */
export const CAPABILITIES = {
  score_fit: {
    order: 1,
    title: "Lọc & chấm điểm KOC theo dữ liệu",
    cost: "0 token",
    needsBudget: false,
  },
  screen_content: {
    order: 2,
    title: "Đọc nội dung từng KOC",
    cost: "AI rẻ",
    needsBudget: false,
  },
  analyse_videos: {
    order: 3,
    title: "Xem video của KOC dẫn đầu",
    cost: "AI đắt nhất",
    needsBudget: false,
  },
  recommend: {
    order: 4,
    title: "Chọn KOC, chia ngân sách & viết lý do",
    cost: "AI rẻ",
    needsBudget: true, // không có ngân sách thì không chia được — hỏi lại thay vì tự đặt
  },
} as const;

export type Capability = keyof typeof CAPABILITIES;
export const CAPABILITY_IDS = Object.keys(CAPABILITIES) as Capability[];

export interface PlanStep {
  capability: Capability;
  /** Câu mô tả do AI viết theo đúng yêu cầu của người dùng, vd "Xếp 1.027 KOC theo doanh thu". */
  title: string;
}

/** Trường mà AI được phép hỏi lại; lựa chọn trả lời do code cung cấp, AI chỉ viết câu hỏi. */
export const ASKABLE = ["budget_total", "product_focus", "koc_count", "category_id"] as const;
export type AskField = (typeof ASKABLE)[number];

export interface PlanQuestion {
  field: AskField;
  question: string;
}

export interface BriefPlan {
  steps: PlanStep[];
  /** Thứ tự người dùng muốn thấy: theo độ phù hợp (mặc định) hay theo doanh thu. */
  rank_by: "fit" | "revenue";
  questions: PlanQuestion[];
}

const hasBudget = (c: Partial<Criteria>) => Boolean(c.budget_total || c.budget_max_per_koc);

/**
 * Giữ lại phần hợp lệ của kế hoạch AI trả về và áp ràng buộc của hệ thống:
 * bỏ năng lực không có thật, khử trùng lặp, xếp đúng thứ tự, luôn bắt đầu bằng `score_fit`
 * (mọi bước sau đều đọc điểm/bằng chứng của nó), và bỏ `recommend` khi chưa biết ngân sách.
 */
export function sanitizePlan(raw: Record<string, unknown>, criteria: Partial<Criteria>): BriefPlan {
  const seen = new Set<Capability>();
  const steps: PlanStep[] = [];
  for (const s of Array.isArray(raw.plan) ? raw.plan : []) {
    const o = (s ?? {}) as Record<string, unknown>;
    const cap = String(o.capability ?? "") as Capability;
    if (!CAPABILITY_IDS.includes(cap) || seen.has(cap)) continue;
    seen.add(cap);
    const title = typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 90) : CAPABILITIES[cap].title;
    steps.push({ capability: cap, title });
  }
  if (!seen.has("score_fit")) steps.unshift({ capability: "score_fit", title: CAPABILITIES.score_fit.title });
  steps.sort((a, b) => CAPABILITIES[a.capability].order - CAPABILITIES[b.capability].order);

  const questions: PlanQuestion[] = [];
  const addQuestion = (field: AskField, question: string) => {
    if (questions.some((q) => q.field === field)) return;
    questions.push({ field, question: question.slice(0, 160) });
  };
  for (const q of Array.isArray(raw.questions) ? raw.questions : []) {
    const o = (q ?? {}) as Record<string, unknown>;
    const field = String(o.field ?? "") as AskField;
    if (!ASKABLE.includes(field) || typeof o.question !== "string" || !o.question.trim()) continue;
    if (field === "budget_total" && hasBudget(criteria)) continue; // đã biết rồi thì không hỏi
    if (field === "product_focus" && criteria.product_focus) continue;
    addQuestion(field, o.question.trim());
  }

  /**
   * Ràng buộc cứng: nêu ĐÍCH DANH một sản phẩm thì phải đọc nội dung và xem video để kiểm chứng KOC
   * có thật sự bán/review món đó — số liệu danh mục không trả lời được câu đó. Luật này từng chỉ nằm
   * trong lời dặn ở prompt nên Haiku bỏ qua được ("Tôi muốn tìm 5 KOC bán phấn nền" ra kế hoạch
   * không có bước video).
   *
   * Chỉ nêu DANH MỤC (vd "KOC trang điểm, tương tác cao, ngân sách 50 triệu") thì KHÔNG ép: xem
   * khung hình không kiểm chứng thêm được gì mà là bước đắt nhất, cứ để AI tự quyết.
   */
  if (criteria.product_focus) {
    for (const cap of ["screen_content", "analyse_videos"] as const)
      if (!seen.has(cap)) (seen.add(cap), steps.push({ capability: cap, title: CAPABILITIES[cap].title }));
    steps.sort((a, b) => CAPABILITIES[a.capability].order - CAPABILITIES[b.capability].order);
  }

  // Ràng buộc cứng: chia ngân sách mà không có ngân sách là bịa → bỏ bước và hỏi
  const planned = steps.map((s) => s.capability);
  if (planned.includes("recommend") && !hasBudget(criteria)) {
    const i = steps.findIndex((s) => s.capability === "recommend");
    steps.splice(i, 1);
    addQuestion("budget_total", "Tổng ngân sách của chiến dịch là bao nhiêu? Cần con số này để chia ngân sách cho từng KOC.");
  }

  return { steps, rank_by: raw.rank_by === "revenue" ? "revenue" : "fit", questions: questions.slice(0, 3) };
}

/** Kế hoạch mặc định khi người dùng dùng Bộ lọc nâng cao (không có prompt để AI đọc). */
export function defaultPlan(criteria: Partial<Criteria>): BriefPlan {
  const steps = CAPABILITY_IDS.map((c) => ({ capability: c, title: CAPABILITIES[c].title }));
  return sanitizePlan({ plan: steps }, criteria);
}
