/**
 * S2 scoring rules — pure functions, no I/O, no AI. Every number shown to users is computed here.
 * Bump SCORING_VERSION whenever weights or formulas change (stored with each result).
 */
export const SCORING_VERSION = "s2-v6";

export const WEIGHTS = {
  performance: 0.2, // cosmetics revenue + reach in the period
  content_fit: 0.25, // sells / talks about what the campaign promotes
  engagement: 0.15, // video engagement rate + breakout rate (percentile in pool)
  growth: 0.1, // revenue trend vs previous period — đang lên hay đang tụt
  cost_fit: 0.1, // estimated rate vs budget per KOC
  consistency: 0.1, // revenue spread across days, not one spike
  audience_fit: 0.1, // Kalodata majority gender/age vs target
} as const;
export type ScoreKey = keyof typeof WEIGHTS;

/** A named product (e.g. "kem chống nắng") makes content fit the deciding factor. */
export const WEIGHTS_PRODUCT_FOCUS: Record<ScoreKey, number> = {
  performance: 0.15,
  content_fit: 0.35,
  engagement: 0.12,
  growth: 0.1,
  cost_fit: 0.08,
  consistency: 0.1,
  audience_fit: 0.1,
};

export const weightsFor = (productFocus: string | null): Record<ScoreKey, number> => (productFocus ? WEIGHTS_PRODUCT_FOCUS : WEIGHTS);

/**
 * Lý do một KOC bị loại, viết cho người bán đọc. Người bán cần biết mình **không bỏ sót ai** —
 * trước đây các con số này nằm trong `campaign_scores` mà chưa bao giờ được nói ra.
 */
export const EXCLUDE_LABELS: Record<string, string> = {
  no_detail: "chưa thu thập đủ dữ liệu chi tiết",
  seller_account: "là tài khoản bán hàng tự vận hành, không phải KOC",
  followers_low: "follower thấp hơn yêu cầu",
  followers_high: "follower cao hơn yêu cầu",
  gender: "khán giả không đúng giới tính mục tiêu",
  mcn_signed: "đã ký MCN",
  mcn_unsigned: "chưa ký MCN",
  over_budget: "chi phí ước tính vượt ngân sách mỗi KOC",
  few_videos: "có dưới 3 video trong kỳ",
};

export const SCORE_LABELS: Record<ScoreKey, string> = {
  performance: "Hiệu suất",
  content_fit: "Khớp nội dung",
  engagement: "Tương tác",
  growth: "Tăng trưởng",
  cost_fit: "Hợp ngân sách",
  consistency: "Ổn định",
  audience_fit: "Khớp khán giả",
};

/**
 * Collaboration rate per video by follower tier (VND). An ASSUMPTION — Kalodata has no rate cards —
 * so every estimate is labelled "ước tính", confidence "thấp", with followers/MCN as its basis.
 */
const COST_TIERS: { maxFollowers: number; min: number; max: number }[] = [
  { maxFollowers: 10_000, min: 300_000, max: 1_000_000 },
  { maxFollowers: 50_000, min: 1_000_000, max: 3_000_000 },
  { maxFollowers: 100_000, min: 2_000_000, max: 5_000_000 },
  { maxFollowers: 300_000, min: 4_000_000, max: 10_000_000 },
  { maxFollowers: 1_000_000, min: 8_000_000, max: 20_000_000 },
  { maxFollowers: Infinity, min: 20_000_000, max: 60_000_000 },
];
export const MCN_MARKUP = 1.2;

export function estimateCost(followers: number, hasMcn: boolean) {
  const t = COST_TIERS.find((x) => followers < x.maxFollowers)!;
  const k = hasMcn ? MCN_MARKUP : 1;
  const min = Math.round(t.min * k);
  const max = Math.round(t.max * k);
  return { min, max, mid: Math.round((min + max) / 2), confidence: "thấp" as const, method: `bậc follower${hasMcn ? " × 1,2 (MCN)" : ""}` };
}

