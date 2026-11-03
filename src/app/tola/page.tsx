import { Suspense } from "react";
import { TolaChat } from "@/components/tola-chat";
import { getTolaSubject } from "@/lib/data/queries";
import { AI_NAME } from "@/lib/brand";

export const metadata = { title: `${AI_NAME} · DETOLA AI` };

/**
 * Màn hỏi đáp của trợ lý Tola — lối vào AI dùng chung cho mọi câu hỏi về KOC và chiến dịch.
 * Bắt đầu bằng một luồng trống; lịch sử nằm trong `tola_chats` theo `threadId` do client sinh.
 * `?koc=<creatorId>`: mở từ trang hồ sơ KOC (nút Tola trên mobile) → hỏi về KOC đó.
 */
export default function TolaPage({ searchParams }: PageProps<"/tola">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* searchParams là dữ liệu theo request → đọc trong Suspense; chờ thì hiện màn chat trống */}
      <Suspense fallback={<TolaChat />}>
        <WithSubject searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function WithSubject({ searchParams }: { searchParams: PageProps<"/tola">["searchParams"] }) {
  const { koc, q } = await searchParams;
  const subject = typeof koc === "string" && koc ? await getTolaSubject(koc) : null;
  // `?q=`: câu hỏi gõ từ ô hỏi ở trang danh sách KOC → màn chat tự gửi luôn
  const question = typeof q === "string" ? q.trim().slice(0, 1000) : "";
  // `key`: đổi KOC / câu hỏi thì dựng lại màn chat mới, không giữ hội thoại trước
  return <TolaChat key={`${subject?.id ?? "none"}:${question}`} subject={subject ?? undefined} initialQuestion={question || undefined} />;
}
