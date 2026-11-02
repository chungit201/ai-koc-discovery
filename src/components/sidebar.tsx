"use client";

import { ScanSearch, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DeepSearchButton } from "./deep-search-button";

const NAV = [
  { href: "/kocs", label: "Nhà sáng tạo", icon: Users },
  { href: "/campaigns", label: "Chiến dịch", icon: ScanSearch },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-white lg:flex">
      <Link href="/kocs" className="flex items-center gap-2.5 border-b border-line px-6 py-6">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white">
          <Sparkles size={18} strokeWidth={2.4} />
        </span>
        <span className="leading-tight">
          <span className="block text-[20px] font-bold tracking-tight">DETOLA</span>
          <span className="block text-[11px] text-ink-muted">AI KOC Discovery</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV.map((n) => {
          const active = path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition ${
                active ? "bg-brand-soft font-semibold text-brand-strong" : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <n.icon size={18} strokeWidth={2} />
              {n.label}
            </Link>
          );
        })}
        <div className="pt-3">
          <DeepSearchButton />
        </div>
      </nav>

      <div className="border-t border-line px-6 py-4 text-xs text-ink-muted">
        <div className="font-medium text-zinc-700">TikTok Shop · Việt Nam</div>
      </div>
    </aside>
  );
}
