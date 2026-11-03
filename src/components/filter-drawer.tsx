"use client";

import { Check, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface FilterGroup {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

/**
 * Bộ lọc dạng drawer cho màn hình nhỏ. Trên điện thoại ba ô select + hàng nút sắp xếp chiếm hai
 * dòng toolbar và vẫn khó bấm; gom hết vào một nút có icon rồi mở tấm trượt từ đáy lên thì vừa gọn
 * vừa đúng thói quen thao tác bằng ngón cái.
 *
 * Chọn xong mới áp dụng một lần (`Xem kết quả`) thay vì đổi URL theo từng lần chạm — trên mạng di
 * động, mỗi lần đổi là một vòng tải lại cả trang.
 */
export function FilterDrawer({ groups, sorts, sortName = "sort", className = "" }: { groups: FilterGroup[]; sorts?: FilterGroup; sortName?: string; className?: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  const all = sorts ? [sorts, ...groups] : groups;
  // Nhóm sắp xếp không có lựa chọn "tất cả" → thiếu tham số nghĩa là đang dùng mục đầu tiên.
  // Không mặc định như vậy thì mở drawer ra không mục nào sáng, trông như chưa chọn gì.
  const fallback = (g: FilterGroup) => (g.name === sortName ? (g.options[0]?.value ?? "") : "");
  const read = () => Object.fromEntries(all.map((g) => [g.name, params.get(g.name) ?? fallback(g)]));
  const [draft, setDraft] = useState<Record<string, string>>(read);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    // Khoá cuộn nền để tấm trượt không kéo theo trang bên dưới
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  /** Số bộ lọc đang bật — không tính sắp xếp, vì nó luôn có một giá trị. */
  const activeCount = groups.filter((g) => (params.get(g.name) ?? "") !== "").length;

  const apply = () => {
    const next = new URLSearchParams(params);
    for (const g of all) {
      const v = draft[g.name] ?? "";
      if (v) next.set(g.name, v);
      else next.delete(g.name);
    }
    next.delete("page");
    setOpen(false);
    router.push(`${path}?${next}`);
  };

  const clear = () => setDraft(Object.fromEntries(all.map((g) => [g.name, g.name === sortName ? (draft[sortName] ?? "") : ""])));

  return (
    // `shrink-0` phải nằm ở lớp ngoài cùng: đây mới là flex-item cạnh ô tìm kiếm `w-full`,
    // thiếu nó thì nút bị bóp lại và chữ "Bộ lọc" rớt xuống hai dòng.
    <div className={`shrink-0 ${className}`}>
      <button
        type="button"
        // Đồng bộ nháp ngay lúc mở (không dùng effect): URL có thể đã đổi từ chỗ khác
        onClick={() => {
          setDraft(read());
          setOpen(true);
        }}
        aria-label={`Bộ lọc${activeCount ? ` (${activeCount} đang bật)` : ""}`}
        className={`flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border bg-white px-3 text-[13px] font-medium transition ${
          activeCount ? "border-brand text-brand-strong" : "border-line text-zinc-700"
        }`}
      >
        <SlidersHorizontal size={16} />
        Bộ lọc
        {activeCount > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-white">{activeCount}</span>}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end bg-zinc-950/40 backdrop-blur-sm" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Bộ lọc">
            <div onClick={(e) => e.stopPropagation()} className="animate-sheet flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <h2 className="text-[15px] font-semibold">Bộ lọc</h2>
                <button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-zinc-100">
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                {all.map((g) => (
                  <div key={g.name}>
                    <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{g.name === sortName ? "Sắp xếp theo" : g.label}</div>
                    <div className="flex flex-wrap gap-2">
                      {g.options.map((o) => {
                        const on = (draft[g.name] ?? "") === o.value;
                        return (
                          <button
                            key={o.value || "all"}
                            type="button"
                            onClick={() => setDraft((d) => ({ ...d, [g.name]: o.value }))}
                            aria-pressed={on}
                            className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-[13px] transition ${
                              on ? "border-brand bg-brand-soft font-semibold text-brand-strong" : "border-line text-zinc-700"
                            }`}
                          >
                            {on && <Check size={13} strokeWidth={3} />}
                            {o.value === "" ? g.label : o.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <button type="button" onClick={clear} className="h-11 flex-1 rounded-xl border border-line text-[14px] font-medium text-zinc-700">
                  Xoá lọc
                </button>
                <button type="button" onClick={apply} className="h-11 flex-[2] rounded-xl bg-brand text-[14px] font-semibold text-white shadow-[var(--shadow-pop)]">
                  Xem kết quả
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
