"use client";

import { Star } from "lucide-react";
import { useState, useTransition } from "react";
import { toggleFavorite } from "@/app/actions/favorites";

/** Row actions: save (star) + open on TikTok. */
export function KocActions({ id, handle, favorite }: { id: string; handle: string; favorite: boolean }) {
  const [saved, setSaved] = useState(favorite);
  const [pending, start] = useTransition();
  const btn = "grid h-8 w-8 place-items-center rounded-lg border border-line bg-white shadow-sm transition hover:border-zinc-300 disabled:opacity-60";

  return (
    <div className="flex items-center justify-center gap-1.5">
      <button
        type="button"
        disabled={pending}
        aria-pressed={saved}
        aria-label={saved ? "Bỏ lưu KOC" : "Lưu KOC"}
        title={saved ? "Bỏ lưu" : "Lưu KOC"}
        onClick={() => {
          setSaved((s) => !s); // optimistic
          start(async () => {
            try {
              setSaved(await toggleFavorite(id));
            } catch {
              setSaved((s) => !s);
            }
          });
        }}
        className={btn}
      >
        <Star size={16} strokeWidth={2} className={saved ? "fill-amber-400 text-amber-500" : "text-zinc-500"} />
      </button>
      <a
        href={`https://www.tiktok.com/${handle.startsWith("@") ? handle : `@${handle}`}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Mở kênh TikTok"
        title="Mở kênh TikTok"
        className={btn}
      >
        <TikTokIcon />
      </a>
    </div>
  );
}

function TikTokIcon() {
  return (
    <span className="grid h-5 w-5 place-items-center rounded-full bg-zinc-900">
      <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true">
        <path
          fill="#fff"
          d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48Z"
        />
      </svg>
    </span>
  );
}
