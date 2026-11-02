// Shared by the "Chiến dịch mới" form (client) and its server action.

export const CAMPAIGN_CATEGORIES = [
  { id: "848776,848648", name: "Mỹ phẩm (Chăm sóc da + Trang điểm)" },
  { id: "848776", name: "Chăm sóc da" },
  { id: "848648", name: "Trang điểm" },
  { id: "601602", name: "Kem chống nắng da mặt" },
] as const;

export const PROMPT_EXAMPLES = [
  "Tìm 5 KOC nữ 18–30 review kem chống nắng, tổng ngân sách 30 triệu, mỗi KOC 3–10 triệu",
  "Cần 10 KOC trang điểm có tương tác cao, chưa ký MCN, ngân sách 50 triệu",
  "KOC chăm sóc da cho làn da dầu mụn, ưu tiên video review chi tiết, 20 triệu cho 4 KOC",
];

/** "prompt" = free-text brief only (AI parses it in Step 3); "advanced" = structured filters. */
export type CampaignMode = "prompt" | "advanced";

export interface CampaignInput {
  mode: CampaignMode;
  prompt: string | null;
  category_id: string | null;
  budget_total: number | null; // VND
  budget_max_per_koc: number | null; // VND
  budget_min_per_koc: number | null; // VND
  koc_count: number | null;
}

export type FieldErrors = Partial<Record<"prompt" | "category_id" | "budget_total" | "budget_max_per_koc" | "budget_min_per_koc" | "koc_count" | "form", string>>;

const MILLION = 1_000_000;
export const PROMPT_MIN = 10;
export const PROMPT_MAX = 1000;

/** Money fields arrive as whole VND (digits only; the input strips separators). */
export function parseCampaignForm(f: FormData): { input: CampaignInput; errors: FieldErrors } {
  const prompt = String(f.get("prompt") ?? "").trim();
  const mode: CampaignMode = f.get("advanced") === "1" ? "advanced" : "prompt";
  const num = (k: string) => Number(String(f.get(k) ?? "").replace(",", "."));
  const money = (k: string) => {
    const digits = String(f.get(k) ?? "").replace(/\D/g, "");
    return digits ? Number(digits) : NaN;
  };
  const input: CampaignInput =
    mode === "advanced"
      ? {
          mode,
          prompt: prompt || null,
          category_id: String(f.get("category_id") ?? ""),
          budget_total: money("budget_total"),
          budget_max_per_koc: money("budget_max_per_koc"),
          budget_min_per_koc: Number.isNaN(money("budget_min_per_koc")) ? 0 : money("budget_min_per_koc"),
          koc_count: num("koc_count"),
        }
      : { mode, prompt: prompt || null, category_id: null, budget_total: null, budget_max_per_koc: null, budget_min_per_koc: null, koc_count: null };
  return { input, errors: validateCampaign(input) };
}

export function validateCampaign(c: CampaignInput): FieldErrors {
  const e: FieldErrors = {};
  if (c.prompt && c.prompt.length > PROMPT_MAX) e.prompt = `Mô tả tối đa ${PROMPT_MAX} ký tự`;
  if (c.mode === "prompt") {
    if (!c.prompt || c.prompt.length < PROMPT_MIN)
      e.prompt = `Mô tả chiến dịch (ít nhất ${PROMPT_MIN} ký tự) hoặc mở Bộ lọc nâng cao`;
    return e;
  }

  const total = c.budget_total ?? NaN;
  const max = c.budget_max_per_koc ?? NaN;
  const min = c.budget_min_per_koc ?? NaN;
  const count = c.koc_count ?? NaN;
  if (!CAMPAIGN_CATEGORIES.some((x) => x.id === c.category_id)) e.category_id = "Chọn một danh mục";
  if (!(total > 0)) e.budget_total = "Nhập tổng ngân sách lớn hơn 0";
  if (!(max > 0)) e.budget_max_per_koc = "Nhập ngân sách tối đa lớn hơn 0";
  if (!(min >= 0)) e.budget_min_per_koc = "Ngân sách tối thiểu không được âm";
  if (!Number.isInteger(count) || count < 1 || count > 100) e.koc_count = "Số KOC từ 1 đến 100";
  if (!e.budget_min_per_koc && !e.budget_max_per_koc && min > max) e.budget_min_per_koc = "Tối thiểu không được lớn hơn tối đa";
  if (!e.budget_total && !e.budget_max_per_koc && max > total) e.budget_max_per_koc = "Tối đa/KOC không được vượt tổng ngân sách";
  if (!e.budget_total && !e.koc_count && !e.budget_min_per_koc && count * min > total)
    e.koc_count = `${count} KOC × tối thiểu ${fmtM(min)} vượt tổng ngân sách`;
  return e;
}

export const fmtM = (vnd: number | null | undefined) =>
  vnd === null || vnd === undefined ? "–" : `${(vnd / MILLION).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} triệu`;
