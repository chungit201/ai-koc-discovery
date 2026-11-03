"use client";

import { ArrowUp, AtSign, Flame, Loader2, RefreshCw, X } from "lucide-react";
import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ChatMessage } from "@/lib/chat";
import type { AskEvent, StepKind, StepPayload } from "@/lib/chat-events";
import { AI_NAME } from "@/lib/brand";
import { TolaMark } from "@/components/tola-mark";
import { AgentMessage, StepCard } from "@/components/ask-bar";

type Shown = ChatMessage & { pending?: boolean };
interface LiveStep {
  title: string;
  kind: StepKind;
  detail?: string;
  payload?: StepPayload;
  done: boolean;
}

const EXAMPLES = [
  "Tìm 5 KOC bán kem chống nắng doanh thu cao",
  "KOC nào đang tăng trưởng mạnh nhất tháng này?",
  "KOC nào chưa ký MCN mà tương tác trên 5%?",
  "So doanh thu mỹ phẩm của 3 KOC follower nhỏ nhất",
  "Chiến dịch gần nhất của tôi chọn ra những ai?",
];

/**
 * Màn hỏi đáp của trợ lý Tola. Một ô chat dùng chung cho mọi câu hỏi — ngữ cảnh "đang hỏi về ai"
 * nằm trong tag `@handle` của chính câu hỏi, không phụ thuộc trang.
 *
 * Trả lời đi theo luồng NDJSON (`/api/tola/ask`) nên từng thẻ công cụ hiện dần; chờ cả phút mà màn
 * hình đứng im thì người dùng tưởng hỏng và bỏ đi.
 */
