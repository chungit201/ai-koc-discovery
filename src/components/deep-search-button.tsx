"use client";

import { AlertTriangle, ArrowLeft, Check, ChevronDown, HelpCircle, Lightbulb, Loader2, Plus, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { createPortal } from "react-dom";
import { confirmCampaign, previewCampaign, type CampaignFormState } from "@/app/actions/campaign";
import { CAMPAIGN_CATEGORIES, PROMPT_EXAMPLES, PROMPT_MAX, PROMPT_MIN } from "@/lib/campaign";
import { criteriaRows, type Criteria } from "@/lib/brief";
import { AI_NAME } from "@/lib/brand";
import { TolaMark } from "@/components/tola-mark";
import type { AskField, PlanQuestion } from "@/lib/plan";

/** Primary CTA: "Chiến dịch mới" → brief (prompt or advanced filters) → AI confirm step → campaign. */
export function DeepSearchButton({ variant = "sidebar" }: { variant?: "sidebar" | "header" | "nav" | "fab" }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/**
       * `fab` = nút trợ lý nổi giữa thanh tab dưới (mobile).
       * Vòng tròn TỐI màu chứ không phải màu brand: thanh tab nền trắng, nút tối mới bật lên như một
       * hành động riêng biệt thay vì hoà vào các mục điều hướng. Tên trợ lý đặt DƯỚI vòng tròn —
       * nhét cả mark lẫn chữ vào trong 58px thì cả hai đều bé và chật.
       * Cả cụm là một nút, bấm vào chữ cũng mở.
       */}
      {variant === "fab" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Hỏi ${AI_NAME} — tạo chiến dịch mới`}
          className="group/fab flex flex-col items-center transition active:scale-95"
        >
          <span className="relative grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-gradient-to-b from-[#454cab] to-[#1b1d4d] text-white shadow-[0_8px_22px_-8px_rgb(27_29_77_/_0.75)] ring-4 ring-white">
            <TolaMark size={29} className="relative z-10" />
            {/* Vệt sáng lướt chéo qua mặt nút — báo "đang sống", lặp thưa để không gây nhiễu mắt */}
            <span aria-hidden className="animate-shine pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/45 to-transparent" />
          </span>
          {/* Tên nằm trong viên nền đặc, đè lên mép dưới vòng tròn — đọc rõ trên mọi nền phía sau */}
          {/* `z-10`: vòng tròn có `ring-4` vẽ đè lên, không nâng lớp thì viên nền bị khuất */}
          <span className="relative z-10 -mt-2 rounded-full bg-brand px-2 py-[3px] text-[10.5px] font-bold leading-none text-white shadow-sm ring-2 ring-white">{AI_NAME}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            variant === "sidebar"
              ? "flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-3 text-[14px] font-semibold text-white shadow-[var(--shadow-pop)] transition hover:bg-brand-strong"
              : "flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3 text-[13px] font-semibold text-white shadow-[var(--shadow-pop)] transition hover:bg-brand-strong sm:h-10 sm:gap-2 sm:px-4"
          }
        >
          <Plus size={17} strokeWidth={2.6} />
          <span className={variant === "nav" ? "hidden sm:inline" : undefined}>Chiến dịch mới</span>
        </button>
      )}
      {/* Portal to <body>: the sidebar is its own stacking context, so a nested modal would sit under page content */}
      {open && createPortal(<BriefModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

const initial: CampaignFormState = { errors: {} };

/** Values to pre-fill the advanced form from what the AI understood ("Sửa bộ lọc"). */
function valuesFromCriteria(c: Criteria, prompt: string | null): Record<string, string> {
  const m = (v: number | null) => (v === null ? "" : String(Math.round(v)));
  const k = (v: number | null) => (v === null ? "" : String(+(v / 1e3).toFixed(1)));
  return {
    prompt: prompt ?? "",
    advanced: "1",
    category_id: c.category_id,
    budget_total: m(c.budget_total) || "30000000",
    budget_min_per_koc: m(c.budget_min_per_koc) || "0",
    budget_max_per_koc: m(c.budget_max_per_koc) || m(c.budget_total) || "10000000",
    koc_count: String(c.koc_count),
    followers_min_k: k(c.followers_min),
    followers_max_k: k(c.followers_max),
  };
}

function BriefModal({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(previewCampaign, initial);
  const [editValues, setEditValues] = useState<Record<string, string> | null>(null);
  // The preview the user left via "Sửa bộ lọc"; any newer preview from the server reopens the confirm step
  const [editedFrom, setEditedFrom] = useState<CampaignFormState["preview"] | null>(null);
  const confirming = Boolean(state.preview) && state.preview !== editedFrom;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/40 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="brief-title">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl">
        {confirming && state.preview ? (
          <ConfirmStep
            preview={state.preview}
            onClose={onClose}
            onEdit={() => {
              setEditValues(valuesFromCriteria(state.preview!.criteria, state.preview!.prompt));
              setEditedFrom(state.preview);
            }}
          />
        ) : (
          <BriefForm
            key={JSON.stringify(editValues ?? state.values ?? {})}
            action={action}
            pending={pending}
            errors={state.preview ? {} : state.errors}
            values={editValues ?? state.values}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// ── Step 1: brief ────────────────────────────────────────────────────────────

function BriefForm({
  action,
  pending,
  errors: err,
  values,
  onClose,
}: {
  action: (f: FormData) => void;
  pending: boolean;
  errors: CampaignFormState["errors"];
  values?: Record<string, string>;
  onClose: () => void;
}) {
  const v = (k: string, d: string) => values?.[k] ?? d;
  const [advanced, setAdvanced] = useState(values?.advanced === "1");
  const [prompt, setPrompt] = useState(v("prompt", ""));
  // Hide a stale error once the user has edited the prompt into something valid
  const edited = prompt !== v("prompt", "");
  const promptError = edited && (prompt.trim().length >= PROMPT_MIN || advanced) ? undefined : err.prompt;

  return (
    <form action={action} className="flex min-h-0 flex-col" noValidate>
      <Header icon={<Sparkles size={18} />} title="Chiến dịch mới" subtitle="Mô tả chiến dịch bằng lời, hoặc dùng bộ lọc nâng cao. AI sẽ tóm tắt tiêu chí để bạn xác nhận." onClose={onClose} />

      <div className="space-y-4 overflow-y-auto px-6 py-5">
        <Field label="Mô tả chiến dịch" error={promptError}>
          <textarea
            name="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={PROMPT_MAX}
            rows={4}
            autoFocus
            placeholder="VD: Tìm 5 KOC nữ 18–30 review kem chống nắng, tổng ngân sách 30 triệu, mỗi KOC 3–10 triệu…"
            className={`${inputCls(promptError)} h-auto resize-none py-3 leading-relaxed`}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {PROMPT_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setPrompt(ex)}
              className="max-w-full truncate rounded-full border border-line bg-zinc-50 px-3 py-1 text-left text-[12px] text-zinc-600 hover:border-brand/40 hover:text-brand"
              title={ex}
            >
              {ex}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-[12px] uppercase tracking-wide text-ink-muted">
          <span className="h-px flex-1 bg-line" /> hoặc <span className="h-px flex-1 bg-line" />
        </div>
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          aria-expanded={advanced}
          className={`flex w-full items-center gap-2 rounded-xl border px-4 py-3 text-[14px] font-medium transition ${
            advanced ? "border-brand/40 bg-brand-soft/50 text-brand-strong" : "border-line hover:border-zinc-300"
          }`}
        >
          <SlidersHorizontal size={16} />
          Bộ lọc nâng cao
          <span className="ml-1 text-[12px] font-normal text-ink-muted">danh mục · ngân sách · follower · số KOC</span>
          <ChevronDown size={16} className={`ml-auto transition ${advanced ? "rotate-180" : ""}`} />
        </button>

        {advanced && (
          <div className="space-y-4 rounded-xl border border-line p-4">
            <input type="hidden" name="advanced" value="1" />
            <Field label="Danh mục" error={err.category_id}>
              <select name="category_id" defaultValue={v("category_id", CAMPAIGN_CATEGORIES[0].id)} className={inputCls(err.category_id)}>
                {CAMPAIGN_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tổng ngân sách chiến dịch" error={err.budget_total}>
              <Money name="budget_total" defaultValue={v("budget_total", "30000000")} invalid={Boolean(err.budget_total)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ngân sách tối thiểu / KOC" error={err.budget_min_per_koc}>
                <Money name="budget_min_per_koc" defaultValue={v("budget_min_per_koc", "3000000")} invalid={Boolean(err.budget_min_per_koc)} />
              </Field>
              <Field label="Ngân sách tối đa / KOC" error={err.budget_max_per_koc}>
                <Money name="budget_max_per_koc" defaultValue={v("budget_max_per_koc", "10000000")} invalid={Boolean(err.budget_max_per_koc)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Follower từ">
                <Unit name="followers_min_k" unit="nghìn" defaultValue={v("followers_min_k", "")} invalid={false} placeholder="không giới hạn" />
              </Field>
              <Field label="Follower đến">
                <Unit name="followers_max_k" unit="nghìn" defaultValue={v("followers_max_k", "")} invalid={false} placeholder="không giới hạn" />
              </Field>
            </div>
            <Field label="Số lượng KOC mong muốn" error={err.koc_count}>
              <input name="koc_count" type="number" min={1} max={100} step={1} defaultValue={v("koc_count", "5")} className={inputCls(err.koc_count)} />
            </Field>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
        <button type="button" onClick={onClose} className="h-10 rounded-xl border border-line px-4 text-[13px] font-medium hover:bg-zinc-50">
          Huỷ
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex h-10 items-center gap-2 rounded-xl bg-brand px-5 text-[13px] font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {pending ? (prompt.trim() ? "Đang phân tích…" : "Đang xử lý…") : "Tạo chiến dịch"}
        </button>
      </div>
    </form>
  );
}

// ── Step 2: "AI đã hiểu chiến dịch" — review before searching ─────────────────

const SOURCE_LABEL = { prompt: "AI", form: "Bộ lọc", default: "Mặc định", fixed: "" } as const;

function ConfirmStep({ preview, onEdit, onClose }: { preview: NonNullable<CampaignFormState["preview"]>; onEdit: () => void; onClose: () => void }) {
  const rows = criteriaRows(preview.criteria, preview.sources);
  return (
    <form action={confirmCampaign} className="flex min-h-0 flex-col">
      <input type="hidden" name="payload" value={JSON.stringify(preview)} />
      <div className="flex items-start gap-3 border-b border-line px-6 py-5">
        <div className="flex-1">
          <h2 id="brief-title" className="text-[19px] font-semibold tracking-tight">
            AI đã hiểu chiến dịch của bạn
          </h2>
          {preview.prompt && <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted">“{preview.prompt}”</p>}
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold ${preview.warnings.length ? "bg-amber-50 text-amber-700" : "bg-brand-soft text-brand"}`}>
          {preview.warnings.length ? "Cần kiểm tra" : "Sẵn sàng tìm kiếm"}
        </span>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-zinc-100" aria-label="Đóng">
          <X size={18} />
        </button>
      </div>

      <div className="space-y-5 overflow-y-auto px-6 py-5">
        {preview.plan.questions.length > 0 && <AskFields questions={preview.plan.questions} />}

        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="pb-2.5 font-semibold">Tiêu chí</th>
              <th className="pb-2.5 font-semibold">AI đã hiểu</th>
              <th className="w-20 pb-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="py-2.5 text-zinc-600">{r.label}</td>
                <td className={`py-2.5 font-medium ${r.source === "default" ? "text-ink-muted" : ""}`}>{r.value}</td>
                <td className="py-2.5 text-right">
                  {r.source !== "fixed" && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        r.source === "prompt" ? "bg-brand-soft text-brand" : r.source === "form" ? "bg-sky-50 text-sky-700" : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {SOURCE_LABEL[r.source]}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {preview.warnings.length > 0 && (
          <div className="space-y-1.5 rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            {preview.warnings.map((w) => (
              <p key={w} className="flex gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}

        {preview.suggestions.length > 0 && (
          <div className="border-t border-line pt-4">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold">
              <Lightbulb size={16} className="text-amber-500" /> Gợi ý của AI
            </h3>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-zinc-600">
              {preview.suggestions.map((s) => (
                <li key={s} className="flex gap-2">
                  <Check size={14} className="mt-1 shrink-0 text-brand" /> {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-line px-6 py-4">
        <button type="button" onClick={onEdit} className="flex h-11 items-center justify-center gap-2 rounded-full border border-line text-[14px] font-medium hover:bg-zinc-50">
          <ArrowLeft size={15} /> Sửa bộ lọc
        </button>
        <ConfirmButton />
      </div>
    </form>
  );
}

/**
 * Câu hỏi lại của AI ở bước xác nhận. AI chỉ viết câu hỏi và chọn trường; **lựa chọn trả lời do
 * code cung cấp** để không có giá trị nào do model bịa ra. Bỏ trống = giữ mặc định như trước.
 */
const QUICK: Record<AskField, { value: string; label: string }[]> = {
  budget_total: [30e6, 50e6, 100e6].map((v) => ({ value: String(v), label: `${v / 1e6} triệu` })),
  koc_count: [3, 5, 10].map((v) => ({ value: String(v), label: `${v} KOC` })),
  category_id: CAMPAIGN_CATEGORIES.map((c) => ({ value: c.id, label: c.name })),
  product_focus: [],
};

function AskFields({ questions }: { questions: PlanQuestion[] }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <div className="space-y-4 rounded-xl border border-brand/30 bg-brand-soft/30 px-4 py-4">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold">
        <HelpCircle size={16} className="text-brand" /> AI cần biết thêm
      </h3>
      {questions.map((q) => (
        <div key={q.field}>
          <p className="text-[13.5px] text-zinc-700">{q.question}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {QUICK[q.field].map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setAnswers((a) => ({ ...a, [q.field]: a[q.field] === o.value ? "" : o.value }))}
                className={`rounded-full border px-3 py-1 text-[12.5px] ${
                  answers[q.field] === o.value ? "border-brand bg-brand text-white" : "border-line bg-white text-zinc-600 hover:border-brand/40"
                }`}
              >
                {o.label}
              </button>
            ))}
            <input
              value={answers[q.field] && QUICK[q.field].some((o) => o.value === answers[q.field]) ? "" : (answers[q.field] ?? "")}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.field]: e.target.value }))}
              placeholder={q.field === "product_focus" ? "VD: kem chống nắng" : q.field === "budget_total" ? "hoặc nhập số tiền (₫)" : "hoặc nhập"}
              inputMode={q.field === "product_focus" || q.field === "category_id" ? "text" : "numeric"}
              className="h-8 min-w-[9rem] flex-1 rounded-full border border-line bg-white px-3 text-[12.5px] outline-none focus:border-brand"
            />
          </div>
          <input type="hidden" name={`answer_${q.field}`} value={answers[q.field] ?? ""} />
        </div>
      ))}
      <p className="text-[12px] text-ink-muted">Bỏ trống cũng được — AI sẽ chạy các bước không cần thông tin này.</p>
    </div>
  );
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="flex h-11 items-center justify-center gap-2 rounded-full bg-zinc-900 text-[14px] font-semibold text-white hover:bg-black disabled:opacity-60">
      {pending ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
      Xác nhận & tìm kiếm
    </button>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────────────

function Header({ icon, title, subtitle, onClose }: { icon: React.ReactNode; title: string; subtitle: string; onClose: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-6 py-5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">{icon}</span>
      <div className="flex-1">
        <h2 id="brief-title" className="text-[17px] font-semibold">
          {title}
        </h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</p>
      </div>
      <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-zinc-100" aria-label="Đóng">
        <X size={18} />
      </button>
    </div>
  );
}

const inputCls = (error?: string) =>
  `h-11 w-full rounded-xl border bg-white px-3.5 text-[14px] outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15 ${
    error ? "border-rose-400" : "border-line"
  }`;

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[12px] text-rose-600">{error}</span>}
    </label>
  );
}

function Unit({ name, unit, defaultValue, invalid, placeholder }: { name: string; unit: string; defaultValue: string; invalid: boolean; placeholder?: string }) {
  return (
    <span className="relative block">
      <input
        name={name}
        type="number"
        min={0}
        step="0.1"
        inputMode="decimal"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={`${inputCls(invalid ? "x" : undefined)} pr-24`}
      />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-muted">{unit}</span>
    </span>
  );
}

const groupVnd = (digits: string) => (digits ? Number(digits).toLocaleString("vi-VN") : "");

/** Whole-VND amount: typed digits are shown grouped ("30.000.000"); the form receives plain digits. */
function Money({ name, defaultValue, invalid }: { name: string; defaultValue: string; invalid: boolean }) {
  const [digits, setDigits] = useState(String(defaultValue).replace(/\D/g, ""));
  return (
    <span className="relative block">
      <input type="hidden" name={name} value={digits} />
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={groupVnd(digits)}
        onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 13))}
        placeholder="0"
        className={`num ${inputCls(invalid ? "x" : undefined)} pr-10`}
      />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[14px] text-ink-muted">₫</span>
    </span>
  );
}
