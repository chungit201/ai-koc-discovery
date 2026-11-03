"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CITE } from "@/lib/answer-verify";

/**
 * Câu trả lời của agent: **markdown do chính model viết**, kể cả bảng.
 *
 * Trước đây giao diện vẽ bảng theo `table.tool` bằng 7 nhánh TSX cứng, nên cùng một bảng
 * `campaign_context` hiện ra dù người dùng hỏi gì — model chỉ được chọn *chèn bảng nào*, không được
 * chọn *bảng có gì*. Giờ model tự quyết bố cục và cột; bảo đảm "không con số nào không có nguồn"
 * chuyển sang kiểm ở đầu ra (`lib/answer-verify.ts`).
 *
 * Hai thứ component này làm thêm trên markdown thô:
 *  - `[^ev_s_...]` → chip nguồn bấm được, cuộn tới đúng thẻ công cụ đã sinh ra con số.
 *  - những con số không đối chiếu được → gạch đỏ, để người bán thấy ngay chỗ đáng ngờ.
 */
/** Bản đồ evidence_id → thẻ công cụ đã sinh ra nó (dựng ở `ask-bar.tsx`). */
export type AnswerSources = Record<string, { anchor: string; index: number; title: string }>;

export function AnswerMarkdown({ markdown, unverified = [], sources }: { markdown: string; unverified?: string[]; sources?: AnswerSources }) {
  return (
    <div className="answer-md space-y-3 text-[14.5px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{decorate(children, unverified, sources)}</p>,
          li: ({ children }) => <li className="ml-4 list-disc">{decorate(children, unverified, sources)}</li>,
          td: ({ children }) => <td className="border-t border-line px-3 py-2 align-top">{decorate(children, unverified, sources)}</td>,
          th: ({ children }) => <th className="bg-zinc-50 px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">{children}</th>,
          // Bảng do model tự chọn cột nên có thể rộng hơn màn hình — cuộn ngang thay vì cắt mất cột
          table: ({ children }) => (
            <div className="-mx-1 overflow-x-auto rounded-xl border border-line bg-white px-0 sm:mx-0">
              <table className="w-full min-w-[520px] text-[13px]">{children}</table>
            </div>
          ),
          h1: ({ children }) => <h3 className="pt-1 text-[16px] font-bold tracking-tight">{children}</h3>,
          h2: ({ children }) => <h3 className="pt-1 text-[16px] font-bold tracking-tight">{children}</h3>,
          h3: ({ children }) => <h4 className="pt-1 text-[14.5px] font-semibold">{children}</h4>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
              {children}
            </a>
          ),
          blockquote: ({ children }) => <blockquote className="border-l-2 border-amber-300 bg-amber-50/50 px-3 py-2 text-[13.5px]">{children}</blockquote>,
          ul: ({ children }) => <ul className="space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="space-y-1">{children}</ol>,
          code: ({ children }) => <code className="rounded bg-zinc-100 px-1 py-px text-[12.5px]">{children}</code>,
        }}
      >
        {markdown}
      </ReactMarkdown>
      {unverified.length > 0 && (
        // Giọng điệu cố ý nhẹ: phần lớn trường hợp là con số minh hoạ trong câu giả định
        // ("ví dụ ngân sách 50-100 tr"), không phải số liệu bịa. Doạ người bán ở đây là sai mức độ.
        <p className="text-[11.5px] text-ink-muted">
          {unverified.length} con số được gạch nhạt không lấy từ dữ liệu đã truy xuất — thường là con số minh hoạ trong câu giả định.
        </p>
      )}
    </div>
  );
}

/** Đi qua các chuỗi con của một node markdown, thay dấu trích dẫn và tô số đáng ngờ. */
function decorate(children: React.ReactNode, unverified: string[], sources?: AnswerSources): React.ReactNode {
  return mapStrings(children, (text, key) => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    let i = 0;
    for (const m of text.matchAll(CITE)) {
      const at = m.index ?? 0;
      if (at > last) parts.push(...flagNumbers(text.slice(last, at), unverified, `${key}-t${i}`));
      const src = sources?.[m[1]];
      parts.push(
        !src ? null : (
          <a
            key={`${key}-c${i}`}
            href={`#${src.anchor}`}
            title={`Nguồn: ${src.title}`}
            className="mx-0.5 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded bg-brand-soft px-1 align-middle text-[10px] font-semibold text-brand hover:bg-brand hover:text-white"
          >
            {src.index + 1}
          </a>
        ),
      );
      last = at + m[0].length;
      i++;
    }
    parts.push(...flagNumbers(text.slice(last), unverified, `${key}-t${i}`));
    return parts;
  });
}

/** Gạch đỏ những con số không có nguồn (so khớp nguyên văn chuỗi mà verifier đã bắt được). */
function flagNumbers(text: string, unverified: string[], key: string): React.ReactNode[] {
  if (!unverified.length || !/\d/.test(text)) return [text];
  const escaped = [...new Set(unverified)].map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "g");
  return text.split(re).map((part, i) =>
    unverified.includes(part) ? (
      <span key={`${key}-${i}`} title="Số này không lấy từ dữ liệu đã truy xuất" className="underline decoration-zinc-400 decoration-dotted underline-offset-2">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** Áp `fn` lên mọi chuỗi nằm trong cây node, giữ nguyên phần tử React khác (in đậm, link…). */
function mapStrings(node: React.ReactNode, fn: (text: string, key: string) => React.ReactNode, key = "n"): React.ReactNode {
  if (typeof node === "string") return fn(node, key);
  if (Array.isArray(node)) return node.map((c, i) => <span key={`${key}-${i}`}>{mapStrings(c, fn, `${key}-${i}`)}</span>);
  return node;
}
