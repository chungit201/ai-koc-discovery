"use client";

import { ArrowUp, CircleCheck, Loader2 } from "lucide-react";
import { useOptimistic, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ChatMessage } from "@/lib/chat";
import { CAPABILITIES } from "@/lib/plan";

type Shown = ChatMessage & { pending?: boolean };

/**
 * Hội thoại tiếp theo trên một chiến dịch. Tin nhắn người dùng hiện **ngay khi gửi** (useOptimistic)
 * kèm một ô chờ cho câu trả lời — nếu đợi server xong mới hiện thì mỗi lượt im lặng vài chục giây.
 * Khi action xong, `revalidatePath` trả về danh sách thật và phần optimistic tự biến mất.
 */
export function ChatThread({
  campaignId,
  messages,
  action,
  placeholder = "Đổi ngân sách, bỏ một KOC, hỏi vì sao chọn…",
  quick = [],
  waiting = "AI đang xem lại dữ liệu chiến dịch…",
}: {
  /** Id của đối tượng đang trao đổi (chiến dịch hoặc KOC) — gửi kèm form dưới tên `id`. */
  campaignId: string;
  messages: ChatMessage[];
  action: (formData: FormData) => Promise<void>;
  placeholder?: string;
  quick?: string[];
  waiting?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [shown, addOptimistic] = useOptimistic(messages as Shown[], (state, text: string): Shown[] => [
    ...state,
    { id: "optimistic-user", role: "user", text, created_at: new Date() },
    { id: "optimistic-assistant", role: "assistant", text: "", pending: true, created_at: new Date() },
  ]);

  return (
    <>
      {shown.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[75%] rounded-2xl bg-zinc-100 px-4 py-3 text-[14.5px] leading-relaxed">{m.text}</div>
          </div>
        ) : (
          <div key={m.id} className="space-y-2 rounded-2xl border border-line bg-white px-4 py-3">
            {m.pending ? (
              <p className="flex items-center gap-2 text-[14px] text-ink-muted">
                <Loader2 size={15} className="animate-spin text-brand" /> {waiting}
              </p>
            ) : (
              <p className="text-[14.5px] leading-relaxed">{m.text}</p>
            )}
            {m.reasons && m.reasons.length > 0 && (
              <ul className="space-y-1.5 border-t border-line pt-2 text-[13.5px]">
                {m.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <CircleCheck size={15} className="mt-0.5 shrink-0 text-brand" /> {r.text}
                  </li>
                ))}
              </ul>
            )}
            {m.reruns && m.reruns.length > 0 && (
              <p className="text-[12.5px] text-ink-muted">Đang chạy lại: {m.reruns.map((cap) => CAPABILITIES[cap].title.toLowerCase()).join(" → ")}</p>
            )}
          </div>
        ),
      )}

      <div className="sticky bottom-0 -mx-6 bg-gradient-to-t from-page via-page to-transparent px-6 pb-5 pt-6">
        <form
          ref={ref}
          action={async (fd) => {
            const text = String(fd.get("text") ?? "").trim();
            if (!text) return;
            addOptimistic(text); // hiện ngay, trước khi server trả lời
            ref.current?.reset();
            await action(fd);
          }}
          className="rounded-2xl border border-line bg-white px-4 py-3 shadow-sm"
        >
          <input type="hidden" name="id" value={campaignId} />
          <textarea
            name="text"
            rows={2}
            required
            maxLength={1000}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            className="w-full resize-none bg-transparent text-[14px] outline-none placeholder:text-ink-muted"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {quick.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={(e) => {
                    const ta = e.currentTarget.form?.elements.namedItem("text") as HTMLTextAreaElement | null;
                    if (ta) ta.value = q;
                  }}
                  className="max-w-full truncate rounded-full border border-line px-2.5 py-1 text-[12px] text-zinc-600 hover:border-brand/40 hover:text-brand"
                >
                  {q}
                </button>
              ))}
            </div>
            <SendButton />
          </div>
        </form>
      </div>
    </>
  );
}

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Gửi"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-white transition hover:bg-brand-strong disabled:opacity-60"
    >
      {pending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.6} />}
    </button>
  );
}
