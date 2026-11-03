"use client";

import { ArrowUp, ArrowUpRight, CircleCheck, Expand, Globe, Lightbulb, Loader2, MessageCircle, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { ChatMessage } from "@/lib/chat";
import type { AnswerBlock, AskEvent, ReportData, StepKind, StepPayload, ToolTable } from "@/lib/chat-events";
import { AnswerMarkdown } from "@/components/answer-markdown";
import { Avatar } from "@/components/avatar";
import { ProductThumb } from "@/components/product-thumb";
import { VideoThumb } from "@/components/video-thumb";
import { compact, tiktokVideo, vnd } from "@/lib/format";

type Shown = ChatMessage & { pending?: boolean };

/** Trạng thái của lượt đang chạy, dựng dần từ các sự kiện NDJSON. */
interface LiveStep {
  title: string;
  kind: StepKind;
  detail?: string;
  /** Đã bắt đầu chạy (hiện spinner) — do client điều phối, không phụ thuộc tốc độ server. */
  started: boolean;
  done: boolean;
  payload?: StepPayload;
}
interface Live {
  question: string;
  steps: LiveStep[];
  conclusion?: { text: string; reasons: NonNullable<ChatMessage["reasons"]>; blocks?: AnswerBlock[]; follow_ups?: string[] };
  running: boolean;
  /** Chế độ agent: bước thêm dần theo từng lần gọi công cụ, không có kế hoạch định sẵn để bày. */
  agent?: boolean;
  /** Đã quá ngưỡng chờ → mới được phép bày kế hoạch ra (xem `PLAN_DELAY_MS`). */
  slow?: boolean;
  error?: string;
  /** Cuộc trò chuyện của lượt này — chỉ hiện khi đang mở đúng cuộc đó. */
  threadId: string;
  /** Số tin nhắn đã lưu của cuộc này lúc gửi — để ẩn bản lưu của chính lượt này cho tới khi đổi chỗ. */
  baseCount: number;
  /** Câu trả lời đã chảy chữ xong → được phép thay bằng bản đã lưu. */
  revealed?: boolean;
}

/**
 * Việc có "đáng bày kế hoạch" không. Câu hỏi một nguồn dữ liệu (liên hệ, MCN) mà cũng dựng
 * "Tôi sẽ thực hiện theo kế hoạch sau: 1… 2…" thì chỉ là thủ tục rỗng — trả lời thẳng tự nhiên hơn.
 */
const isHeavy = (steps: { kind: StepKind }[]) => steps.length >= 3 || steps.some((s) => s.kind === "videos" || s.kind === "peers");

/** Chỉ bày kế hoạch khi người dùng thật sự phải chờ; xong nhanh hơn mốc này thì không hiện. */
const PLAN_DELAY_MS = 700;

/** Áp một sự kiện vào trạng thái đang chạy. */
function applyEvent(set: React.Dispatch<React.SetStateAction<Live | null>>, e: AskEvent) {
  set((prev) => {
    if (!prev) return prev;
    switch (e.type) {
      case "plan":
        return { ...prev, agent: Boolean(e.agent), steps: e.steps.map((s) => ({ title: s.title, kind: s.kind, started: false, done: false })) };
      case "step_add":
        return { ...prev, steps: [...prev.steps, { title: e.title, kind: e.kind, started: false, done: false }] };
      case "step_start": {
        const steps = [...prev.steps];
        if (steps[e.index]) steps[e.index] = { ...steps[e.index], started: true };
        return { ...prev, steps };
      }
      case "step_done": {
        const steps = [...prev.steps];
        if (steps[e.index]) steps[e.index] = { ...steps[e.index], detail: e.detail, payload: e.payload, started: true, done: true };
        return { ...prev, steps };
      }
      case "conclusion":
        return { ...prev, conclusion: { text: e.text, reasons: e.reasons, blocks: e.blocks, follow_ups: e.follow_ups } };
      case "done":
        return { ...prev, running: false };
      case "error":
        return { ...prev, running: false, error: e.message };
      default:
        return prev;
    }
  });
}

/**
 * Chảy chữ kiểu ChatGPT: đếm số ký tự đã hiện, tăng đều theo `requestAnimationFrame` (mượt theo khung
 * hình màn hình, không giật như `setInterval`). Tốc độ tối thiểu 120 ký tự/giây và tự tăng để bài dài
 * cũng xong trong khoảng 6 giây — người đọc không phải ngồi chờ máy "gõ".
 */
function useReveal(total: number, active: boolean, onDone?: () => void): number {
  const [n, setN] = useState(active ? 0 : total);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (!active) return;
    const cps = Math.max(120, total / 6);
    let shown = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      shown = Math.min(total, shown + ((t - last) / 1000) * cps);
      last = t;
      setN(Math.floor(shown));
      if (shown < total) raf = requestAnimationFrame(tick);
      else done.current?.();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, total]);
  return active ? n : total;
}

/** Con trỏ nhấp nháy ở cuối phần chữ đang chảy. */
const Caret = () => <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-brand align-middle" />;

/** Chữ chạy dần — chỉ còn dùng cho khối "Kết luận" của luồng cũ (không có blocks). */
function Typewriter({ text, onDone }: { text: string; onDone?: () => void }) {
  const n = useReveal(text.length, true, onDone);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <Caret />}
    </>
  );
}

export interface ChatThreadView {
  id: string;
  title: string;
  updated_at: Date;
  messages: ChatMessage[];
}

/**
 * Hỏi AI về đối tượng đang xem (hồ sơ KOC): thanh nổi ở đáy màn hình, gửi xong mở **overlay hội
 * thoại** có sidebar lịch sử các cuộc trò chuyện.
 *
 * `threadId` do client sinh khi bắt đầu cuộc mới nên biết ngay cuộc nào đang mở, không phải chờ
 * server trả id. Câu hỏi hiện ngay (useOptimistic) kèm ô chờ vì một lượt mất hàng chục giây.
 */
