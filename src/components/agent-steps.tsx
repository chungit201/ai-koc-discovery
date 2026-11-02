"use client";

import { AlertCircle, Check, ChevronDown, Loader2, Play, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

export interface AgentStep {
  /** Khoá ổn định: nhãn đổi theo trạng thái ("Đang…" → "Đã…") nên không dùng nhãn làm key. */
  id: string;
  label: string;
  status: "done" | "running" | "pending" | "error";
  detail?: string;
}

/**
 * Agent-style run, like a chat assistant's tool use: one collapsible "process" line with the AI's
 * understanding, then one card per step that has started (result inside, spinner while running).
 */
export function AgentSteps({ steps, done, thought }: { steps: AgentStep[]; done: boolean; thought: string }) {
  const failed = steps.some((s) => s.status === "error");
  const started = steps.filter((s) => s.status !== "pending");

  return (
    <div className="space-y-3">
      <Collapsible
        defaultOpen={false}
        head={
          <>
            {failed ? (
              <AlertCircle size={16} className="shrink-0 text-red-600" />
            ) : done ? (
              <Sparkles size={16} className="shrink-0 text-brand" />
            ) : (
              <Loader2 size={16} className="shrink-0 animate-spin text-brand" />
            )}
            <span className="min-w-0 flex-1 truncate text-[13px]">
              <b className="font-semibold">{failed ? "Quá trình xử lý tạm dừng." : done ? "Quá trình xử lý đã hoàn tất." : "Đang xử lý…"}</b>{" "}
              <span className="text-ink-muted">{thought}</span>
            </span>
          </>
        }
      >
        <ol className="space-y-1.5 text-[12.5px]">
          {steps.map((s) => (
            <li key={s.id} className={`flex items-center gap-2 ${s.status === "pending" ? "text-ink-muted" : ""}`}>
              <StepIcon status={s.status} /> {s.label}
            </li>
          ))}
        </ol>
      </Collapsible>

      {started.map((s) => (
        <Collapsible
          key={s.id}
          defaultOpen
          tinted
          head={
            <span className="flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-[13px] shadow-[0_0_0_1px_var(--color-line)]">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-white">
                {s.status === "running" ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} strokeWidth={2.5} />}
              </span>
              {s.label}
            </span>
          }
        >
          <div className="flex items-start gap-2.5 rounded-xl bg-white px-4 py-3 text-[13.5px]">
            <StepIcon status={s.status} />
            <span className={s.status === "error" ? "text-red-600" : s.status === "running" ? "text-ink-muted" : ""}>{s.detail}</span>
          </div>
        </Collapsible>
      ))}
    </div>
  );
}

function Collapsible({ head, children, defaultOpen, tinted }: { head: React.ReactNode; children: React.ReactNode; defaultOpen: boolean; tinted?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-2xl border border-line ${tinted ? "bg-zinc-50/80" : "bg-white"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
        <span className="flex min-w-0 flex-1 items-center gap-2.5">{head}</span>
        <ChevronDown size={16} className={`shrink-0 text-ink-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function StepIcon({ status }: { status: AgentStep["status"] }) {
  const base = "mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full";
  if (status === "done")
    return (
      <span className={`${base} bg-brand text-white`}>
        <Check size={11} strokeWidth={3} />
      </span>
    );
  if (status === "running")
    return (
      <span className={`${base} text-brand`}>
        <Loader2 size={14} className="animate-spin" />
      </span>
    );
  if (status === "error")
    return (
      <span className={`${base} text-red-600`}>
        <AlertCircle size={15} />
      </span>
    );
  return <span className={`${base} border border-zinc-300`} />;
}

/** Submit button for the resume form: continues from the first unfinished step. */
export function ResumeButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
    >
      {pending ? <Loader2 size={15} className="animate-spin" /> : <Play size={14} fill="currentColor" />} Tiếp tục xử lý
    </button>
  );
}