/**
 * Tên sản phẩm cụ thể → bộ từ đồng nghĩa thật sự chỉ món đó. Tra bảng này TRƯỚC khi rơi về khớp
 * cụm từ, vì tên tiếng Việt hay có biến thể không chung chữ nào ("phấn nền" ↔ "cushion").
 */
const PRODUCT_SYNONYMS: { test: RegExp; pattern: RegExp }[] = [
  { test: /chống nắng|sunscreen|sunblock|spf/i, pattern: /chống nắng|\bkcn\b|sunscreen|sun ?screen|sunblock|\bspf\d*/i },
  { test: /phấn nền|kem nền|cushion|foundation/i, pattern: /phấn nền|phấn nước|cushion|kem nền|foundation|che khuyết điểm|concealer/i },
  { test: /phấn phủ|setting powder/i, pattern: /phấn phủ|phấn nén|phấn bột|setting powder|loose powder|compact powder/i },
  { test: /\bson\b|son môi|lipstick|son tint/i, pattern: /\bson\b|son môi|son kem|son tint|son bóng|lipstick|lip ?tint|lip ?gloss|lip ?balm/i },
  { test: /má hồng|blush/i, pattern: /má hồng|\bblush\b/i },
  { test: /phấn mắt|bảng mắt|eyeshadow/i, pattern: /phấn mắt|bảng mắt|bảng phấn mắt|eye ?shadow/i },
  { test: /mascara|chuốt mi/i, pattern: /mascara|chuốt mi|mi giả|dưỡng mi/i },
  { test: /kẻ mắt|eyeliner/i, pattern: /kẻ mắt|eye ?liner|bút kẻ mắt/i },
  { test: /serum|tinh chất/i, pattern: /serum|tinh chất|ampoule|essence/i },
  { test: /kem dưỡng|dưỡng ẩm|moisturi/i, pattern: /kem dưỡng|dưỡng ẩm|moisturi[sz]er|gel dưỡng/i },
  { test: /sữa rửa mặt|rửa mặt|cleanser/i, pattern: /sữa rửa mặt|rửa mặt|cleanser|gel rửa|sữa tắm mặt/i },
  { test: /toner|nước hoa hồng/i, pattern: /toner|nước hoa hồng|nước cân bằng/i },
  { test: /mặt nạ|\bmask\b/i, pattern: /mặt nạ|\bmask\b|sheet mask/i },
  { test: /trị mụn|chấm mụn|acne/i, pattern: /trị mụn|chấm mụn|giảm mụn|\bacne\b|mờ thâm mụn/i },
  { test: /tẩy trang|cleansing (oil|water|balm)/i, pattern: /tẩy trang|nước tẩy trang|cleansing (oil|water|balm)|micellar/i },
];