export function TolaChat({ initialMessages = [], threadId: initialThread }: { initialMessages?: ChatMessage[]; threadId?: string }) {
  const [threadId, setThreadId] = useState(initialThread);
  const [messages, setMessages] = useState<Shown[]>(initialMessages as Shown[]);
  const [live, setLive] = useState<{ question: string; steps: LiveStep[] } | null>(null);
  const [showTips, setShowTips] = useState(true);
  const [tips, setTips] = useState(() => EXAMPLES.slice(0, 3));
  const taRef = useRef<HTMLTextAreaElement>(null);
  const busy = live !== null;
  const router = useRouter();
  const path = usePathname();

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setLive({ question: q, steps: [] });
    if (taRef.current) taRef.current.value = "";

    const id = threadId ?? crypto.randomUUID();
    setThreadId(id);
    try {
      const res = await fetch("/api/tola/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: q, threadId: id }),
      });
      if (!res.body) throw new Error("không có luồng trả về");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let final: Shown | null = null;
      // Giữ bản sao cục bộ: đọc `live` từ closure sau khi stream xong sẽ ra mảng rỗng của lần render cũ
      const seen: LiveStep[] = [];

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AskEvent;
          if (e.type === "step_add") {
            seen.push({ title: e.title, kind: e.kind, done: false });
            setLive((s) => (s ? { ...s, steps: [...seen] } : s));
          } else if (e.type === "step_done") {
            if (seen[e.index]) Object.assign(seen[e.index], { detail: e.detail, payload: e.payload, done: true });
            setLive((s) => (s ? { ...s, steps: [...seen] } : s));
          }
          else if (e.type === "conclusion")
            final = {
              id: crypto.randomUUID(),
              role: "assistant",
              agent: true,
              text: e.text,
              markdown: e.markdown,
              unverified: e.unverified,
              follow_ups: e.follow_ups,
              created_at: new Date(),
            } as Shown;
          else if (e.type === "error") final = { id: crypto.randomUUID(), role: "assistant", text: e.message, created_at: new Date() } as Shown;
        }
      }

      const steps = seen.map((s) => ({ title: s.title, detail: s.detail ?? "", kind: s.kind, payload: s.payload }));
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "user", text: q, created_at: new Date() } as Shown,
        final ? ({ ...final, steps: final.steps ?? steps } as Shown) : ({ id: crypto.randomUUID(), role: "assistant", text: "Mình chưa trả lời được câu này.", created_at: new Date() } as Shown),
      ]);
    } catch (err) {
      console.error(err);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "user", text: q, created_at: new Date() } as Shown,
        { id: crypto.randomUUID(), role: "assistant", text: "Mình gặp lỗi khi tra dữ liệu — bạn thử lại giúp mình nhé.", created_at: new Date() } as Shown,
      ]);
    } finally {
      setLive(null);
      setShowTips(false);
      /**
       * Câu đầu tiên của một luồng mới: đổi URL sang `/tola/<id>` và làm mới dữ liệu server để cột
       * lịch sử bên trái hiện hội thoại này. `replace` chứ không `push` — người dùng bấm back phải
       * ra khỏi trợ lý, không quay về màn trống cùng một luồng.
       */
      if (path === "/tola") {
        window.history.replaceState(null, "", `/tola/${id}`);
        router.refresh();
      } else router.refresh();
    }
  };

  const empty = messages.length === 0 && !live;

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col px-4 pb-6 pt-6 sm:px-6">
      {empty && (
        <div className="pb-6 pt-8 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-b from-[#454cab] to-[#1b1d4d] text-white shadow-[0_8px_22px_-8px_rgb(27_29_77_/_0.7)]">
            <TolaMark size={28} />
          </span>
          <h1 className="text-[20px] font-bold tracking-tight">Chỉ cần hỏi – nhận ngay</h1>
          <p className="mt-1 text-[14px] font-semibold text-brand">Insight từ dữ liệu TikTok thật</p>
        </div>
      )}

      <div className="flex-1 space-y-5">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-3 text-[14.5px] leading-relaxed">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="rounded-2xl border border-line bg-white px-4 py-3">
              {m.agent && (m.markdown || m.blocks?.length) ? <AgentMessage m={m} onAsk={(q) => void ask(q)} /> : <p className="text-[14.5px] leading-relaxed">{m.text}</p>}
            </div>
          ),
        )}

        {live && (
          <>
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-3 text-[14.5px] leading-relaxed">{live.question}</div>
            </div>
            <div className="space-y-2 rounded-2xl border border-line bg-white px-4 py-3">
              {live.steps.map((s, i) => (
                <StepCard key={i} index={i} title={s.title} detail={s.detail} done={s.done} running={!s.done} animate />
              ))}
              {/**
               * Giữa thẻ công cụ cuối và câu trả lời có một khoảng 20–40 giây model viết bài mà
               * KHÔNG phát sự kiện nào (nó nằm bên trong vòng lặp của claudeAgent, không biết trước
               * lúc nào model ngừng gọi công cụ để chuyển sang viết). Thiếu dòng này thì màn hình
               * đứng im và người dùng tưởng hỏng.
               */}
              {live.steps.every((s) => s.done) && (
                <p className="flex items-center gap-2 px-1 py-1 text-[14px] text-ink-muted">
                  <Loader2 size={15} className="shrink-0 animate-spin text-brand" />
                  {live.steps.length ? `${AI_NAME} đang viết câu trả lời…` : `${AI_NAME} đang đọc câu hỏi…`}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Ô nhập ── */}
      <div className="sticky bottom-20 mt-5 lg:bottom-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(taRef.current?.value ?? "");
          }}
          className="rounded-2xl border border-line bg-white px-4 py-3 shadow-sm"
        >
          <textarea
            ref={taRef}
            rows={2}
            maxLength={1000}
            disabled={busy}
            placeholder={`Giao việc hoặc hỏi bất cứ điều gì về KOC và chiến dịch của bạn`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(e.currentTarget.value);
              }
            }}
            className="w-full resize-none bg-transparent text-[14px] outline-none placeholder:text-ink-muted disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              title="Chèn KOC vào câu hỏi"
              onClick={() => {
                const ta = taRef.current;
                if (!ta) return;
                ta.value = `${ta.value}${ta.value && !ta.value.endsWith(" ") ? " " : ""}@`;
                ta.focus();
              }}
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-zinc-100 hover:text-ink"
            >
              <AtSign size={17} />
            </button>
            <button
              type="submit"
              disabled={busy}
              aria-label="Gửi"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-white transition hover:bg-brand-strong disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.6} />}
            </button>
          </div>
        </form>

        {empty && showTips && (
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[12.5px] font-semibold">
              <Flame size={14} className="text-brand" /> Câu hỏi phổ biến
              <button
                type="button"
                aria-label="Đổi gợi ý khác"
                onClick={() => setTips(() => [...EXAMPLES].sort(() => Math.random() - 0.5).slice(0, 3))}
                className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-ink-muted hover:bg-zinc-100"
              >
                <RefreshCw size={13} />
              </button>
              <button type="button" aria-label="Ẩn gợi ý" onClick={() => setShowTips(false)} className="grid h-7 w-7 place-items-center rounded-lg text-ink-muted hover:bg-zinc-100">
                <X size={14} />
              </button>
            </div>
            {tips.map((t) => (
              <button key={t} type="button" onClick={() => void ask(t)} className="block w-full border-b border-line px-4 py-3 text-left text-[13.5px] last:border-0 hover:bg-brand-soft/40">
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
