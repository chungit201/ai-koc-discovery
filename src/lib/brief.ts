// Campaign criteria shared by the brief parser (server) and the confirm step (client).
import { CAMPAIGN_CATEGORIES } from "./campaign";
import type { BriefPlan } from "./plan";

export type Source = "prompt" | "form" | "default";

export interface Criteria {
  platform: "TikTok";
  country: "Việt Nam";
  category_id: string;
  product_focus: string | null; // e.g. "kem chống nắng" — what the KOC should be selling/reviewing
  followers_min: number | null;
  followers_max: number | null;
  audience_gender: "female" | "male" | null;
  audience_ages: string[]; // majority age buckets, e.g. ["18-24","25-34"]
  budget_total: number | null; // VND
  budget_min_per_koc: number | null; // VND
  budget_max_per_koc: number | null; // VND
  koc_count: number;
  mcn: "no" | "yes" | null; // null = no preference
}

export type CriteriaSources = Partial<Record<keyof Criteria, Source>>;

export interface BriefPreview {
  criteria: Criteria;
  sources: CriteriaSources;
  suggestions: string[]; // AI advice (never data)
  warnings: string[]; // code-computed consistency checks
  plan: BriefPlan; // các bước AI sẽ chạy cho đúng yêu cầu này
  llm: { used: boolean; tokens_in: number; tokens_out: number; cost_usd: number; cached: boolean; latency_ms: number } | null;
}

export const DEFAULT_CRITERIA: Criteria = {
  platform: "TikTok",
  country: "Việt Nam",
  category_id: CAMPAIGN_CATEGORIES[0].id,
  product_focus: null,
  followers_min: null,
  followers_max: null,
  audience_gender: null,
  audience_ages: [],
  budget_total: null,
  budget_min_per_koc: null,
  budget_max_per_koc: null,
  koc_count: 5,
  mcn: null,
};

const AGE_BUCKETS = ["18-24", "25-34", "35-44", "45-54", "55+"];

/** Clamp/clean whatever the model returned into valid criteria; anything invalid is dropped (stays default). */
export function sanitizeExtracted(x: Record<string, unknown>): { values: Partial<Criteria>; fields: (keyof Criteria)[] } {
  const v: Partial<Criteria> = {};
  const num = (k: string) => {
    const n = Number(x[k]);
    return x[k] !== null && x[k] !== undefined && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  };
  const cat = String(x.category_id ?? "");
  if (CAMPAIGN_CATEGORIES.some((c) => c.id === cat)) v.category_id = cat;
  if (typeof x.product_focus === "string" && x.product_focus.trim()) v.product_focus = x.product_focus.trim().slice(0, 80);
  if (num("followers_min") !== undefined) v.followers_min = num("followers_min")!;
  if (num("followers_max") !== undefined && num("followers_max")! > 0) v.followers_max = num("followers_max")!;
  if (x.audience_gender === "female" || x.audience_gender === "male") v.audience_gender = x.audience_gender;
  if (Array.isArray(x.audience_ages)) {
    const ages = x.audience_ages.map(String).filter((a) => AGE_BUCKETS.includes(a));
    if (ages.length) v.audience_ages = [...new Set(ages)];
  }
  for (const k of ["budget_total", "budget_min_per_koc", "budget_max_per_koc"] as const) if (num(k)) v[k] = num(k)!;
  if (num("koc_count") && num("koc_count")! <= 100) v.koc_count = num("koc_count")!;
  if (x.mcn === "no" || x.mcn === "yes") v.mcn = x.mcn;
  // Cross-check: a clearly-typed product overrides a contradicting category pick
  const implied = impliedCategory(v.product_focus ?? null);
  if (implied && (!v.category_id || !v.category_id.split(",").every((id) => implied.split(",").includes(id)))) v.category_id = implied;
  return { values: v, fields: Object.keys(v) as (keyof Criteria)[] };
}

/** Category implied by a product name, when unambiguous. */
export function impliedCategory(product: string | null): string | null {
  if (!product) return null;
  if (/chống nắng|sunscreen|sunblock|spf/i.test(product)) return "601602";
  const skin = /serum|tinh chất|kem dưỡng|dưỡng ẩm|sữa rửa|rửa mặt|toner|mặt nạ|trị mụn|retinol|tẩy tế bào/i.test(product);
  const makeup = /son|phấn|cushion|kem nền|mascara|kẻ mắt|má hồng|che khuyết|tint/i.test(product);
  if (skin && !makeup) return "848776";
  if (makeup && !skin) return "848648";
  return null;
}