export function AskBar({
  subjectId,
  subjectName,
  subjectHandle = "",
  threads,
  placeholder = "Hỏi về bất cứ điều gì trên màn hình",
  suggestions = [],
}: {
  subjectId: string;
  subjectName?: string;
  /** Handle TikTok, dùng để dựng link video gốc cho phần dẫn chứng. */
  subjectHandle?: string;
  threads: ChatThreadView[];
  placeholder?: string;
  suggestions?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // null = đang ở màn hình "cuộc trò chuyện mới"
  const [activeId, setActiveId] = useState<string | null>(threads[0]?.id ?? null);
  const active = threads.find((t) => t.id === activeId) ?? null;
  /** Lượt đang chạy: hiện dần theo luồng sự kiện từ server. */
  const [live, setLive] = useState<Live | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Người dùng đang ở (gần) cuối khung → nội dung mới thì bám theo; cuộn lên đọc thì để yên. */
  const stickRef = useRef(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * Bám đáy kiểu ChatGPT: mỗi khi nội dung cao thêm (chữ chảy, thẻ mới, ảnh tải xong) thì nhảy
   * **tức thì** xuống cuối — chỉ khi người dùng đang ở cuối. Bản cũ gọi `scrollIntoView smooth` mỗi
   * lần đổi state, các lần cuộn mượt chồng lên nhau nên màn hình giật.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!open || !scroller || !content) return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [open, activeId]);

  /**
   * Đổi lượt đang chạy sang bản đã lưu **khi đã chảy chữ xong và bản lưu đã về** — lúc đó hai bản
   * giống hệt nhau (bản lưu không có hiệu ứng) nên người dùng không thấy gì nhảy.
   */
  const savedCount = threads.find((t) => t.id === activeId)?.messages.length ?? 0;
  const swapped = Boolean(live && !live.running && (live.revealed || live.error) && savedCount >= live.baseCount + 2);
  /**
   * Lượt đang chạy còn hiển thị không (tính lúc render, không cần effect để dọn state). Phải đúng cuộc
   * đang mở: bấm "Cuộc trò chuyện mới" hay chuyển cuộc khác thì không được hiện lượt của cuộc cũ.
   */
  const cur = swapped || live?.threadId !== activeId ? null : live;

  const send = async (text: string, threadId: string | null) => {
    const trimmed = text.trim();
    if (!trimmed || live?.running) return;
    const id = threadId ?? crypto.randomUUID();
    setActiveId(id);
    setOpen(true);
    stickRef.current = true;
    setLive({ question: trimmed, steps: [], running: true, threadId: id, baseCount: threads.find((t) => t.id === id)?.messages.length ?? 0 });

    /**
     * **Nhịp hiển thị do client quyết định.** Server có thể trả cả luồng trong chưa tới 1 giây (khi
     * mọi thứ đã cache), nên không thể để giao diện phụ thuộc tốc độ phản hồi: sự kiện vào hàng
     * đợi, client nhả ra theo nhịp riêng và **ép mỗi bước hiện spinner tối thiểu SPIN_MS** trước
     * khi lật sang trạng thái xong. Đây chỉ là nhịp hiển thị — thời gian/chi phí thật vẫn in nguyên
     * trong phần mô tả từng bước.
     */
    // Việc nhẹ thì nhả nhanh cho đỡ lê thê; việc nặng mới giữ nhịp để mắt theo kịp từng bước
    let SPIN_MS = 220;
    let REVEAL_MS = 140;
    const queue: AskEvent[] = [];
    let streamEnded = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let startedAt = 0;
    const drain = (async () => {
      for (;;) {
        const e = queue.shift();
        if (!e) {
          if (streamEnded) return;
          await sleep(60);
          continue;
        }
        if (e.type === "plan") {
          // Việc nặng: giữ nhịp chậm hơn và bật đồng hồ chờ để quyết có bày kế hoạch hay không
          if (e.agent) {
            // Agent: server vốn chậm (mỗi lượt vài giây) → chỉ cần nhịp ngắn để thẻ không nháy
            SPIN_MS = 300;
            REVEAL_MS = 120;
          } else if (isHeavy(e.steps)) {
            SPIN_MS = 480;
            REVEAL_MS = 240;
            setTimeout(() => setLive((p) => (p?.running ? { ...p, slow: true } : p)), PLAN_DELAY_MS);
          }
          applyEvent(setLive, e);
          continue;
        }
        if (e.type === "step_start") {
          // Bật spinner NGAY và giữ suốt thời gian bước đó chạy thật (có thể hàng chục giây)
          applyEvent(setLive, e);
          startedAt = Date.now();
          continue;
        }
        if (e.type === "step_done") {
          applyEvent(setLive, { type: "step_start", index: e.index }); // phòng khi `step_start` chưa kịp tới
          const elapsed = startedAt ? Date.now() - startedAt : 0;
          if (elapsed < SPIN_MS) await sleep(SPIN_MS - elapsed); // server nhanh quá thì vẫn thấy spinner
          applyEvent(setLive, e);
          startedAt = 0;
          await sleep(REVEAL_MS);
          continue;
        }
        applyEvent(setLive, e);
        await sleep(REVEAL_MS);
      }
    })();

    try {
      const res = await fetch(`/api/kocs/${subjectId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed, threadId: id }),
      });
      if (!res.body) throw new Error("Không nhận được luồng trả lời");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? ""; // dòng cuối có thể chưa trọn vẹn
        for (const line of lines) {
          if (!line.trim()) continue;
          queue.push(JSON.parse(line) as AskEvent);
        }
      }
      streamEnded = true;
      await drain; // chờ nhả hết hàng đợi ra màn hình
    } catch (err) {
      console.error(err);
      streamEnded = true;
      setLive((p) => (p ? { ...p, running: false, error: "Mình gặp lỗi khi tra dữ liệu — bạn thử lại nhé." } : p));
      return;
    }
    // Luồng xong: tải bản đã lưu ngay (bị ẩn bằng `baseCount`), đổi chỗ khi chữ đã chảy xong — xem effect ở trên
    router.refresh();
  };

  // Trong lúc đang chạy, ẩn bản lưu của chính lượt này (refresh có thể về trước) để không hiện đôi
  const shown = ((active?.messages ?? []) as Shown[]).slice(0, cur ? cur.baseCount : undefined);

  return (
    <>
      {/* Thanh nổi ở đáy màn hình */}
      {!open && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5">
          {/* Chấm đỏ trên nút phóng to đã cho biết số cuộc trò chuyện → không cần chip riêng */}
          <div className="pointer-events-auto w-full max-w-[760px]">
            <Composer placeholder={placeholder} onSend={(t) => send(t, activeId)} rounded onExpand={() => setOpen(true)} badge={threads.length} busy={live?.running} />
          </div>
        </div>
      )}

      {/* Overlay hội thoại */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-sm" onClick={() => setOpen(false)} role="dialog" aria-modal="true">
            <div onClick={(e) => e.stopPropagation()} className="flex h-[92vh] w-full max-w-[1240px] overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
              {/* Sidebar lịch sử */}
              <aside className="hidden w-[260px] shrink-0 flex-col border-r border-line bg-zinc-50/60 p-3 md:flex">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="flex items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-white hover:bg-black"
                >
                  <Plus size={16} /> Cuộc trò chuyện mới
                </button>
                <div className="mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                  {threads.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveId(t.id)}
                      title={t.title}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] ${
                        t.id === activeId ? "bg-white font-medium shadow-sm" : "text-zinc-600 hover:bg-white/70"
                      }`}
                    >
                      <MessageCircle size={14} className="shrink-0 text-ink-muted" />
                      <span className="truncate">{t.title}</span>
                    </button>
                  ))}
                  {threads.length === 0 && <p className="px-2.5 py-2 text-[12.5px] text-ink-muted">Chưa có cuộc trò chuyện nào.</p>}
                </div>
              </aside>

              {/* Khung hội thoại */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand-strong text-white">
                    <Sparkles size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[15px] font-semibold">Hỏi đáp với AI{subjectName ? ` · ${subjectName}` : ""}</h2>
                    <p className="text-[12px] text-ink-muted">Trả lời từ dữ liệu đã thu thập, mỗi ý đều dẫn bằng chứng</p>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-zinc-100">
                    <X size={18} />
                  </button>
                </div>

                <div
                  ref={scrollerRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  }}
                  className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [overflow-anchor:none]"
                >
                  {/* Một khung cố định để ResizeObserver theo dõi, dù đang ở lượt chạy hay bản đã lưu */}
                  <div ref={contentRef}>
                  {cur ? (
                    <div className="mx-auto max-w-[820px] space-y-3">
                      {/* Các lượt trước trong cùng cuộc trò chuyện */}
                      {shown.map((m) => (
                        <Bubble key={m.id} m={m} handle={subjectHandle} onAsk={(q) => send(q, activeId)} />
                      ))}
                      <div className="flex justify-end">
                        <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-[14.5px] leading-relaxed">{cur.question}</div>
                      </div>
                      <LiveAnswer
                        live={cur}
                        handle={subjectHandle}
                        onAsk={(q) => send(q, activeId)}
                        onRevealed={() => setLive((p) => (p ? { ...p, revealed: true } : p))}
                      />
                    </div>
                  ) : shown.length === 0 ? (
                    <Welcome subjectName={subjectName} suggestions={suggestions} onPick={(t) => send(t, null)} />
                  ) : (
                    <div className="mx-auto max-w-[820px] space-y-3">
                      {shown.map((m) => (
                        <Bubble key={m.id} m={m} handle={subjectHandle} onAsk={(q) => send(q, activeId)} />
                      ))}
                    </div>
                  )}
                  </div>
                </div>

                <div className="border-t border-line px-5 py-3.5">
                  <div className="mx-auto max-w-[820px]">
                    <Composer placeholder={placeholder} onSend={(t) => send(t, activeId)} autoFocus busy={live?.running} />
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Một tin nhắn đã lưu: câu hỏi của người dùng, hoặc câu trả lời (có thể kèm các bước + dẫn chứng). */
function Bubble({ m, handle, onAsk }: { m: Shown; handle: string; onAsk: (q: string) => void }) {
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-[14.5px] leading-relaxed">{m.text}</div>
      </div>
    );
  // Việc nhẹ: khi mở lại cũng chỉ hiện câu trả lời, không dựng lại quy trình cho có
  if (m.steps?.length && !m.agent && !isHeavy(m.steps as { kind: StepKind }[]))
    return (
      <div className="space-y-3">
        {m.blocks?.length ? (
          <Answer blocks={m.blocks} data={{ report: m.report, peers: m.peers, videos: m.videos }} handle={handle} />
        ) : (
          <Conclusion text={m.text} reasons={m.reasons ?? []} report={m.report} />
        )}
        {m.follow_ups && m.follow_ups.length > 0 && <FollowUps items={m.follow_ups} onAsk={onAsk} />}
      </div>
    );

  return (
    <div className="space-y-3">
      {m.steps && m.steps.length > 0 ? (
        // Kế hoạch ở trên, rồi tới từng bước kèm dẫn chứng của riêng nó, kết luận tách riêng
        <>
          {!m.agent && <PlanList titles={m.steps.map((s) => s.title)} />}
          {m.steps.map((s, i) => {
            const items = s.payload?.table ? (
              <ToolTableView table={s.payload.table} handle={handle} compact />
            ) : s.payload?.web?.length ? (
              <WebLinks items={s.payload.web} />
            ) : m.agent ? null : s.kind === "data" && m.products?.length ? (
                <Products items={m.products} />
              ) : s.kind === "peers" && m.peers?.length ? (
                <Peers items={m.peers} />
              ) : s.kind === "videos" && m.videos?.length ? (
                <Videos items={m.videos} handle={handle} />
              ) : null;
            return (
              <div key={i} className="space-y-2">
                <StepCard index={i} title={s.title} detail={s.detail} done anchor={`${m.id}-step-${i}`}>
                  {items ?? undefined}
                </StepCard>
                {s.kind === "conclusion" && (
                  <>
                    {m.markdown ? (
                      <AnswerMarkdown markdown={m.markdown} unverified={m.unverified} sources={sourcesOf(m.steps ?? [], m.id)} />
                    ) : m.blocks?.length ? (
                      <Answer
                        blocks={m.blocks}
                        data={{ report: m.report, peers: m.peers, videos: m.videos }}
                        handle={handle}
                        sources={m.agent ? sourcesOf(m.steps ?? [], m.id) : undefined}
                      />
                    ) : (
                      <Conclusion text={m.text} reasons={m.reasons ?? []} report={m.report} />
                    )}
                    {m.follow_ups && m.follow_ups.length > 0 && <FollowUps items={m.follow_ups} onAsk={onAsk} />}
                  </>
                )}
              </div>
            );
          })}
        </>
      ) : (
        <div className="space-y-2 rounded-2xl border border-line bg-zinc-50/70 px-4 py-3">
          <p className="text-[14.5px] leading-relaxed">{m.text}</p>
          {m.reasons && m.reasons.length > 0 && (
            <ul className="space-y-1.5 border-t border-line pt-2 text-[13.5px]">
              {m.reasons.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <CircleCheck size={15} className="mt-0.5 shrink-0 text-brand" /> {r.text}
                </li>
              ))}
            </ul>
          )}
          {m.videos && m.videos.length > 0 && <Videos items={m.videos} handle={handle} />}
          {m.products && m.products.length > 0 && <Products items={m.products} />}
        </div>
      )}
    </div>
  );
}

