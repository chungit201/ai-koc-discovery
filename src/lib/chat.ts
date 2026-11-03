import type { Reason } from "./evidence/validate";
import type { AnswerBlock, ReportData, StepPayload } from "./chat-events";

/**
 * Hình dạng một tin nhắn trong hội thoại — dùng chung cho trợ lý Tola (`tola_chats`) và chat ở
 * trang hồ sơ KOC (`creator_chats`).
 *
 * File này từng chứa cả `handleTurn` — bộ phân loại ý định + bảng `RERUN_FROM` của chat trên trang
 * chiến dịch. Trang đó đã bỏ: tuyển KOC giờ là một câu hỏi gõ vào Tola, và route `/api/tola/ask`
 * tự điều phối S2→S5 rồi để agent báo cáo kết quả. Nên chỉ còn lại phần kiểu dữ liệu.
 *
 * Không `import "server-only"`: giao diện (client component) cũng cần kiểu này.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Lý do dẫn bằng chứng (luồng khối cũ ở chat hồ sơ KOC). */
  reasons?: Reason[];
  /** Dẫn chứng trực quan ở chat hồ sơ KOC: ảnh bìa sản phẩm bán chạy và video AI đã xem. */
  products?: { product_id: string; name: string; revenue: number; share: number }[];
  videos?: { video_id: string; title: string; views: number; times: number[]; summary: string; demo: string }[];
  /** Các bước phân tích đã chạy — mỗi lần gọi công cụ là một thẻ trên giao diện. */
  steps?: { title: string; detail: string; kind?: "data" | "peers" | "videos" | "conclusion"; payload?: StepPayload }[];
  /** Trả lời bằng agent có công cụ (docs/10-koc-agent.md), khác luồng khối định sẵn. */
  agent?: boolean;
  peers?: { creator_id: string; name: string; followers: number; revenue: number; engagement: number; analysed?: boolean }[];
  /** Bảng số liệu của báo cáo (code dựng từ DB). */
  report?: ReportData;
  /** Câu hỏi gợi ý tiếp theo, bấm là hỏi luôn. */
  follow_ups?: string[];
  /** Bố cục khối của luồng cũ ở chat hồ sơ KOC. */
  blocks?: AnswerBlock[];
  /** Chế độ agent hiện tại: cả bài do model viết bằng markdown, số đã được đối chiếu. */
  markdown?: string;
  /** Con số không tìm được nguồn trong evidence của phiên — giao diện gạch nhạt. */
  unverified?: string[];
  created_at: Date;
}
