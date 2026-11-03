import { Suspense } from "react";
import { TolaHistoryDrawer, TolaHistoryPanel } from "@/components/tola-history";
import { listTolaThreads } from "@/lib/data/queries";
import { AI_NAME } from "@/lib/brand";
import { TolaMark } from "@/components/tola-mark";

/**
 * Khung của trợ lý: cột lịch sử hội thoại bên trái + thanh tiêu đề riêng. Dùng chung cho `/tola`
 * (hội thoại mới) và `/tola/[id]` (mở lại hội thoại cũ) nên chuyển qua lại không dựng lại cột trái.
 */
export default async function TolaLayout({ children }: { children: React.ReactNode }) {
  const threads = await listTolaThreads();
  return (
    <div className="flex min-h-screen min-w-0 flex-1">
      <Suspense fallback={<div className="hidden w-60 shrink-0 border-r border-line bg-white lg:block" />}>
        <TolaHistoryPanel threads={threads} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-page/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <TolaHistoryDrawer threads={threads} />
          <span className="flex items-center gap-2 text-[15px] font-bold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-b from-[#454cab] to-[#1b1d4d] text-white">
              <TolaMark size={16} />
            </span>
            {AI_NAME}
          </span>
        </header>
        {children}
      </div>
    </div>
  );
}
