import { Suspense, cache } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { TolaHistoryDrawer, TolaHistoryPanel } from "@/components/tola-history";
import { listTolaThreads } from "@/lib/data/queries";
import { AI_NAME } from "@/lib/brand";
import { TolaOrb } from "@/components/tola-mark";

/**
 * Khung của trợ lý: cột lịch sử hội thoại bên trái + thanh tiêu đề riêng. Dùng chung cho `/tola`
 * (hội thoại mới) và `/tola/[id]` (mở lại hội thoại cũ) nên chuyển qua lại không dựng lại cột trái.
 */
export default function TolaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh min-w-0 flex-1">
      {/* Dữ liệu Mongo là request-time → đọc bên trong Suspense để phần còn lại vẫn prerender được */}
      <Suspense fallback={<div className="hidden w-60 shrink-0 border-r border-line bg-white lg:block" />}>
        <HistoryPanel />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop: logo + nút thu gọn đã nằm trong cột lịch sử → thanh này chỉ còn cho mobile */}
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-page/90 px-4 py-2.5 backdrop-blur sm:px-6 lg:hidden">
          <Suspense fallback={null}>
            <HistoryDrawer />
          </Suspense>
          <span className="flex items-center gap-2 text-[15px] font-bold">
            <TolaOrb size={30} />
            {AI_NAME}
          </span>
          {/* Mobile không có thanh tab ở màn này → lối về danh sách KOC */}
          <Link href="/kocs" className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-zinc-100 hover:text-ink">
            <Users size={16} /> Nhà sáng tạo
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}

// Panel và drawer cùng cần danh sách → gộp thành 1 truy vấn mỗi request
const getThreads = cache(() => listTolaThreads());

async function HistoryPanel() {
  return <TolaHistoryPanel threads={await getThreads()} />;
}

async function HistoryDrawer() {
  return <TolaHistoryDrawer threads={await getThreads()} />;
}
