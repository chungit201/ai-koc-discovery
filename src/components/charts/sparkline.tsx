"use client";

import { useState } from "react";
import { compact, vnd } from "@/lib/format";

const FMT = { vnd, number: compact } as const;
export type ValueFormat = keyof typeof FMT;

const ACCENT = "#167045"; // = --color-brand, validated for chroma + contrast

/**
 * Inline 30-day trend for dense table rows. One series, 2px line, end dot,
 * hover shows the day + value (hit target is the whole cell, not the 2px line).
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  unit = "number",
  label,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  unit?: ValueFormat;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const format = FMT[unit];
  const pts = values.map((v) => v ?? 0);
  if (pts.length < 2) return <span className="text-xs text-zinc-300">–</span>;

  const pad = 3;
  const max = Math.max(...pts);
  const min = Math.min(...pts, 0);
  const x = (i: number) => pad + (i / (pts.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = pts.length - 1;
  const hi = hover ?? last;

  return (
    <div className="relative inline-block" aria-label={label} role="img">
      <svg
        width={width}
        height={height}
        className="block overflow-visible"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - pad) / (width - pad * 2)) * last);
          setHover(Math.max(0, Math.min(last, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <path d={d} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hi)} x2={x(hi)} y1={0} y2={height} stroke="#a1a1aa" strokeWidth={1} strokeDasharray="2 2" />}
        <circle cx={x(hi)} cy={y(pts[hi])} r={3} fill={ACCENT} stroke="#fff" strokeWidth={1.5} />
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[11px] text-white shadow">
          {label} · ngày {hover + 1}/{pts.length}: <span className="num font-medium">{format(pts[hover])}</span>
        </div>
      )}
    </div>
  );
}
