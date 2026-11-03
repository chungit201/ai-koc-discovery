"use client";

import { ScanSearch, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DeepSearchButton } from "./deep-search-button";

const NAV = [
  { href: "/kocs", label: "Nhà sáng tạo", icon: Users },
  { href: "/campaigns", label: "Chiến dịch", icon: ScanSearch },
];

/**
 * Tên trợ lý AI, hiện trên nút giữa thanh dưới (giống cách Kalodata gọi trợ lý của họ là "Pilot").
 * Rút từ DE-TOLA — ngắn, đọc được bằng tiếng Việt, vừa một nhãn tab. Đổi ở đây là đổi mọi nơi.
 */

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

/**
 * Thanh trên cùng cho màn hình nhỏ — chỉ còn logo. Điều hướng chuyển xuống `BottomNav` cho vừa tầm
 * ngón cái; giữ lại thanh trên để luôn biết đang ở sản phẩm nào và bấm về trang chủ.
 */
export function MobileNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur lg:hidden">
      <div className="flex items-center px-4 py-2.5">
        <Link href="/kocs" className="flex shrink-0 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
            <Sparkles size={16} strokeWidth={2.4} />
          </span>
          <span className="text-[16px] font-bold tracking-tight">DETOLA</span>
        </Link>
      </div>
    </header>
  );
}

/**
 * Thanh tab dưới đáy (mobile), nút trợ lý AI nổi ở giữa — bố cục quen thuộc của app điện thoại:
 * hai mục dữ liệu hai bên, hành động chính nằm đúng chỗ ngón cái với tới.
 * Nút giữa mở thẳng khung tạo chiến dịch, tức là lối vào AI của sản phẩm.
 */
export function BottomNav() {
  const path = usePathname();
  const tab = (n: (typeof NAV)[number]) => {
    const active = path.startsWith(n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? "page" : undefined}
        className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition ${active ? "font-semibold text-brand" : "text-zinc-500"}`}
      >
        <n.icon size={20} strokeWidth={active ? 2.4 : 2} />
        {n.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="flex items-stretch">
        {tab(NAV[0])}
        <div className="relative w-24 shrink-0">
          {/* Nhô lên khỏi thanh — nút này là hành động chính, không phải một tab ngang hàng.
              Vòng tròn vượt lên trên mép thanh, còn nhãn tên rơi đúng vào hàng chữ của các tab. */}
          <div className="absolute -top-6 left-1/2 -translate-x-1/2">
            <DeepSearchButton variant="fab" />
          </div>
        </div>
        {tab(NAV[1])}
      </div>
    </nav>
  );
}