/** Consistency checks computed by code (shown as warnings on the confirm step). */
export function criteriaWarnings(c: Criteria): string[] {
  const w: string[] = [];
  const m = (n: number) => `${(n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} triệu`;
  if (c.budget_min_per_koc && c.budget_max_per_koc && c.budget_min_per_koc > c.budget_max_per_koc) w.push("Ngân sách tối thiểu/KOC đang lớn hơn tối đa/KOC.");
  if (c.budget_total && c.budget_min_per_koc && c.koc_count * c.budget_min_per_koc > c.budget_total)
    w.push(`${c.koc_count} KOC × tối thiểu ${m(c.budget_min_per_koc)} vượt tổng ngân sách ${m(c.budget_total)}.`);
  if (c.budget_total && c.budget_max_per_koc && c.koc_count * c.budget_max_per_koc < c.budget_total * 0.5)
    w.push(`Dù trả tối đa cho cả ${c.koc_count} KOC cũng chỉ dùng ${m(c.koc_count * c.budget_max_per_koc)} trên ${m(c.budget_total)} ngân sách.`);
  if (c.followers_min !== null && c.followers_max !== null && c.followers_min > c.followers_max) w.push("Khoảng follower không hợp lệ (từ > đến).");
  return w;
}

// ── Display helpers (confirm table) ─────────────────────────────────────────

const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}tr` : n >= 1e3 ? `${+(n / 1e3).toFixed(0)}k` : String(n));
const vnd = (n: number) => `${(n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} triệu ₫`;

export function criteriaRows(c: Criteria, s: CriteriaSources): { label: string; value: string; source: Source | "fixed" }[] {
  const followers =
    c.followers_min !== null && c.followers_max !== null
      ? `${k(c.followers_min)} – ${k(c.followers_max)}`
      : c.followers_min !== null
        ? `≥ ${k(c.followers_min)}`
        : c.followers_max !== null
          ? `≤ ${k(c.followers_max)}`
          : "Không giới hạn";
  const perKoc =
    c.budget_min_per_koc && c.budget_max_per_koc
      ? `${vnd(c.budget_min_per_koc)} – ${vnd(c.budget_max_per_koc)}`
      : c.budget_max_per_koc
        ? `≤ ${vnd(c.budget_max_per_koc)}`
        : c.budget_min_per_koc
          ? `≥ ${vnd(c.budget_min_per_koc)}`
          : "Chưa xác định";
  const audience = [c.audience_gender === "female" ? "Nữ" : c.audience_gender === "male" ? "Nam" : null, c.audience_ages.length ? c.audience_ages.join(", ") : null]
    .filter(Boolean)
    .join(" · ");
  const src = (key: keyof Criteria) => s[key] ?? "default";
  return [
    { label: "Nền tảng", value: c.platform, source: "fixed" },
    { label: "Quốc gia", value: c.country, source: "fixed" },
    { label: "Danh mục", value: CAMPAIGN_CATEGORIES.find((x) => x.id === c.category_id)?.name ?? c.category_id, source: src("category_id") },
    ...(c.product_focus ? [{ label: "Sản phẩm", value: c.product_focus, source: src("product_focus") }] : []),
    { label: "Follower", value: followers, source: src("followers_min") === "default" ? src("followers_max") : src("followers_min") },
    { label: "Khán giả", value: audience || "Không giới hạn", source: src("audience_gender") === "default" ? src("audience_ages") : src("audience_gender") },
    { label: "Ngân sách/KOC", value: perKoc, source: src("budget_max_per_koc") === "default" ? src("budget_min_per_koc") : src("budget_max_per_koc") },
    { label: "Tổng ngân sách", value: c.budget_total ? vnd(c.budget_total) : "Chưa xác định", source: src("budget_total") },
    { label: "Số KOC", value: `${c.koc_count} KOC`, source: src("koc_count") },
    ...(c.mcn ? [{ label: "MCN", value: c.mcn === "no" ? "Chưa ký MCN" : "Đã ký MCN", source: src("mcn") }] : []),
  ];
}
