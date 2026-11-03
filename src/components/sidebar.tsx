"use client";

import { Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TolaMark, TolaOrb } from "./tola-mark";
import { AI_NAME } from "@/lib/brand";

/**
 * Hai mục điều hướng. Trang chiến dịch đã bỏ — tuyển KOC giờ là một câu hỏi gõ vào trợ lý, nên lối
 * vào duy nhất cho việc đó là nút Tola ở giữa thanh tab (mobile) / mục "Hỏi Tola" (desktop).
 */
const NAV = [{ href: "/kocs", label: "Nhà sáng tạo", icon: Users }];

export function Sidebar() {
  const path = usePathname();
  // Trang Tola có cột lịch sử hội thoại riêng → ẩn sidebar chung để rộng chỗ cho hội thoại
  if (path.startsWith("/tola")) return null;
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
        {/* Trợ lý: desktop vào bằng mục này, mobile bằng nút nổi giữa thanh tab dưới */}
        <Link
          href="/tola"
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition ${
            path.startsWith("/tola") ? "bg-brand-soft font-semibold text-brand-strong" : "text-zinc-700 hover:bg-zinc-50"
          }`}
        >
          {/* Cỡ icon menu (18px) như "Nhà sáng tạo" — không dùng huy hiệu động cho gọn hàng */}
          <span className="grid h-[18px] w-[18px] place-items-center">
            <TolaMark size={15} />
          </span>
          Hỏi {AI_NAME}
        </Link>
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
  // Tola có thanh tiêu đề riêng (nút lịch sử + nút về) → không chồng hai thanh
  if (usePathname().startsWith("/tola")) return null;
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
 * Nút trợ lý Tola nổi giữa thanh tab — mở **màn `/tola`**, không phải khung tạo chiến dịch.
 * Tạo chiến dịch giờ là một trong những việc Tola làm, không còn là lối vào riêng.
 */
function TolaFab({ active }: { active: boolean }) {
  // Đang xem hồ sơ một KOC → mang KOC đó sang để Tola biết là hỏi về người này
  const koc = usePathname().match(/^\/kocs\/([^/?#]+)/)?.[1];
  return (
    <Link href={koc ? `/tola?koc=${encodeURIComponent(koc)}` : "/tola"} aria-label={`Hỏi ${AI_NAME}`} className="group flex flex-col items-center transition active:scale-90">
      <TolaOrb size={60} active={active} />
      <span className="relative z-10 -mt-2 rounded-full bg-brand px-2 py-[3px] text-[10.5px] font-bold leading-none text-white shadow-sm ring-2 ring-white">{AI_NAME}</span>
    </Link>
  );
}

/**
 * Thanh tab dưới đáy (mobile), nút trợ lý AI nổi ở giữa — bố cục quen thuộc của app điện thoại:
 * hai mục dữ liệu hai bên, hành động chính nằm đúng chỗ ngón cái với tới.
 * Nút giữa mở màn `/tola` — lối vào trợ lý, tạo chiến dịch chỉ là một việc nó làm.
 */
export function BottomNav() {
  const path = usePathname();
  // Màn Tola là màn chat toàn trang: ô nhập ghim đáy, không chen thanh tab vào
  if (path.startsWith("/tola")) return null;
  return (
    <>
    {/* Chừa chỗ cho thanh tab cố định để nội dung cuối trang không bị che */}
    <div aria-hidden className="h-20 shrink-0 lg:hidden" />
    <nav
      aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {/* Chỉ còn nút Tola ở giữa — về danh sách KOC bằng logo ở thanh trên */}
      <div className="flex h-12 items-stretch justify-center">
        <div className="relative w-24 shrink-0">
          {/* Nhô lên khỏi thanh — nút này là hành động chính, không phải một tab ngang hàng.
              Vòng tròn vượt lên trên mép thanh, còn nhãn tên rơi đúng vào hàng chữ của các tab. */}
          <div className="absolute -top-6 left-1/2 -translate-x-1/2">
            <TolaFab active={path.startsWith("/tola")} />
          </div>
        </div>
      </div>
    </nav>
    </>
  );
}
