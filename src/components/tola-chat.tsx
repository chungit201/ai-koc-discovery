"use client";

import { ArrowUp, AtSign, Flame, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ChatMessage } from "@/lib/chat";
import type { AskEvent, StepKind, StepPayload } from "@/lib/chat-events";
import { AI_NAME } from "@/lib/brand";
import { TolaOrb } from "@/components/tola-mark";
import type { TolaSubject } from "@/lib/data/queries";
import { AgentMessage, hasStepBody, StepBody, StepCard } from "@/components/ask-bar";

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
/** Gợi ý khi đang hỏi về một KOC cụ thể (mở từ trang hồ sơ) — cùng bộ với popup ở trang KOC. */
const KOC_EXAMPLES = [
  "Đánh giá khả năng bán hàng, so với creator cùng tầm thế nào?",
  "Chủ yếu bán danh mục và sản phẩm nào?",
  "Chất lượng nội dung và cách review sản phẩm ra sao?",
  "Doanh thu có ổn định trong 30 ngày không?",
  "Chi phí hợp tác ước tính bao nhiêu một video?",
];

export function TolaChat({
  initialMessages = [],
  threadId: initialThread,
  subject: initialSubject,
  initialQuestion,
}: {
  initialMessages?: ChatMessage[];
  threadId?: string;
  /** Câu hỏi mang sang qua `/tola?q=` — gửi ngay khi mở màn. */
  initialQuestion?: string;
  /** KOC mang sang từ trang hồ sơ (`/tola?koc=`): mọi câu hỏi tự gắn `@handle` + gửi `creatorId`. */
  subject?: TolaSubject;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [threadId, setThreadId] = useState(initialThread);
  const [messages, setMessages] = useState<Shown[]>(initialMessages as Shown[]);
  const [live, setLive] = useState<{ question: string; steps: LiveStep[] } | null>(null);
  const [showTips, setShowTips] = useState(true);
  const [tips, setTips] = useState(() => (initialSubject ? KOC_EXAMPLES : EXAMPLES).slice(0, 3));
  const taRef = useRef<HTMLTextAreaElement>(null);
  const busy = live !== null;
  const router = useRouter();
  const path = usePathname();

  const ask = async (text: string) => {
    let q = text.trim();
    if (!q || busy) return;
    // Như popup ở trang KOC: gắn `@handle` để câu hỏi tự nói rõ đang hỏi về ai (mở lại vẫn hiểu)
    if (subject?.handle && !q.toLowerCase().includes(`@${subject.handle.toLowerCase()}`)) q = `${q} @${subject.handle}`;
    setLive({ question: q, steps: [] });
    if (taRef.current) taRef.current.value = "";

    const id = threadId ?? crypto.randomUUID();
    setThreadId(id);
    try {
      const res = await fetch("/api/tola/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: q, threadId: id, ...(subject ? { creatorId: subject.id } : {}) }),
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

  // Gửi câu hỏi mang sang từ trang khác đúng MỘT lần (ref chặn lần chạy đôi của StrictMode ở dev)
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!initialQuestion || sentInitial.current) return;
    sentInitial.current = true;
    void ask(initialQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy lúc mở màn
  }, []);

  const empty = messages.length === 0 && !live;

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col px-4 pb-6 pt-6 sm:px-6">
      {empty && (
        <div className="pb-6 pt-8 text-center">
          <TolaOrb size={64} className="mx-auto mb-3" />
          <h1 className="text-[20px] font-bold tracking-tight">{subject ? `Hỏi gì về ${subject.name}?` : "Chỉ cần hỏi – nhận ngay"}</h1>
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
            <div key={m.id} className="py-1">
              {m.agent && (m.markdown || m.blocks?.length) ? <AgentMessage m={m} onAsk={(q) => void ask(q)} /> : <p className="text-[14.5px] leading-relaxed">{m.text}</p>}
            </div>
          ),
        )}

        {live && (
          <>
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-3 text-[14.5px] leading-relaxed">{live.question}</div>
            </div>
            <div className="space-y-2 py-1">
              {live.steps.map((s, i) => (
                <StepCard key={i} index={i} title={s.title} detail={s.detail} done={s.done} running={!s.done} animate>
                  {/* Dẫn chứng của bước hiện NGAY lúc chạy: bảng kết quả công cụ, video AI đã xem, link web */}
                  {hasStepBody(s.payload) ? <StepBody payload={s.payload} /> : undefined}
                </StepCard>
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
      {/* Ghim sát đáy; nền + vùng an toàn iPhone để chữ cuộn phía sau không lộ qua */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-5 bg-page/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:-mx-6 sm:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(taRef.current?.value ?? "");
          }}
          className="rounded-2xl border border-line bg-white px-4 py-3 shadow-sm"
        >
          {subject && (
            <div className="mb-2 flex">
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-soft py-1 pl-2.5 pr-1 text-[12.5px] font-medium text-brand-strong">
                <span className="truncate">Đang hỏi về @{subject.handle}</span>
                <button type="button" aria-label="Bỏ KOC này" title="Hỏi chung, không gắn KOC" onClick={() => {
                    setSubject(undefined);
                    setTips(EXAMPLES.slice(0, 3));
                  }} className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-white/70">
                  <X size={12} />
                </button>
              </span>
            </div>
          )}
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
                onClick={() => setTips(() => [...(subject ? KOC_EXAMPLES : EXAMPLES)].sort(() => Math.random() - 0.5).slice(0, 3))}
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
