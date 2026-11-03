"use client";

import { useState } from "react";
import { compact, vnd } from "@/lib/format";

const FMT = { vnd, number: compact } as const;
export type ValueFormat = keyof typeof FMT;

const ACCENT = "#5b63d3"; // = --color-brand, đã qua validator chroma + tương phản

/**
 * Single-series time chart: 2px line + faint same-hue area, recessive grid (3 ticks),
 * crosshair + tooltip on hover. Title (outside) names the series, so no legend box.
 */
export function LineChart({
  points,
  height = 220,
  unit,

  label,
}: {
  points: { x: string; y: number | null }[];
  height?: number;
  unit: ValueFormat;

  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const format = FMT[unit];
  const axisFormat = compact;
  const W = 1000;
  const H = height;
  const m = { top: 28, right: 16, bottom: 24, left: 52 }; // top room for the peak label
  const ys = points.map((p) => p.y ?? 0);
  if (ys.length < 2) return <p className="py-10 text-center text-sm text-zinc-400">Chưa có dữ liệu theo ngày</p>;

  const max = Math.max(...ys) || 1;
  const niceMax = niceCeil(max);
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const x = (i: number) => m.left + (i / (ys.length - 1)) * iw;
  const y = (v: number) => m.top + ih - (v / niceMax) * ih;
  const line = ys.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(ys.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const ticks = [0, niceMax / 2, niceMax];
  // A date every ~7 days keeps the axis readable without crowding
  const step = Math.max(1, Math.round((ys.length - 1) / 4));
  // …and drop a tick that would collide with the final date label
  const xLabels = [
    ...Array.from({ length: 5 }, (_, k) => k * step).filter((i) => i < ys.length - 1 - step / 2),
    ys.length - 1,
  ];
  // Selective direct labels: peak + latest only (never a number on every point)
  const peak = ys.indexOf(Math.max(...ys));
  const last = ys.length - 1;
  const notes = peak === last ? [{ i: last, tag: "Cao nhất" }] : [{ i: peak, tag: "Cao nhất" }, { i: last, tag: "Mới nhất" }];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={label}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - m.left) / iw) * (ys.length - 1));
          setHover(Math.max(0, Math.min(ys.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} stroke="#f0f0f0" />
            <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className="fill-zinc-400 text-[11px]">
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {xLabels.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === ys.length - 1 ? "end" : "middle"} className="fill-zinc-400 text-[11px]">
            {points[i].x.slice(5).replace("-", "/")}
          </text>
        ))}
        <path d={area} fill={ACCENT} opacity={0.08} />
        <path d={line} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover === null &&
          notes.map(({ i, tag }) => (
            <g key={tag}>
              <circle cx={x(i)} cy={y(ys[i])} r={4} fill={ACCENT} stroke="#fff" strokeWidth={2} />
              <text
                x={x(i)}
                y={y(ys[i]) - 10}
                textAnchor={i === last ? "end" : i === 0 ? "start" : "middle"}
                className="fill-zinc-800 text-[12px] font-semibold"
                // white halo keeps the label legible where it crosses the line
                style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 4, strokeLinejoin: "round" }}
              >
                {format(ys[i])}
                <tspan className="fill-zinc-400 font-normal"> · {tag}</tspan>
              </text>
            </g>
          ))}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + ih} stroke="#a1a1aa" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(ys[hover])} r={4} fill={ACCENT} stroke="#fff" strokeWidth={2} />
          </>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs text-white shadow"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <div className="text-zinc-300">{points[hover].x}</div>
          <div className="num font-medium">{format(ys[hover])}</div>
        </div>
      )}
    </div>
  );
}

function niceCeil(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}
