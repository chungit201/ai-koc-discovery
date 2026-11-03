"use client";

import { MessageSquare, PanelLeft, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import type { TolaThreadView } from "@/lib/data/queries";

/**
 * Lịch sử hội thoại của trợ lý, hai dạng cho hai khổ màn hình:
 *  - `TolaHistoryPanel` — cột thường trực bên trái, chỉ từ `lg`.
 *  - `TolaHistoryDrawer` — nút trên thanh tiêu đề + tấm trượt, chỉ dưới `lg`.
 *
 * Tách làm hai vì nút phải nằm TRONG thanh tiêu đề còn cột nằm NGOÀI nó — gộp một component rồi
 * render hai lần sẽ nhân đôi cả hai. Mỗi cái tự giữ trạng thái, không cần chia sẻ.
 *
 * Danh sách do server truyền xuống (`listTolaThreads`); `title` lấy từ chính câu hỏi đầu tiên.
 */
function List({ threads, onPick }: { threads: TolaThreadView[]; onPick?: () => void }) {
  const path = usePathname();
  if (!threads.length) return <p className="px-4 py-4 text-[12.5px] text-ink-muted">Chưa có hội thoại nào.</p>;
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
      {threads.map((t) => {
        const active = path === `/tola/${t.id}`;
        return (
          <Link
            key={t.id}
            href={`/tola/${t.id}`}
            onClick={onPick}
            title={t.title}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition ${
              active ? "bg-brand-soft font-semibold text-brand-strong" : "text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            <MessageSquare size={14} className="shrink-0 text-ink-muted" />
            <span className="truncate">{t.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function NewChat({ onPick }: { onPick?: () => void }) {
  return (
    <Link
      href="/tola"
      onClick={onPick}
      className="mx-2 my-2 flex items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-white transition hover:bg-zinc-800"
    >
      <Plus size={16} strokeWidth={2.6} /> Cuộc trò chuyện mới
    </Link>
  );
}

export function TolaHistoryPanel({ threads }: { threads: TolaThreadView[] }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-white lg:flex">
      <NewChat />
      <List threads={threads} />
    </aside>
  );
}

export function TolaHistoryDrawer({ threads }: { threads: TolaThreadView[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Lịch sử hội thoại"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted transition hover:bg-zinc-100 hover:text-ink lg:hidden"
      >
        <PanelLeft size={18} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex bg-zinc-950/40 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Lịch sử hội thoại">
          <div onClick={(e) => e.stopPropagation()} className="flex w-[78%] max-w-[300px] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-[14px] font-semibold">Hội thoại</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-zinc-100">
                <X size={18} />
              </button>
            </div>
            <NewChat onPick={() => setOpen(false)} />
            <List threads={threads} onPick={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
