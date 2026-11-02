import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Crown, Medal } from "lucide-react";
import type { ReactNode } from "react";

/* Shared e-commerce dashboard pieces. Numbers are always passed in pre-formatted by code. */

const KPI_TONES = {
  blue: "bg-blue-50 text-blue-600",
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  pink: "bg-pink-50 text-pink-600",
  violet: "bg-violet-50 text-violet-600",
  slate: "bg-slate-100 text-slate-600",
} as const;
export type Tone = keyof typeof KPI_TONES;

export function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "blue",
  highlight,
}: {
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  highlight?: boolean;
}) {
  return (
    <div className={`card px-5 py-4 ${highlight ? "border-brand/30 bg-brand-soft/60" : ""}`}>
      <div className="flex items-center gap-1.5 text-[13px] text-ink-muted">
        {Icon && <Icon size={14} strokeWidth={2} className={highlight ? "text-brand" : KPI_TONES[tone].split(" ")[1]} />}
        {label}
      </div>
      <div className="num mt-1.5 text-[26px] font-bold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-ink-muted">{hint}</div>}
    </div>
  );
}

/** Top-3 medal, otherwise a plain rank number. */
export function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-sm" title="Hạng 1">
        <Crown size={14} strokeWidth={2.4} />
      </span>
    );
  if (rank <= 3)
    return (
      <span
        className={`grid h-7 w-7 place-items-center rounded-full text-white shadow-sm ${
          rank === 2 ? "bg-gradient-to-br from-slate-300 to-slate-500" : "bg-gradient-to-br from-orange-300 to-orange-600"
        }`}
        title={`Hạng ${rank}`}
      >
        <Medal size={14} strokeWidth={2.4} />
      </span>
    );
  return <span className="num grid h-7 w-7 place-items-center text-xs font-medium text-ink-muted">{rank}</span>;
}

/** Signed change with arrow + sign, so direction never relies on color alone. */
export function Delta({ value, text }: { value: number | null | undefined; text: string }) {
  if (value === null || value === undefined || value === 0) return <span className="num text-ink-muted">{value === 0 ? "0" : "–"}</span>;
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`num inline-flex items-center gap-0.5 font-medium ${up ? "text-emerald-600" : "text-rose-600"}`}>
      <Icon size={13} strokeWidth={2.4} />
      {up ? "+" : ""}
      {text}
    </span>
  );
}

const PILL_TONES = {
  gray: "bg-slate-100 text-slate-600",
  blue: "bg-brand-soft text-brand",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  pink: "bg-pink-50 text-pink-700",
  red: "bg-rose-50 text-rose-700",
} as const;

export function Pill({ children, tone = "gray", icon: Icon }: { children: ReactNode; tone?: keyof typeof PILL_TONES; icon?: LucideIcon }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL_TONES[tone]}`}>
      {Icon && <Icon size={11} strokeWidth={2.4} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Thin bar showing a value's share of the column max (dense-row figure, rounded ends). */
export function ShareBar({ ratio }: { ratio: number }) {
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-brand-soft">
      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }} />
    </div>
  );
}

export function SectionCard({
  id,
  title,
  icon: Icon,
  note,
  right,
  children,
  bodyClass = "p-5",
}: {
  id?: string;
  title: string;
  icon?: LucideIcon;
  note?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
}) {
  return (
    <section id={id} className="card scroll-mt-20">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        {Icon && (
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand">
            <Icon size={15} strokeWidth={2.2} />
          </span>
        )}
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {note && <span className="text-xs text-ink-muted">· {note}</span>}
        <div className="ml-auto">{right}</div>
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}
