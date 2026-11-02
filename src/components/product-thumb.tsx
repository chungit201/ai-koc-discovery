"use client";

import { Package } from "lucide-react";
import { useState } from "react";

/** Product cover from Kalodata's public CDN (no credits, no login); falls back to an icon. */
export function ProductThumb({ id, name }: { id: string; name: string }) {
  const [broken, setBroken] = useState(false);
  if (broken)
    return (
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
        <Package size={18} />
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote CDN cover, lazy, no optimisation needed
    <img
      src={`https://img.kalocdn.com/tiktok.product/${id}/cover.png`}
      alt={name}
      loading="lazy"
      referrerPolicy="no-referrer" // the CDN rejects requests carrying a third-party Referer
      onError={() => setBroken(true)}
      className="h-12 w-12 shrink-0 rounded-lg bg-slate-100 object-cover ring-1 ring-line"
    />
  );
}