// ── Keyword sets for "does this KOC sell / talk about the campaign's product" ──
const KEYWORDS: Record<string, RegExp> = {
  // sunscreen — no bare "uv": it matched UV-blocking lenses and random substrings
  "601602": /chống nắng|\bkcn\b|sunscreen|sun ?screen|sunblock|\bspf\d*/i,
  "848776": /serum|tinh chất|kem dưỡng|dưỡng ẩm|sữa rửa|rửa mặt|toner|nước hoa hồng|mặt nạ|tẩy (da chết|trang)|retinol|cica|bha|aha|skincare|chăm sóc da|chống nắng|mụn|trị thâm|dưỡng da/i,
  "848648": /son|phấn|cushion|kem nền|mascara|kẻ mắt|má hồng|che khuyết|tint|lip|makeup|trang điểm|eyeliner|highlight|kem lót/i,
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Regex nhận diện sản phẩm của chiến dịch.
 *
 * Trước `s2-v6` hàm này tách tên nhiều chữ rồi **OR** từng chữ lại: "phấn nền" → /phấn|nền/, nên nó
 * khớp cả phấn má, phấn mắt, phấn phủ, xịt khoá nền, thậm chí "bông mút… hạn chế hút nền". Đo trên
 * pool trang điểm: có KOC được chấm `content_fit` 78 trong khi chỉ 3% doanh thu "khớp" thật sự là
 * phấn nền, còn KOC bán 745tr phấn nền thật lại bị xếp dưới. `content_fit` là trọng số lớn nhất khi
 * có product_focus (0,35) nên lỗi này lật ngược cả bảng.
 *
 * Giờ: tra bảng đồng nghĩa trước → không có thì khớp CỤM TỪ (các chữ đứng liền nhau, cho phép vài
 * ký tự chen giữa) → cuối cùng mới rơi về bộ từ khoá của danh mục.
 */
export function focusPattern(categoryId: string, productFocus: string | null): RegExp {
  if (productFocus) {
    const syn = PRODUCT_SYNONYMS.find((s) => s.test.test(productFocus));
    if (syn) return syn.pattern;
    const words = productFocus
      .toLowerCase()
      .split(/[\s,/]+/)
      .filter((w) => w.length >= 3 && !["kem", "cho", "của", "và", "các", "loại", "dành"].includes(w))
      .map(escape);
    // Một chữ thì dùng thẳng; nhiều chữ thì phải đứng cạnh nhau, không OR rời rạc
    if (words.length === 1) return new RegExp(words[0], "i");
    if (words.length > 1) return new RegExp(words.join("[\\s-]{0,3}"), "i");
  }
  const parts = categoryId.split(",").map((id) => KEYWORDS[id]?.source).filter(Boolean);
  return new RegExp(parts.join("|") || ".", "i");
}

/** Rank-based percentile in [0,1] (ties share the lower rank). */
export function percentileOf(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return (v: number) => {
    if (sorted.length <= 1) return 1;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sorted[m] < v) lo = m + 1;
      else hi = m;
    }
    return lo / (sorted.length - 1);
  };
}

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * `revenue_growth_rate` của Kalodata là TỈ LỆ, không phải phần trăm (0,847 = +84,7%; −1 = mất sạch
 * doanh thu). Đuôi rất dài — đã thấy +34.334% ở KOC mới có mẫu số gần 0 — nên chấm chủ yếu bằng
 * thứ hạng trong pool (giống `pRev`/`pEng`), cộng một mỏ neo tuyệt đối để KOC thật sự đang lên
 * được cộng điểm, và KOC đang tụt không ăn điểm cao chỉ vì cả pool cùng tụt.
 *   rate  0 → neo 0,5   ·   +100% → neo 1,0   ·   −100% → neo 0
 */
export const growthScore = (percentile: number, rate: number | null) =>
  rate === null ? 0.5 : clamp01(0.7 * percentile + 0.3 * clamp01(0.5 + rate / 2));

/** Nhãn đọc được cho một tỉ lệ tăng trưởng, dùng trong câu bằng chứng. */
export const growthLabel = (rate: number) => (rate >= 0.3 ? "đang lên mạnh" : rate >= 0.05 ? "đang lên" : rate > -0.05 ? "đi ngang" : rate > -0.3 ? "đang chững" : "đang tụt");

/**
 * Tỉ lệ video "nổi bật" của một KOC: video có lượt xem ≥ 3× trung vị của chính kênh đó. Đo khả năng
 * tạo video bùng nổ — khác tỷ lệ tương tác (đều tay) và khác tổng view (phụ thuộc quy mô kênh).
 * Dưới 5 video thì trung vị không đáng tin → trả null, điểm rơi về phần tương tác.
 */
export const BREAKOUT_FACTOR = 3;
export function breakoutRate(views: number[]): { rate: number; hits: number; total: number; median: number } | null {
  const v = views.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length < 5) return null;
  const median = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  if (!median) return null;
  const hits = v.filter((x) => x >= BREAKOUT_FACTOR * median).length;
  return { rate: hits / v.length, hits, total: v.length, median };
}
