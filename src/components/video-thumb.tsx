"use client";

import { Loader2, Play, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const cover = (id: string) => `https://img.kalocdn.com/tiktok.video/${id}/cover.png`;

/**
 * Video cover from Kalodata's public CDN; click plays the MP4 in a modal.
 * The MP4 is resolved and streamed by our own `/api/video/[id]/play` (tikwm, same as the
 * video-downloader project) because TikTok's embed players refuse to load here.
 */
export function VideoThumb({ id, title, tiktokUrl }: { id: string; title: string; tiktokUrl: string }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group/thumb relative h-[72px] w-[54px] shrink-0 overflow-hidden rounded-lg bg-slate-800 shadow-sm ring-1 ring-black/5"
        aria-label={`Phát video: ${title}`}
      >
        {!broken && (
          // eslint-disable-next-line @next/next/no-img-element -- remote CDN cover, lazy, no optimisation needed
          <img
            src={cover(id)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer" // the CDN rejects requests carrying a third-party Referer
            onError={() => setBroken(true)}
            className="h-full w-full object-cover transition group-hover/thumb:scale-105"
          />
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/20 transition group-hover/thumb:bg-black/40">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-white/90 text-slate-900 shadow">
            <Play size={13} fill="currentColor" className="ml-0.5" />
          </span>
        </span>
      </button>

      {open && <VideoModal id={id} title={title} tiktokUrl={tiktokUrl} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Full-screen player modal (Esc / backdrop closes), shared by every place that shows a video. */
export function VideoModal({ id, title, tiktokUrl, onClose }: { id: string; title: string; tiktokUrl: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="relative w-full max-w-[380px]" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-11 right-0 grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
          aria-label="Đóng"
        >
          <X size={18} />
        </button>
        <Player id={id} tiktokUrl={tiktokUrl} />
        <p className="mt-3 line-clamp-2 text-center text-xs text-white/80">{title}</p>
        <a href={tiktokUrl} target="_blank" rel="noreferrer" className="mt-1 block text-center text-xs font-semibold text-white hover:underline">
          Mở trên TikTok ↗
        </a>
      </div>
    </div>,
    document.body,
  );
}

function Player({ id, tiktokUrl }: { id: string; tiktokUrl: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-black shadow-2xl">
      <video
        key={attempt}
        src={`/api/video/${id}/play${attempt ? `?r=${attempt}` : ""}`}
        controls
        autoPlay
        playsInline
        preload="auto"
        onCanPlay={() => setState("ready")}
        onError={() => setState("error")}
        className="h-full w-full object-contain"
      />
      {state === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- blurred cover while the MP4 resolves */}
          <img src={cover(id)} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover opacity-40 blur-sm" />
          <span className="relative flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white">
            <Loader2 size={14} className="animate-spin" /> Đang tải video…
          </span>
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center text-white">
          <div>
            <TriangleAlert className="mx-auto text-amber-400" size={28} />
            <p className="mt-2 text-sm font-medium">Chưa phát được video này</p>
            <p className="mt-1 text-xs text-white/70">Video tạm thời chưa phát được, thử lại sau.</p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setState("loading");
                  setAttempt((a) => a + 1);
                }}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-900"
              >
                Thử lại
              </button>
              <a href={tiktokUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold">
                Mở TikTok
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
