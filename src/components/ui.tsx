import type { ReactNode } from "react";

export function Card({ title, children, right }: { title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white">
      {title && (
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="num mt-1 text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

const BADGE = {
  gray: "bg-zinc-100 text-zinc-700",
  green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-1 ring-red-200",
  blue: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
} as const;

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: keyof typeof BADGE }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[tone]}`}>{children}</span>;
}

export function Progress({ done, total, failed = 0 }: { done: number; total: number; failed?: number }) {
  const p = total ? (done / total) * 100 : 0;
  const f = total ? (failed / total) * 100 : 0;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-brand-soft">
      <div className="rounded-full bg-brand" style={{ width: `${p}%` }} />
      <div className="bg-rose-400" style={{ width: `${f}%` }} />
    </div>
  );
}

/** Source label for a number, so every figure on screen says where it came from. */
export function Source({ children }: { children: ReactNode }) {
  return <span className="text-[11px] text-zinc-400">{children}</span>;
}
