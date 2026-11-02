"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

const DOT = { strong: "bg-brand", medium: "bg-amber-400", weak: "bg-zinc-300" } as const;

/** Evidence bullets: first `initial` shown, the rest appended below them; the toggle always sits last. */
export function EvidenceList({ items, initial = 3 }: { items: { id: string; claim: string; strength: string }[]; initial?: number }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, initial);
  const hidden = items.length - initial;

  return (
    <div>
      <ul className="space-y-1.5 text-[12.5px] leading-snug text-zinc-700">
        {shown.map((e) => (
          <li key={e.id} className="flex gap-2">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[e.strength as keyof typeof DOT] ?? "bg-zinc-300"}`} />
            <span>{e.claim}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-2 flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
        >
          <ChevronDown size={13} className={`transition ${open ? "rotate-180" : ""}`} />
          {open ? "Thu gọn" : `Xem thêm ${hidden} bằng chứng`}
        </button>
      )}
    </div>
  );
}
