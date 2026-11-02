"use client";

import { ArrowUp, ArrowUpRight, CircleCheck, Expand, Loader2, MessageCircle, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { ChatMessage } from "@/lib/chat";
import type { AnswerBlock, AskEvent, ReportData, StepKind, StepPayload } from "@/lib/chat-events";
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
  /** Đã quá ngưỡng chờ → mới được phép bày kế hoạch ra (xem `PLAN_DELAY_MS`). */
  slow?: boolean;
  error?: string;
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
        return { ...prev, steps: e.steps.map((s) => ({ title: s.title, kind: s.kind, started: false, done: false })) };
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

/** Chữ chạy dần như ChatGPT — chỉ dùng cho kết luận đang stream, không dùng cho tin nhắn đã lưu. */
function Typewriter({ text, speed = 14 }: { text: string; speed?: number }) {
  // Component được gắn `key={text}` ở nơi dùng nên mỗi câu mới là một instance mới → không cần reset state
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!text) return;
    const id = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(id), v) : v + 2)), speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-brand align-middle" />}
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
  /** Bản mới nhất của `live` để đọc trong callback bất đồng bộ (state trong closure đã cũ). */
  const liveRef = useRef<Live | null>(null);
  liveRef.current = live;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Luôn cuộn tới phần mới nhất khi có thêm bước
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [live?.steps.length, live?.conclusion, live?.running]);

  const send = async (text: string, threadId: string | null) => {
    const trimmed = text.trim();
    if (!trimmed || live?.running) return;
    const id = threadId ?? crypto.randomUUID();
    setActiveId(id);
    setOpen(true);
    setLive({ question: trimmed, steps: [], running: true });

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
          if (isHeavy(e.steps)) {
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
    // Luồng xong: chờ chữ gõ xong rồi mới thay bằng bản đã lưu, nếu không sẽ bị nhảy giật
    router.refresh();
    const typingMs = Math.min(2600, (liveRef.current?.conclusion?.text.length ?? 0) * 8);
    setTimeout(() => setLive(null), typingMs + 500);
  };

  const shown = (active?.messages ?? []) as Shown[];

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

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  {live ? (
                    <div className="mx-auto max-w-[820px] space-y-3">
                      {/* Các lượt trước trong cùng cuộc trò chuyện */}
                      {shown.map((m) => (
                        <Bubble key={m.id} m={m} handle={subjectHandle} onAsk={(q) => send(q, activeId)} />
                      ))}
                      <div className="flex justify-end">
                        <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-[14.5px] leading-relaxed">{live.question}</div>
                      </div>
                      <LiveAnswer live={live} handle={subjectHandle} onAsk={(q) => send(q, activeId)} />
                      <div ref={endRef} />
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
  if (m.steps?.length && !isHeavy(m.steps as { kind: StepKind }[]))
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
          <PlanList titles={m.steps.map((s) => s.title)} />
          {m.steps.map((s, i) => {
            const items =
              s.kind === "data" && m.products?.length ? (
                <Products items={m.products} />
              ) : s.kind === "peers" && m.peers?.length ? (
                <Peers items={m.peers} />
              ) : s.kind === "videos" && m.videos?.length ? (
                <Videos items={m.videos} handle={handle} />
              ) : null;
            return (
              <div key={i} className="space-y-2">
                <StepCard index={i} title={s.title} detail={s.detail} done>
                  {items ?? undefined}
                </StepCard>
                {s.kind === "conclusion" && (
                  <>
                    {m.blocks?.length ? (
                      <Answer blocks={m.blocks} data={{ report: m.report, peers: m.peers, videos: m.videos }} handle={handle} />
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
 * Khối tuyên bố kế hoạch — hiện NGAY khi AI đọc xong câu hỏi, trước khi chạy bất cứ bước nào, để
 * người dùng biết sắp làm gì. Tách khỏi phần thực thi bên dưới.
 */
function PlanList({ titles }: { titles: string[] }) {
  return (
    <div className="animate-rise space-y-2 text-[14.5px] leading-relaxed">
      <p>Tôi sẽ thực hiện theo kế hoạch sau:</p>
      <ol className="space-y-1.5">
        {titles.map((t, i) => (
          <li key={i} className="animate-rise font-semibold" style={{ animationDelay: `${i * 90}ms` }}>
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
function LiveAnswer({ live, handle, onAsk }: { live: Live; handle: string; onAsk: (q: string) => void }) {
  const heavy = isHeavy(live.steps);
  const current = live.steps.find((s) => s.started && !s.done);

  if (!heavy && live.steps.length > 0)
    return (
      <div className="space-y-3">
        {live.running && (
          <p className="animate-rise flex items-center gap-2 text-[14px] text-ink-muted">
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
              />
            ) : (
              <Conclusion
                text={live.conclusion.text}
                reasons={live.conclusion.reasons}
                report={live.steps.find((s) => s.payload?.report)?.payload?.report}
                typing
              />
            )}
            {live.conclusion.follow_ups && live.conclusion.follow_ups.length > 0 && <FollowUps items={live.conclusion.follow_ups} onAsk={onAsk} />}
          </>
        )}
        {live.error && <p className="animate-rise text-[13.5px] text-rose-600">{live.error}</p>}
      </div>
    );

  return (
    <div className="space-y-3">
      {live.steps.length === 0 ? (
        <p className="flex items-center gap-2 text-[14px] text-ink-muted">
          <Loader2 size={15} className="animate-spin text-brand" /> Đang đọc câu hỏi…
        </p>
      ) : (
        // Chỉ bày kế hoạch khi đã phải chờ đủ lâu — xong nhanh thì không cần khoe quy trình
        live.slow && <PlanList titles={live.steps.map((s) => s.title)} />
      )}
      {live.steps.map((s, i) => {
        // Kết luận đứng thành khối riêng bên dưới card của bước, cho nổi hẳn
        const body = s.done ? (
          <>
            {s.payload?.products?.length ? <Products items={s.payload.products} /> : null}
            {s.payload?.peers?.length ? <Peers items={s.payload.peers} /> : null}
            {s.payload?.videos?.length ? <Videos items={s.payload.videos} handle={handle} /> : null}
          </>
        ) : null;
        const hasBody = Boolean(s.payload?.products?.length || s.payload?.peers?.length || s.payload?.videos?.length);
        return (
          <div key={i} className="space-y-2">
            <StepCard index={i} title={s.title} detail={s.detail} done={s.done} running={s.started && !s.done}>
              {hasBody ? body : undefined}
            </StepCard>
            {/* Luôn gõ chữ ở lượt đang chạy: `done` tới ngay sau `conclusion` nên nếu phụ thuộc
                `live.running` thì typewriter tắt trước khi kịp render */}
            {s.kind === "conclusion" && s.done && live.conclusion && (
              <>
                {live.conclusion.blocks?.length ? (
                  <Answer
                    blocks={live.conclusion.blocks}
                    data={{
                      report: live.steps.find((x) => x.payload?.report)?.payload?.report,
                      peers: live.steps.find((x) => x.payload?.peers)?.payload?.peers,
                      videos: live.steps.find((x) => x.payload?.videos)?.payload?.videos,
                    }}
                    handle={handle}
                    typing
                  />
                ) : (
                  <Conclusion text={live.conclusion.text} reasons={live.conclusion.reasons} report={s.payload?.report} typing />
                )}
                {live.conclusion.follow_ups && live.conclusion.follow_ups.length > 0 && <FollowUps items={live.conclusion.follow_ups} onAsk={onAsk} />}
              </>
            )}
          </div>
        );
      })}
      {live.error && <p className="animate-rise text-[13.5px] text-rose-600">{live.error}</p>}
    </div>
  );
}

/**
 * Mỗi bước là **một card riêng**: tiêu đề + kết quả tóm tắt ở dải trên, dẫn chứng của riêng bước đó
 * ở thân card. Gộp hết vào một khối như trước khiến người dùng không phân biệt được bước nào ra gì.
 */
function StepCard({
  index,
  title,
  detail,
  done,
  running,
  children,
}: {
  index: number;
  title: string;
  detail?: string;
  done?: boolean;
  running?: boolean;
  children?: React.ReactNode;
}) {
  const hasBody = Boolean(children);
  return (
    <div className={`animate-rise overflow-hidden rounded-xl border ${done || running ? "border-line bg-white" : "border-dashed border-zinc-200 bg-white/60"}`}>
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
              <td className="num w-8 px-3 py-1.5 text-ink-muted">{p.rank}</td>
              <td className="px-3 py-1.5">
                <span className="line-clamp-1">{p.name}</span>
              </td>
              <td className="num w-36 px-3 py-1.5 text-right">
                {vnd(p.revenue)} <span className="text-ink-muted">· {Math.round(p.share * 100)}%</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Answer({
  blocks,
  data,
  handle,
  typing,
}: {
  blocks: AnswerBlock[];
  data: { report?: ReportData; peers?: ChatMessage["peers"]; videos?: ChatMessage["videos"]; products?: ChatMessage["products"] };
  handle: string;
  typing?: boolean;
}) {
  return (
    <div className="animate-rise space-y-3 text-[14.5px] leading-relaxed">
      {blocks.map((b, i) => {
        if (b.type === "heading")
          return (
            <h3 key={i} className="animate-rise pt-1 text-[16px] font-bold tracking-tight" style={{ animationDelay: `${i * 60}ms` }}>
              {b.text}
            </h3>
          );
        if (b.type === "para")
          return (
            <p key={i} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
              {typing && i === 0 ? <Typewriter key={b.text} text={b.text} /> : b.text}
            </p>
          );
        if (b.type === "bullets")
          return (
            <ul key={i} className="animate-rise space-y-1.5" style={{ animationDelay: `${i * 60}ms` }}>
              {b.items.map((it, n) => (
                <li key={n} className="flex gap-2 text-[14px]">
                  <CircleCheck size={15} className="mt-1 shrink-0 text-brand" /> {it.text}
                </li>
              ))}
            </ul>
          );
        if (b.type === "closing")
          return (
            <p key={i} className="animate-rise text-ink-muted" style={{ animationDelay: `${i * 60}ms` }}>
              {b.text}
            </p>
          );
        // Khối dữ liệu: số liệu do code dựng, model chỉ chọn chèn và đặt tiêu đề
        return (
          <div key={i} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
            {b.title && <h4 className="mb-1.5 text-[13.5px] font-semibold">{b.title}</h4>}
            {b.data === "overview" && data.report && <Overview data={data.report} />}
            {b.data === "categories" && data.report && <CategoryTable data={data.report} />}
            {b.data === "top_products" && data.report && <TopProductTable data={data.report} />}
            {b.data === "peers" && data.peers?.length ? <Peers items={data.peers} /> : null}
            {b.data === "videos" && data.videos?.length ? <Videos items={data.videos} handle={handle} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function Conclusion({ text, reasons, report, typing }: { text: string; reasons: NonNullable<ChatMessage["reasons"]>; report?: ReportData; typing?: boolean }) {
  return (
    <div className="animate-rise rounded-xl border border-brand/30 bg-brand-soft/40 px-4 py-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-brand">
        <Sparkles size={13} /> Kết luận
      </p>
      <p className="text-[14.5px] font-medium leading-relaxed">{typing ? <Typewriter key={text} text={text} /> : text}</p>
      {reasons.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-t border-brand/20 pt-2 text-[13.5px]">
          {reasons.map((r, i) => (
            <li key={i} className="animate-rise flex gap-2" style={{ animationDelay: `${i * 90}ms` }}>
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
function FollowUps({ items, onAsk }: { items: string[]; onAsk: (q: string) => void }) {
  return (
    <div className="animate-rise space-y-1.5">
      <p className="text-[13px] text-ink-muted">Bạn cũng có thể hỏi</p>
      <div className="flex flex-col items-start gap-1.5">
        {items.map((q, i) => (
          <button
            key={q}
            type="button"
            onClick={() => onAsk(q)}
            style={{ animationDelay: `${i * 80}ms` }}
            className="animate-rise group flex max-w-full items-center gap-2 rounded-full border border-line bg-white px-3.5 py-1.5 text-left text-[13.5px] text-zinc-700 transition hover:border-brand/50 hover:text-brand-strong"
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
