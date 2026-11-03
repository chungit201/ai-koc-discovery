import { TolaChat } from "@/components/tola-chat";
import { AI_NAME } from "@/lib/brand";

export const metadata = { title: `${AI_NAME} · DETOLA AI` };

/**
 * Màn hỏi đáp của trợ lý Tola — lối vào AI dùng chung cho mọi câu hỏi về KOC và chiến dịch.
 * Bắt đầu bằng một luồng trống; lịch sử nằm trong `tola_chats` theo `threadId` do client sinh.
 */
export default function TolaPage() {
  return (
    <main className="flex flex-1 flex-col">
      <TolaChat />
    </main>
  );
}
