"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * Bảng có phân trang kiểu Kalodata (‹ 1 2 3 4 5 › · Đến [ ] Trang). Hàng do server dựng sẵn
 * (`rows` là mảng `<tr>`), client chỉ cắt trang — dữ liệu mỗi bảng nhỏ (≤ 50 hàng) nên không cần
 * gọi lại server khi đổi trang. Số thứ tự hàng do người gọi tự ghi theo vị trí toàn cục.
 */
export function PagedTable({ head, rows, pageSize = 10, minWidth = 640 }: { head: ReactNode; rows: ReactNode[]; pageSize?: number; minWidth?: number }) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const [page, setPage] = useState(1);
  const [jump, setJump] = useState("");
  const go = (p: number) => setPage(Math.min(pages, Math.max(1, p)));

  // Tối đa 5 nút số, trượt theo trang đang xem
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  const btn = "num grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-[13px] transition";

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth }}>
          {head}
          <tbody className="divide-y divide-line">{rows.slice((page - 1) * pageSize, page * pageSize)}</tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-line px-4 py-3 text-[13px] text-ink-muted">
          <button type="button" aria-label="Trang trước" disabled={page === 1} onClick={() => go(page - 1)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-zinc-100 disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          {nums.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => go(n)}
              aria-current={n === page ? "page" : undefined}
              className={`${btn} ${n === page ? "border-brand bg-brand font-semibold text-white" : "border-line bg-white text-ink hover:border-brand hover:text-brand"}`}
            >
              {n}
            </button>
          ))}
          <button type="button" aria-label="Trang sau" disabled={page === pages} onClick={() => go(page + 1)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-zinc-100 disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
          <form
            className="ml-2 flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (jump) go(Number(jump));
              setJump("");
            }}
          >
            Đến
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              aria-label="Số trang"
              className="num h-8 w-12 rounded-lg border border-line bg-white px-2 text-center text-ink outline-none focus:border-brand"
            />
            Trang
          </form>
        </div>
      )}
    </>
  );
}
