"use client";

import { Check, ChevronDown, Play, X } from "lucide-react";
import { useState } from "react";
import { VideoModal } from "./video-thumb";

interface V {
  video_id: string;
  title: string;
  times: number[];
  product_match: boolean;
  product_demo: string;
  demo_score: number;
  summary: string;
  frames: { i: number; note: string }[];
}

/** S4 visual evidence: the 4-frame sheet the AI looked at, a one-line verdict, frame notes behind a toggle. */
export function VideoEvidence({ videos, handle }: { videos: V[]; handle: string }) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  if (!videos.length) return null;
  const v = videos[Math.min(i, videos.length - 1)];
  const url = `https://www.tiktok.com/${handle.startsWith("@") ? handle : `@${handle}`}/video/${v.video_id}`;
  const demo = v.product_demo === "có";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Video AI đã xem</h3>
        {videos.length > 1 && (
          <div className="flex rounded-md bg-zinc-100 p-0.5">
            {videos.map((_, k) => (
              <button
                key={k}
                type="button"
                onClick={() => setI(k)}
                className={`h-5 rounded px-2 text-[11px] font-medium ${k === i ? "bg-white text-ink shadow-sm" : "text-ink-muted"}`}
              >
                {k + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      <button type="button" onClick={() => setPlaying(true)} aria-label={`Phát video: ${v.title}`} className="group/sheet relative block w-full overflow-hidden rounded-lg bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element -- local keyframe sheet */}
        <img src={`/api/frames/${v.video_id}`} alt={`4 khung hình: ${v.title}`} loading="lazy" className="block aspect-[9/4] w-full object-cover" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 grid grid-cols-4">
          {v.times.map((t, k) => (
            <span key={k} className="num m-1 justify-self-start rounded bg-black/55 px-1 text-[10px] text-white">
              {Math.round(t)}s
            </span>
          ))}
        </div>
        <span className="absolute inset-0 grid place-items-center bg-black/0 transition group-hover/sheet:bg-black/25">
          <span className="grid h-9 w-9 scale-90 place-items-center rounded-full bg-white/90 text-zinc-900 opacity-0 shadow transition group-hover/sheet:scale-100 group-hover/sheet:opacity-100">
            <Play size={15} fill="currentColor" className="ml-0.5" />
          </span>
        </span>
      </button>
      {playing && <VideoModal id={v.video_id} title={v.title} tiktokUrl={url} onClose={() => setPlaying(false)} />}

      <div className="flex flex-wrap gap-x-3 text-[12px] font-medium">
        <Flag ok={demo}>{demo ? "Có demo" : v.product_demo === "không" ? "Không demo" : "Demo chưa rõ"}</Flag>
        <Flag ok={v.product_match}>{v.product_match ? "Đúng sản phẩm" : "Khác sản phẩm"}</Flag>
      </div>
      <p className="line-clamp-2 text-[12.5px] leading-snug text-zinc-700">{v.summary}</p>

      {v.frames.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
          >
            <ChevronDown size={13} className={`transition ${open ? "rotate-180" : ""}`} />
            {open ? "Thu gọn" : "Chi tiết khung hình"}
          </button>
          {open && (
            <ul className="space-y-0.5 text-[11.5px] text-zinc-500">
              {v.frames.map((f) => (
                <li key={f.i}>
                  <span className="num font-medium text-zinc-600">{Math.round(v.times[f.i - 1] ?? 0)}s</span> · {f.note}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Flag({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`flex items-center gap-1 ${ok ? "text-brand" : "text-zinc-500"}`}>
      {ok ? <Check size={13} strokeWidth={2.5} /> : <X size={13} />} {children}
    </span>
  );
}