/**
 * Tin nhắn agent đã lưu, dùng lại ở **chat chiến dịch** (`chat-thread.tsx`): các thẻ gọi công cụ kèm
 * bảng, rồi câu trả lời có chip nguồn và gợi ý hỏi tiếp — giống hệt chat KOC.
 */
export function AgentMessage({ m, handle = "", onAsk }: { m: ChatMessage; handle?: string; onAsk: (q: string) => void }) {
  return (
    <div className="space-y-2">
      {/* Quá trình xử lý thu gọn (như Kalopilot); chip nguồn bấm vào sẽ tự mở và cuộn tới đúng thẻ */}
      <details className="group rounded-xl border border-line bg-zinc-50/60 px-3 py-2">
        <summary className="cursor-pointer select-none text-[12.5px] font-medium text-ink-muted">
          Quá trình xử lý · {(m.steps ?? []).filter((s) => s.kind !== "conclusion").length} bước phân tích
        </summary>
        <div className="mt-2 space-y-2">
          {(m.steps ?? []).map((s, i) =>
            s.kind === "conclusion" ? null : (
              <StepCard key={i} index={i} title={s.title} detail={s.detail} done anchor={`${m.id}-step-${i}`}>
                {s.payload?.table ? <ToolTableView table={s.payload.table} handle={handle} compact /> : s.payload?.web?.length ? <WebLinks items={s.payload.web} /> : undefined}
              </StepCard>
            ),
          )}
        </div>
      </details>
      <div className="pt-1">
        {m.markdown ? (
          <AnswerMarkdown markdown={m.markdown} unverified={m.unverified} sources={sourcesOf(m.steps ?? [], m.id)} />
        ) : (
          <Answer blocks={m.blocks ?? []} data={{}} handle={handle} sources={sourcesOf(m.steps ?? [], m.id)} />
        )}
      </div>
      {m.follow_ups && m.follow_ups.length > 0 && <FollowUps items={m.follow_ups} onAsk={onAsk} />}
    </div>
  );
}

/**
 * Khối tuyên bố kế hoạch — hiện NGAY khi AI đọc xong câu hỏi, trước khi chạy bất cứ bước nào, để
 * người dùng biết sắp làm gì. Tách khỏi phần thực thi bên dưới.
 */
