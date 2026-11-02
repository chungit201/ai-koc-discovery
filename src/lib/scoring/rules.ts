/**
 * S2 scoring rules — pure functions, no I/O, no AI. Every number shown to users is computed here.
 * Bump SCORING_VERSION whenever weights or formulas change (stored with each result).
 */
export const SCORING_VERSION = "s2-v4";

export const WEIGHTS = {
  performance: 0.25, // cosmetics revenue + reach in the period
  content_fit: 0.25, // sells / talks about what the campaign promotes
  engagement: 0.15, // video engagement rate (percentile in pool)
  cost_fit: 0.15, // estimated rate vs budget per KOC
  consistency: 0.1, // revenue spread across days, not one spike
  audience_fit: 0.1, // Kalodata majority gender/age vs target
} as const;
export type ScoreKey = keyof typeof WEIGHTS;

/** A named product (e.g. "kem chống nắng") makes content fit the deciding factor. */
export const WEIGHTS_PRODUCT_FOCUS: Record<ScoreKey, number> = {
  performance: 0.2,
  content_fit: 0.35,
  engagement: 0.15,
  cost_fit: 0.1,
  consistency: 0.1,
  audience_fit: 0.1,
};

export const weightsFor = (productFocus: string | null): Record<ScoreKey, number> => (productFocus ? WEIGHTS_PRODUCT_FOCUS : WEIGHTS);

export const SCORE_LABELS: Record<ScoreKey, string> = {
  performance: "Hiệu suất",
  content_fit: "Khớp nội dung",
  engagement: "Tương tác",
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

// ── Keyword sets for "does this KOC sell / talk about the campaign's product" ──
const KEYWORDS: Record<string, RegExp> = {
  // sunscreen — no bare "uv": it matched UV-blocking lenses and random substrings
  "601602": /chống nắng|\bkcn\b|sunscreen|sun ?screen|sunblock|\bspf\d*/i,
  "848776": /serum|tinh chất|kem dưỡng|dưỡng ẩm|sữa rửa|rửa mặt|toner|nước hoa hồng|mặt nạ|tẩy (da chết|trang)|retinol|cica|bha|aha|skincare|chăm sóc da|chống nắng|mụn|trị thâm|dưỡng da/i,
  "848648": /son|phấn|cushion|kem nền|mascara|kẻ mắt|má hồng|che khuyết|tint|lip|makeup|trang điểm|eyeliner|highlight|kem lót/i,
};

/** Regex for the campaign focus: explicit product focus first, else the category's keyword set. */
export function focusPattern(categoryId: string, productFocus: string | null): RegExp {
  if (productFocus) {
    if (/chống nắng|sunscreen|spf/i.test(productFocus)) return KEYWORDS["601602"];
    const words = productFocus
      .toLowerCase()
      .split(/[\s,/]+/)
      .filter((w) => w.length >= 3 && !["kem", "cho", "của", "và", "các"].includes(w))
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (words.length) return new RegExp(words.join("|"), "i");
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