function PlanList({ titles, animate }: { titles: string[]; animate?: boolean }) {
  return (
    <div className={`${animate ? "animate-fade" : ""} space-y-2 text-[14.5px] leading-relaxed`}>
      <p>Tôi sẽ thực hiện theo kế hoạch sau:</p>
      <ol className="space-y-1.5">
        {titles.map((t, i) => (
          <li key={i} className="font-semibold">
            {i + 1}. {t}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Lượt đang chạy.
 * - Việc **nhẹ** (1–2 bước, không xem video/đối chuẩn): không bày kế hoạch, không card từng bước —
 *   chỉ một dòng trạng thái rồi ra thẳng câu trả lời, giống người trả lời bình thường.
 * - Việc **nặng**: bày kế hoạch (chỉ khi đã chờ quá `PLAN_DELAY_MS`) + card từng bước như cũ.
 */
function LiveAnswer({ live, handle, onAsk, onRevealed }: { live: Live; handle: string; onAsk: (q: string) => void; onRevealed: () => void }) {
  const heavy = live.agent || isHeavy(live.steps);
  const current = live.steps.find((s) => s.started && !s.done);
  // Gợi ý hỏi tiếp chỉ hiện khi câu trả lời đã chảy xong — như ChatGPT, không chen vào giữa
  const followUps = live.revealed && live.conclusion?.follow_ups?.length ? <FollowUps items={live.conclusion.follow_ups} onAsk={onAsk} animate /> : null;

  if (!heavy && live.steps.length > 0)
    return (
      <div className="space-y-3">
        {live.running && (
          <p className="animate-fade flex items-center gap-2 text-[14px] text-ink-muted">
            <Loader2 size={15} className="animate-spin text-brand" /> {current?.title ?? live.steps[live.steps.length - 1].title}…
          </p>
        )}
        {live.conclusion && (
          <>
            {live.conclusion.blocks?.length ? (
              <Answer
                blocks={live.conclusion.blocks}
                data={{
                  report: live.steps.find((s) => s.payload?.report)?.payload?.report,
                  peers: live.steps.find((s) => s.payload?.peers)?.payload?.peers,
                  videos: live.steps.find((s) => s.payload?.videos)?.payload?.videos,
                }}
                handle={handle}
                typing
                onRevealed={onRevealed}
              />
            ) : (
              <Conclusion
                text={live.conclusion.text}
                reasons={live.conclusion.reasons}
                report={live.steps.find((s) => s.payload?.report)?.payload?.report}
                typing
                onRevealed={onRevealed}
              />
            )}
            {followUps}
          </>
        )}
        {live.error && <p className="animate-fade text-[13.5px] text-rose-600">{live.error}</p>}
      </div>
    );

  return (
    <div className="space-y-3">
      {live.steps.length === 0 && (
        <p className="flex items-center gap-2 text-[14px] text-ink-muted">
          <Loader2 size={15} className="animate-spin text-brand" /> Đang đọc câu hỏi…
        </p>
      )}
      {/* Chỉ bày kế hoạch khi đã phải chờ đủ lâu — xong nhanh thì không cần khoe quy trình */}
      {live.steps.length > 0 && live.slow && !live.agent && <PlanList titles={live.steps.map((s) => s.title)} animate />}
      {live.steps.map((s, i) => {
        // Kết luận đứng thành khối riêng bên dưới card của bước, cho nổi hẳn
        const body = s.done ? (
          <>
            {s.payload?.table ? <ToolTableView table={s.payload.table} handle={handle} compact /> : null}
            {s.payload?.web?.length ? <WebLinks items={s.payload.web} /> : null}
            {s.payload?.products?.length ? <Products items={s.payload.products} /> : null}
            {s.payload?.peers?.length ? <Peers items={s.payload.peers} /> : null}
            {s.payload?.videos?.length ? <Videos items={s.payload.videos} handle={handle} /> : null}
          </>
        ) : null;
        const hasBody = Boolean(s.payload?.table || s.payload?.web?.length || s.payload?.products?.length || s.payload?.peers?.length || s.payload?.videos?.length);
        return (
          <div key={i} className="space-y-2">
            <StepCard index={i} title={s.title} detail={s.detail} done={s.done} running={s.started && !s.done} anchor={`live-step-${i}`} animate>
              {hasBody ? body : undefined}
            </StepCard>
            {/* Luôn gõ chữ ở lượt đang chạy: `done` tới ngay sau `conclusion` nên nếu phụ thuộc
                `live.running` thì typewriter tắt trước khi kịp render */}
            {s.kind === "conclusion" && s.done && live.conclusion && (
              <>
                {live.conclusion.blocks?.length ? (
                  <Answer
                    sources={live.agent ? sourcesOf(live.steps, "live") : undefined}
                    blocks={live.conclusion.blocks}
                    data={{
                      report: live.steps.find((x) => x.payload?.report)?.payload?.report,
                      peers: live.steps.find((x) => x.payload?.peers)?.payload?.peers,
                      videos: live.steps.find((x) => x.payload?.videos)?.payload?.videos,
                    }}
                    handle={handle}
                    typing
                    onRevealed={onRevealed}
                  />
                ) : (
                  <Conclusion text={live.conclusion.text} reasons={live.conclusion.reasons} report={s.payload?.report} typing onRevealed={onRevealed} />
                )}
                {followUps}
              </>
            )}
          </div>
        );
      })}
      {/* Agent: một dòng trạng thái CỐ ĐỊNH ở cuối khi đang chờ lượt suy nghĩ tiếp theo (giữa hai lần gọi
          công cụ). Bản cũ bật/tắt dòng này ở đầu danh sách nên cả khối nhảy lên xuống. */}
      {live.agent && live.running && !current && live.steps.length > 0 && !live.conclusion && (
        <p className="flex items-center gap-2 text-[13.5px] text-ink-muted">
          <Loader2 size={14} className="animate-spin text-brand" /> Đang đọc kết quả, quyết định bước tiếp…
        </p>
      )}
      {live.error && <p className="animate-fade text-[13.5px] text-rose-600">{live.error}</p>}
    </div>
  );
}

/**
 * Mỗi bước là **một card riêng**: tiêu đề + kết quả tóm tắt ở dải trên, dẫn chứng của riêng bước đó
 * ở thân card. Gộp hết vào một khối như trước khiến người dùng không phân biệt được bước nào ra gì.
 */
export function StepCard({
  index,
  title,
  detail,
  done,
  running,
  anchor,
  animate,
  children,
}: {
  index: number;
  title: string;
  detail?: string;
  done?: boolean;
  running?: boolean;
  /** id DOM để chip nguồn trong câu trả lời cuộn tới thẻ này. */
  anchor?: string;
  /** Chỉ lượt đang chạy mới mờ dần vào; tin đã lưu hiện tĩnh để lúc đổi chỗ không nháy lại. */
  animate?: boolean;
  children?: React.ReactNode;
}) {
  const hasBody = Boolean(children);
  return (
    <div
      id={anchor}
      className={`${animate ? "animate-fade" : ""} scroll-mt-4 overflow-hidden rounded-xl border transition-shadow ${done || running ? "border-line bg-white" : "border-dashed border-zinc-200 bg-white/60"}`}
    >
      <div className={`flex items-start gap-2 px-3.5 py-2.5 text-[13px] ${hasBody ? "border-b border-line bg-zinc-50/80" : ""}`}>
        <span className="mt-0.5 shrink-0">
          {running ? (
            <Loader2 size={16} className="animate-spin text-brand" />
          ) : done ? (
            <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-brand text-[10px] font-bold text-white">{index + 1}</span>
          ) : (
            <span className="grid h-[18px] w-[18px] place-items-center rounded-full border border-zinc-300 text-[10px] font-bold text-zinc-400">{index + 1}</span>
          )}
        </span>
        <span className={`min-w-0 ${done || running ? "" : "text-ink-muted"}`}>
          <b className="font-semibold">{title}</b>
          {detail ? <span className="text-ink-muted"> — {detail}</span> : null}
        </span>
      </div>
      {hasBody && <div className="px-3.5 py-3">{children}</div>}
    </div>
  );
}

/** evidence_id → thẻ công cụ đã sinh ra nó (chế độ agent). */
type Sources = Record<string, { anchor: string; index: number; title: string }>;

/** Dựng bản đồ nguồn từ các bước: bước nào sinh evidence nào. */
function sourcesOf(steps: { title: string; payload?: StepPayload }[], prefix: string): Sources {
  const out: Sources = {};
  steps.forEach((s, i) => {
    if (s.payload?.evidence_id) out[s.payload.evidence_id] = { anchor: `${prefix}-step-${i}`, index: i, title: s.title };
  });
  return out;
}

/**
 * Chip "nguồn" dưới mỗi câu: câu này dựa vào kết quả công cụ nào. Bấm → cuộn tới thẻ đó và nháy viền
 * để người bán tự đối chiếu số trong câu với bảng gốc.
 */
function SourceChips({ ids, sources, urls }: { ids?: string[]; sources?: Sources; urls?: string[] }) {
  const hits = (ids ?? []).map((id) => sources?.[id]).filter((s): s is Sources[string] => Boolean(s));
  if (!hits.length && !urls?.length) return null;
  const jump = (anchor: string) => {
    const el = document.getElementById(anchor);
    if (!el) return;
    el.closest("details")?.setAttribute("open", ""); // thẻ nằm trong "Quá trình xử lý" đang thu gọn
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-brand");
    setTimeout(() => el.classList.remove("ring-2", "ring-brand"), 1600);
  };
  return (
    <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
      {hits.map((s) => (
        <button
          key={s.anchor}
          type="button"
          onClick={() => jump(s.anchor)}
          title={`Bằng chứng: bước ${s.index + 1} — ${s.title}`}
          className="rounded-full border border-brand/30 bg-brand-soft/50 px-1.5 py-px text-[10.5px] font-medium leading-4 text-brand-strong hover:bg-brand-soft"
        >
          {s.index + 1}. {s.title.length > 26 ? `${s.title.slice(0, 25)}…` : s.title}
        </button>
      ))}
      {/* Nguồn web: thông tin NGOÀI dữ liệu Kalodata — màu khác để không lẫn với số liệu đã kiểm */}
      {(urls ?? []).map((u) => (
        <a
          key={u}
          href={u}
          target="_blank"
          rel="noreferrer"
          title={u}
          className="inline-flex items-center gap-0.5 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-px text-[10.5px] font-medium leading-4 text-sky-700 hover:bg-sky-100"
        >
          <Globe size={10} /> {domainOf(u)}
        </a>
      ))}
    </span>
  );
}

const domainOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u.slice(0, 30);
  }
};

/** Thẻ "Tìm kiếm trên web": các kết quả agent đã thấy. */
function WebLinks({ items }: { items: { title: string; url: string }[] }) {
  return (
    <ul className="space-y-1">
      {items.map((l) => (
        <li key={l.url} className="flex min-w-0 items-center gap-2 text-[12.5px]">
          <Globe size={12} className="shrink-0 text-sky-600" />
          <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-brand hover:underline">
            {l.title}
          </a>
          <span className="shrink-0 text-[11px] text-ink-muted">{domainOf(l.url)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Kết luận: khối nổi bật ở cuối để người dùng biết ngay đâu là câu trả lời. */
/** Ba khối số liệu rời — model chọn chèn khối nào, số liệu do code tính từ DB. */
function Overview({ data }: { data: ReportData }) {
  return (
    <p className="num text-[13.5px] text-zinc-700">
      Doanh thu mỹ phẩm <b>{vnd(data.revenue)}</b> · {data.products_count} sản phẩm · {data.videos_count} video · {compact(data.followers)} follower
      <span className="text-ink-muted"> (30 ngày)</span>
    </p>
  );
}

function CategoryTable({ data }: { data: ReportData }) {
  if (!data.categories.length) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <table className="w-full text-[12.5px]">
        <thead className="bg-zinc-50 text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-1.5 font-semibold">Danh mục</th>
            <th className="px-3 py-1.5 font-semibold">Nhóm sản phẩm chính</th>
            <th className="px-3 py-1.5 text-right font-semibold">Doanh thu</th>
          </tr>
        </thead>
        <tbody>
          {data.categories.map((c) => (
            <tr key={c.name} className="border-t border-line">
              <td className="px-3 py-1.5 font-medium">{c.name}</td>
              <td className="px-3 py-1.5 text-zinc-600">{c.sub.join(", ") || "—"}</td>
              <td className="num px-3 py-1.5 text-right">
                {vnd(c.revenue)} <span className="text-ink-muted">· {Math.round(c.share * 100)}%</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopProductTable({ data }: { data: ReportData }) {
  if (!data.top_products.length) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <table className="w-full text-[12.5px]">
        <tbody>
          {data.top_products.map((p) => (
            <tr key={p.product_id} className="border-t border-line first:border-t-0">
              <td className="num w-8 px-3 py-2 text-ink-muted">{p.rank}</td>
              {/* Ảnh bìa lấy thẳng từ CDN Kalodata theo product_id — không cần crawl, không cần lưu */}
              <td className="w-12 py-2 pl-1">
                <ProductThumb id={p.product_id} name={p.name} />
              </td>
              <td className="px-3 py-2">
                <span className="line-clamp-2">{p.name}</span>
              </td>
              <td className="num w-40 px-3 py-2 text-right">
                {vnd(p.revenue)} <span className="text-ink-muted">· {Math.round(p.share * 100)}%</span>
                {p.sales_volume > 0 && <div className="text-ink-muted">{compact(p.sales_volume)} đơn</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Bảng video nổi bật — số liệu từ DB (0 token), khác với khối `Videos` là các video AI đã xem
 * khung hình. Ảnh bìa bấm vào phát được, giống chỗ dẫn chứng video.
 */
function TopVideoTable({ data, handle }: { data: ReportData; handle: string }) {
  if (!data.top_videos.length) return null;
  return (
    <div className="space-y-1.5">
      {data.top_videos.map((v) => (
        <div key={v.video_id} className="flex items-start gap-2.5 rounded-lg border border-line bg-white p-2">
          <VideoThumb id={v.video_id} title={v.title} tiktokUrl={tiktokVideo(handle, v.video_id)} />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[12.5px]">{v.title}</p>
            <p className="mt-1 text-[11.5px] text-ink-muted">
              {compact(v.views)} view · {compact(v.likes)} like
              {v.revenue > 0 && <> · {vnd(v.revenue)}</>}
              {/* Video chạy quảng cáo thì lượt xem không phản ánh sức hút tự nhiên — phải nói rõ */}
              {v.is_ad && <span className="ml-1 rounded bg-amber-100 px-1 py-px text-[10.5px] text-amber-800">quảng cáo</span>}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

const SCORE_SHORT: Record<string, string> = {
  performance: "hiệu suất",
  content_fit: "hợp SP",
  engagement: "tương tác",
  growth: "tăng trưởng",
  cost_fit: "ngân sách",
  consistency: "ổn định",
  audience_fit: "khán giả",
};

/**
 * Bảng từ hàng kết quả của một công cụ agent (`koc-data/tools.ts`) — số do code tính, vẽ theo loại
 * công cụ. `compact` dùng trong thẻ của bước (ít cột, giới hạn chiều cao như thẻ Kalopilot).
 */
function ToolTableView({ table, handle, compact: small }: { table: ToolTable; handle: string; compact?: boolean }) {
  const rows = table.rows as Record<string, never>[];
  const s = (v: unknown) => String(v ?? "");
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const share = (v: unknown) => `${(Math.round(n(v) * 1000) / 10).toLocaleString("vi-VN")}%`;
  // `overflow-x-auto` thay cho `overflow-hidden`: bảng nhiều cột trên điện thoại cuộn ngang được
  const frame = `overflow-x-auto rounded-lg border border-line bg-white ${small ? "max-h-[280px] overflow-y-auto" : ""}`;

  if (table.tool === "list_products")
    return (
      <div className={frame}>
        <table className="w-full text-[12.5px]">
          <tbody>
            {rows.map((p) => (
              <tr key={s(p.product_id)} className="border-t border-line first:border-t-0">
                <td className="num w-8 px-3 py-2 text-ink-muted">{s(p.rank)}</td>
                <td className="w-12 py-2 pl-1">
                  <ProductThumb id={s(p.product_id)} name={s(p.name)} />
                </td>
                <td className="px-3 py-2">
                  <span className="line-clamp-2">{s(p.name)}</span>
                  {!small && <span className="text-[11.5px] text-ink-muted">{s(p.cat3) || s(p.cat2) || s(p.cat1)} · giá {vnd(n(p.price))}</span>}
                </td>
                <td className="num w-36 px-3 py-2 text-right">
                  {vnd(n(p.revenue))} <span className="text-ink-muted">· {share(p.share)}</span>
                  <div className="text-ink-muted">{compact(n(p.orders))} đơn</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  if (table.tool === "category_breakdown")
    return (
      <div className={frame}>
        <table className="w-full text-[12.5px]">
          <thead className="bg-zinc-50 text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-1.5 font-semibold">Danh mục</th>
              {!small && <th className="px-3 py-1.5 font-semibold">Nhóm chính</th>}
              <th className="px-3 py-1.5 text-right font-semibold">Doanh thu</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={s(c.name)} className="border-t border-line">
                <td className="px-3 py-1.5 font-medium">
                  {s(c.name)} <span className="font-normal text-ink-muted">· {s(c.products)} SP</span>
                </td>
                {!small && <td className="px-3 py-1.5 text-zinc-600">{((c.sub as unknown as string[]) ?? []).join(", ") || "—"}</td>}
                <td className="num px-3 py-1.5 text-right">
                  {vnd(n(c.revenue))} <span className="text-ink-muted">· {share(c.share)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  if (table.tool === "list_videos")
    return (
      <div className={`space-y-1.5 ${small ? "max-h-[280px] overflow-y-auto" : ""}`}>
        {rows.map((v) => {
          const product = ((v.products as unknown as { name: string }[]) ?? [])[0]?.name;
          return (
            <div key={s(v.video_id)} className="flex items-start gap-2.5 rounded-lg border border-line bg-white p-2">
              <VideoThumb id={s(v.video_id)} title={s(v.title)} tiktokUrl={tiktokVideo(handle, s(v.video_id))} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[12.5px]">{s(v.title)}</p>
                <p className="num mt-1 text-[11.5px] text-ink-muted">
                  {s(v.publish_date).slice(0, 10)} · {compact(n(v.views))} view · {compact(n(v.likes))} like · {vnd(n(v.revenue))} ({compact(n(v.orders))} đơn)
                  {v.is_ad && (
                    <span className="ml-1 rounded bg-amber-100 px-1 py-px text-[10.5px] text-amber-800">
                      quảng cáo {vnd(n(v.ad_cost))} · ROAS {n(v.ad_roas).toLocaleString("vi-VN")}
                    </span>
                  )}
                </p>
                {product && !small && <p className="mt-0.5 truncate text-[11.5px] text-zinc-600">Gắn: {product}</p>}
              </div>
            </div>
          );
        })}
      </div>
    );

  if (table.tool === "analyze_videos")
    return (
      <div className={`space-y-2 ${small ? "max-h-[360px] overflow-y-auto" : ""}`}>
        {rows.map((v) => {
          const frames = (v.frames as unknown as { i: number; note: string }[]) ?? [];
          const risks = (v.risks as unknown as string[]) ?? [];
          return (
            <div key={s(v.video_id)} className="rounded-lg border border-line bg-white p-2.5">
              <div className="flex items-start gap-2.5">
                <VideoThumb id={s(v.video_id)} title={s(v.title)} tiktokUrl={tiktokVideo(handle, s(v.video_id))} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[12.5px] font-medium">{s(v.title)}</p>
                  <p className="num mt-0.5 text-[11.5px] text-ink-muted">
                    {compact(n(v.views))} view · {vnd(n(v.revenue))}
                    {s(v.product) && <> · gắn {s(v.product).slice(0, 40)}</>}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
                    <span className={`rounded px-1.5 py-px ${v.product_demo === "có" ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                      demo {s(v.product_demo)} · {s(v.demo_score)}/100
                    </span>
                    <span className="rounded bg-zinc-100 px-1.5 py-px text-zinc-600">hình ảnh {s(v.production_quality)}/100</span>
                    <span className="rounded bg-zinc-100 px-1.5 py-px text-zinc-600">tự nhiên {s(v.authenticity)}/100</span>
                  </p>
                  <p className="mt-1 text-[12.5px]">{s(v.summary)}</p>
                </div>
              </div>
              {/* Chính 4 khung hình AI đã nhìn — bằng chứng gốc của nhận định bên trên */}
              {!small && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/frames/${s(v.video_id)}`} alt="4 khung hình AI đã xem" className="mt-2 w-full rounded-md border border-line" loading="lazy" />
              )}
              {frames.length > 0 && (
                <ol className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px] text-zinc-600 sm:grid-cols-4">
                  {frames.map((f) => (
                    <li key={f.i}>
                      <b className="text-ink-muted">
                        {f.i}
                        {((v.times as unknown as number[]) ?? [])[f.i - 1] !== undefined ? ` · ${((v.times as unknown as number[]) ?? [])[f.i - 1]}s` : ""}
                      </b>{" "}
                      {f.note}
                    </li>
                  ))}
                </ol>
              )}
              {risks.length > 0 && <p className="mt-1 text-[11.5px] text-amber-700">Lưu ý: {risks.join("; ")}</p>}
            </div>
          );
        })}
        <p className="text-[11px] text-ink-muted">AI chỉ nhìn 4 khung hình tĩnh, không nghe được âm thanh; điểm là nhận định của AI.</p>
      </div>
    );

  if (table.tool === "campaign_context")
    return (
      <div className={frame}>
        <table className="w-full text-[12.5px]">
          <thead className="bg-zinc-50 text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-1.5 font-semibold">KOC</th>
              <th className="px-3 py-1.5 text-right font-semibold">Điểm</th>
              {!small && <th className="px-3 py-1.5 font-semibold">Điểm thành phần</th>}
              <th className="px-3 py-1.5 text-right font-semibold">Ngân sách</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={s(k.creator_id)} className={`border-t border-line ${k.picked ? "" : "text-zinc-500"}`}>
                <td className="px-3 py-1.5">
                  <a href={`/kocs/${s(k.creator_id)}`} className="flex items-center gap-2 hover:text-brand">
                    <Avatar id={s(k.creator_id)} name={s(k.name)} size={22} />
                    <span className="truncate font-medium">{s(k.name)}</span>
                    <span className="text-[11px] text-ink-muted">{k.picked ? "được chọn" : "dự phòng"}</span>
                  </a>
                </td>
                <td className="num px-3 py-1.5 text-right font-semibold">{s(k.total)}</td>
                {!small && (
                  <td className="px-3 py-1.5 text-[11.5px] text-zinc-600">
                    {Object.entries((k.scores as unknown as Record<string, number>) ?? {})
                      .map(([key, v]) => `${SCORE_SHORT[key] ?? key} ${v}`)
                      .join(" · ")}
                  </td>
                )}
                <td className="num px-3 py-1.5 text-right">{n(k.budget) ? vnd(n(k.budget)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  if (table.tool === "allocate_budget") {
    const sum = rows.reduce((a, r) => a + n(r.budget), 0);
    return (
      <div className={frame}>
        <table className="w-full text-[12.5px]">
          <thead className="bg-zinc-50 text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-1.5 font-semibold">KOC</th>
              <th className="px-3 py-1.5 text-right font-semibold">Ngân sách</th>
              {!small && <th className="px-3 py-1.5 text-right font-semibold">Chi phí ước tính/video</th>}
              <th className="px-3 py-1.5 text-right font-semibold">Đủ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={s(k.creator_id)} className="border-t border-line">
                <td className="px-3 py-1.5">
                  <a href={`/kocs/${s(k.creator_id)}`} className="flex items-center gap-2 hover:text-brand">
                    <Avatar id={s(k.creator_id)} name={s(k.name)} size={22} />
                    <span className="truncate font-medium">{s(k.name)}</span>
                    <span className="num text-[11px] text-ink-muted">{compact(n(k.followers))} fl</span>
                  </a>
                </td>
                <td className="num px-3 py-1.5 text-right font-semibold">
                  {vnd(n(k.budget))} <span className="font-normal text-ink-muted">· {share(k.share)}</span>
                </td>
                {!small && (
                  <td className="num px-3 py-1.5 text-right text-zinc-600">
                    {vnd(n(k.cost_min))}–{vnd(n(k.cost_max))}
                  </td>
                )}
                <td className="num px-3 py-1.5 text-right">
                  {k.affordable ? (
                    <span className="text-zinc-600">{s(k.videos_min_cost)} video</span>
                  ) : (
                    <span className="rounded bg-amber-50 px-1.5 py-px text-amber-700">0 video</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-zinc-50 font-semibold">
              <td className="px-3 py-1.5">Tổng</td>
              <td className="num px-3 py-1.5 text-right">{vnd(sum)}</td>
              {!small && <td />}
              <td />
            </tr>
          </tfoot>
        </table>
        <p className="px-3 py-1.5 text-[11px] text-ink-muted">
          Chi phí/video là ước tính theo quy mô follower, không phải giá chào của KOC. &quot;Đủ&quot; = số video mua được ở mức thấp nhất của khoảng.
        </p>
      </div>
    );
  }

  if (table.tool === "get_peers")
    return (
      <div className={frame}>
        <table className="w-full text-[12.5px]">
          <tbody>
            {rows.map((p) => (
              <tr key={s(p.creator_id)} className={`border-t border-line first:border-t-0 ${p.self ? "bg-brand-soft/40 font-semibold" : ""}`}>
                <td className="num w-8 px-3 py-1.5 text-ink-muted">{s(p.rank)}</td>
                <td className="px-2 py-1.5">
                  <a href={`/kocs/${s(p.creator_id)}`} className="flex items-center gap-2 hover:text-brand">
                    <Avatar id={s(p.creator_id)} name={s(p.name)} size={22} />
                    <span className="truncate">{s(p.name)}</span>
                    {p.self && <span className="text-[11px] font-normal text-brand">(KOC này)</span>}
                  </a>
                </td>
                <td className="num px-3 py-1.5 text-right text-ink-muted">{compact(n(p.followers))} fl</td>
                <td className="num px-3 py-1.5 text-right">{vnd(n(p.revenue))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return null;
}

function Answer({
  blocks,
  data,
  handle,
  typing,
  sources,
  onRevealed,
}: {
  blocks: AnswerBlock[];
  data: { report?: ReportData; peers?: ChatMessage["peers"]; videos?: ChatMessage["videos"]; products?: ChatMessage["products"] };
  handle: string;
  typing?: boolean;
  /** Chế độ agent: evidence_id → thẻ công cụ, để gắn chip nguồn dưới từng câu. */
  sources?: Sources;
  /** Gọi một lần khi đã chảy hết chữ. */
  onRevealed?: () => void;
}) {
  /**
   * Chảy chữ **liên tục qua mọi khối** theo thứ tự đọc, như ChatGPT: hết đoạn này mới tới đoạn sau,
   * bảng chỉ hiện (mờ dần) khi dòng chữ chảy tới chỗ của nó. Bản cũ chỉ gõ đoạn đầu còn mọi khối khác
   * cùng nhích lên một lúc nên cả bài giật. Mỗi khối "tốn" bằng độ dài chữ; bảng tốn cố định
   * `TABLE_COST` để tạo một nhịp dừng ngắn.
   */
  const TABLE_COST = 60;
  const cost = (b: AnswerBlock) =>
    b.type === "bullets" || b.type === "advice" ? b.items.reduce((a, it) => a + it.text.length, 0) : b.type === "table" || b.type === "data" ? TABLE_COST : b.text.length;
  const total = blocks.reduce((a, b) => a + cost(b), 0);
  const n = useReveal(total, Boolean(typing), onRevealed);
  const streaming = Boolean(typing) && n < total;

  let budget = n;
  const out: React.ReactNode[] = [];
  for (const [i, b] of blocks.entries()) {
    if (budget <= 0 && streaming) break;
    const c = cost(b);
    const part = streaming ? Math.min(c, budget) : c;
    const partial = part < c; // khối đang chảy dở → con trỏ ở cuối, chưa hiện chip nguồn
    budget -= c;
    const text = (s: string) => (partial ? s.slice(0, part) : s);

    if (b.type === "heading") out.push(<h3 key={i} className="pt-1 text-[16px] font-bold tracking-tight">{text(b.text)}</h3>);
    else if (b.type === "para")
      out.push(
        <p key={i}>
          {text(b.text)}
          {partial ? <Caret /> : <SourceChips ids={b.evidence_ids} sources={sources} urls={b.web_urls} />}
        </p>,
      );
    else if (b.type === "bullets") {
      // Chảy lần lượt từng ý trong danh sách
      let left = part;
      const items: React.ReactNode[] = [];
      for (const [k, it] of b.items.entries()) {
        if (left <= 0) break;
        const shown = Math.min(it.text.length, left);
        left -= it.text.length;
        const cut = shown < it.text.length;
        items.push(
          <li key={k} className="flex gap-2 text-[14px]">
            <CircleCheck size={15} className="mt-1 shrink-0 text-brand" />
            <span>
              {cut ? it.text.slice(0, shown) : it.text}
              {cut ? <Caret /> : <SourceChips ids={it.evidence_ids} sources={sources} urls={it.web_urls} />}
            </span>
          </li>,
        );
      }
      out.push(
        <ul key={i} className="space-y-1.5">
          {items}
        </ul>,
      );
    } else if (b.type === "advice") {
      // Nhận định nghề, không phải số liệu — dán nhãn rõ để người bán biết ranh giới giữa hai thứ
      let left = part;
      const items: React.ReactNode[] = [];
      for (const [k, it] of b.items.entries()) {
        if (left <= 0) break;
        const shown = Math.min(it.text.length, left);
        left -= it.text.length;
        const cut = shown < it.text.length;
        items.push(
          <li key={k} className="flex gap-2">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-500" />
            <span>
              {cut ? it.text.slice(0, shown) : it.text}
              {cut ? <Caret /> : <SourceChips ids={it.evidence_ids} sources={sources} />}
            </span>
          </li>,
        );
      }
      out.push(
        <div key={i} className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3 text-[13.5px]">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-800">
            <Lightbulb size={13} /> {b.title || "Nhận định khi triển khai"} · kinh nghiệm, không phải số liệu Kalodata
          </p>
          <ul className="space-y-1.5">{items}</ul>
        </div>,
      );
    } else if (b.type === "closing")
      out.push(
        <p key={i} className="text-ink-muted">
          {text(b.text)}
          {partial && <Caret />}
        </p>,
      );
    else if (partial) break; // bảng chỉ hiện khi dòng chữ đã tới hẳn chỗ của nó
    else if (b.type === "table")
      out.push(
        <div key={i} className={typing ? "animate-fade" : ""}>
          {b.title && <h4 className="mb-1.5 text-[13.5px] font-semibold">{b.title}</h4>}
          <ToolTableView table={b.table} handle={handle} />
        </div>,
      );
    else out.push(<DataBlock key={i} b={b} data={data} handle={handle} fade={Boolean(typing)} />);
  }
  return <div className="space-y-3 text-[14.5px] leading-relaxed">{out}</div>;
}

/** Khối dữ liệu của luồng cũ: số liệu do code dựng, model chỉ chọn chèn và đặt tiêu đề. */
function DataBlock({
  b,
  data,
  handle,
  fade,
}: {
  b: Extract<AnswerBlock, { type: "data" }>;
  data: { report?: ReportData; peers?: ChatMessage["peers"]; videos?: ChatMessage["videos"] };
  handle: string;
  fade: boolean;
}) {
  return (
    <div className={fade ? "animate-fade" : ""}>
      {b.title && <h4 className="mb-1.5 text-[13.5px] font-semibold">{b.title}</h4>}
      {b.data === "overview" && data.report && <Overview data={data.report} />}
      {b.data === "categories" && data.report && <CategoryTable data={data.report} />}
      {b.data === "top_products" && data.report && <TopProductTable data={data.report} />}
      {b.data === "peers" && data.peers?.length ? <Peers items={data.peers} /> : null}
      {b.data === "videos" && data.videos?.length ? <Videos items={data.videos} handle={handle} /> : null}
      {b.data === "top_videos" && data.report?.top_videos.length ? <TopVideoTable data={data.report} handle={handle} /> : null}
    </div>
  );
}

function Conclusion({
  text,
  reasons,
  report,
  typing,
  onRevealed,
}: {
  text: string;
  reasons: NonNullable<ChatMessage["reasons"]>;
  report?: ReportData;
  typing?: boolean;
  onRevealed?: () => void;
}) {
  return (
    <div className="rounded-xl border border-brand/30 bg-brand-soft/40 px-4 py-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-brand">
        <Sparkles size={13} /> Kết luận
      </p>
      <p className="text-[14.5px] font-medium leading-relaxed">{typing ? <Typewriter key={text} text={text} onDone={onRevealed} /> : text}</p>
      {reasons.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-t border-brand/20 pt-2 text-[13.5px]">
          {reasons.map((r, i) => (
            <li key={i} className="flex gap-2">
              <CircleCheck size={15} className="mt-0.5 shrink-0 text-brand" /> {r.text}
            </li>
          ))}
        </ul>
      )}
      {/* Tin nhắn cũ (trước khi model tự dựng bố cục) vẫn hiện đủ ba bảng như trước */}
      {report && (
        <div className="mt-3 space-y-3 border-t border-brand/20 pt-3">
          <Overview data={report} />
          <CategoryTable data={report} />
          <TopProductTable data={report} />
        </div>
      )}
    </div>
  );
}

/**
 * "Bạn cũng có thể hỏi" — **đứng ngoài khối kết luận**, dạng chip bo tròn như gợi ý tiếp theo,
 * để không bị nhầm là một phần của câu trả lời.
 */
function FollowUps({ items, onAsk, animate }: { items: string[]; onAsk: (q: string) => void; animate?: boolean }) {
  return (
    <div className={`${animate ? "animate-fade" : ""} space-y-1.5`}>
      <p className="text-[13px] text-ink-muted">Bạn cũng có thể hỏi</p>
      <div className="flex flex-col items-start gap-1.5">
        {items.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onAsk(q)}
            className="group flex max-w-full items-center gap-2 rounded-full border border-line bg-white px-3.5 py-1.5 text-left text-[13.5px] text-zinc-700 transition hover:border-brand/50 hover:text-brand-strong"
          >
            <span className="min-w-0">{q}</span>
            <ArrowUpRight size={14} className="shrink-0 text-zinc-300 transition group-hover:text-brand" />
          </button>
        ))}
      </div>
    </div>
  );
}

function Peers({ items }: { items: NonNullable<ChatMessage["peers"]> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((p) => (
        <a
          key={p.creator_id}
          href={`/kocs/${p.creator_id}`}
          title={p.analysed ? "Đã có sẵn phân tích AI — mở là xem ngay" : undefined}
          className="flex items-center gap-2 rounded-full border border-line bg-white px-2 py-1 text-[12px] hover:border-brand/40 hover:text-brand"
        >
          <Avatar id={p.creator_id} name={p.name} size={20} />
          <span className="max-w-[150px] truncate font-medium">{p.name}</span>
          <span className="num text-ink-muted">
            {vnd(p.revenue)} · {compact(p.followers)} fl
          </span>
          {p.analysed && <CircleCheck size={13} className="shrink-0 text-brand" />}
        </a>
      ))}
    </div>
  );
}

function Videos({ items, handle }: { items: NonNullable<ChatMessage["videos"]>; handle: string }) {
  return (
    <div className="space-y-2">
      {items.map((v) => (
        <div key={v.video_id} className="flex items-start gap-2.5">
          <VideoThumb id={v.video_id} title={v.title} tiktokUrl={tiktokVideo(handle, v.video_id)} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium">{v.title || "Video"}</p>
            <p className="text-[12px] text-ink-muted">
              {compact(v.views)} view · demo sản phẩm: {v.demo} · AI xem khung ở giây {v.times.join(", ")}
            </p>
            <p className="mt-0.5 text-[12.5px]">{v.summary}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Products({ items }: { items: NonNullable<ChatMessage["products"]> }) {
  return (
    <div className="flex flex-wrap gap-3">
      {items.map((p) => (
        <div key={p.product_id} className="flex w-[46%] min-w-[220px] items-center gap-2.5">
          <ProductThumb id={p.product_id} name={p.name} />
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium">{p.name}</p>
            <p className="num text-[12px] text-ink-muted">
              {vnd(p.revenue)} · {Math.round(p.share * 100)}% doanh thu
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Màn hình "cuộc trò chuyện mới": lời chào + các câu hỏi gợi ý bấm là hỏi luôn. */
function Welcome({ subjectName, suggestions, onPick }: { subjectName?: string; suggestions: string[]; onPick: (text: string) => void }) {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center py-14 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand to-brand-strong text-white">
        <Sparkles size={22} />
      </span>
      <h3 className="mt-4 text-[22px] font-bold tracking-tight">Hỏi gì về {subjectName ?? "KOC này"}?</h3>
      <p className="mt-1.5 text-[13.5px] text-ink-muted">Mình trả lời từ dữ liệu đã thu thập và phân tích video — mỗi kết luận đều dẫn bằng chứng</p>
      {/* Thẻ có viền + nền: nhìn là biết bấm được, khác hẳn dòng chữ trơn */}
      <div className="mt-6 w-full space-y-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="group flex w-full items-center gap-3 rounded-xl border border-line bg-zinc-50 px-4 py-3 text-left text-[14px] text-zinc-700 shadow-sm transition hover:-translate-y-px hover:border-brand/50 hover:bg-brand-soft/40 hover:text-brand-strong hover:shadow-md"
          >
            <MessageCircle size={15} className="shrink-0 text-ink-muted transition group-hover:text-brand" />
            <span className="min-w-0 flex-1">{s}</span>
            <ArrowUpRight size={15} className="shrink-0 text-zinc-300 transition group-hover:text-brand" />
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({
  placeholder,
  onSend,
  rounded,
  autoFocus,
  onExpand,
  badge,
  busy,
}: {
  placeholder: string;
  onSend: (text: string) => Promise<void>;
  rounded?: boolean;
  autoFocus?: boolean;
  /** Có thì hiện nút phóng to: mở hộp thoại mà không cần gửi câu hỏi nào. */
  onExpand?: () => void;
  /** Số hiện trên chấm đỏ của nút phóng to (số cuộc trò chuyện đã có). */
  badge?: number;
  /** Đang chạy một lượt hỏi → khoá nút gửi và hiện spinner. */
  busy?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      // `onSubmit` thường thay cho `action` của React: state (bong bóng câu hỏi, spinner) phải hiện
      // NGAY, còn `action` chạy trong transition nên giao diện chỉ cập nhật sau khi việc nặng xong.
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem("text") as HTMLInputElement | null;
        const text = input?.value ?? "";
        ref.current?.reset();
        void onSend(text);
      }}
      className={`flex items-center gap-2 border border-line bg-white py-2 pl-2 pr-2.5 ${rounded ? "rounded-full shadow-[var(--shadow-pop)]" : "rounded-2xl"}`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-strong text-white">
        <Sparkles size={16} />
      </span>
      <input
        name="text"
        autoComplete="off"
        maxLength={1000}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-muted"
      />
      <SendButton busy={busy} />
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label="Mở hộp thoại"
          title="Mở hộp thoại"
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition hover:bg-zinc-100 hover:text-ink"
        >
          <Expand size={16} />
          {/* Số cuộc trò chuyện đã có với KOC này */}
          {badge ? (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">{badge}</span>
          ) : null}
        </button>
      )}
    </form>
  );
}

function SendButton({ busy }: { busy?: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-label="Gửi"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-white transition hover:bg-brand-strong disabled:opacity-60"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.6} />}
    </button>
  );
}
