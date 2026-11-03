// Sự kiện của luồng phân tích KOC — dùng chung giữa route handler (server) và giao diện (client).
// File này KHÔNG import "server-only" để client import được kiểu dữ liệu.
import type { Reason } from "./evidence/validate";

/**
 * Khối nội dung của câu trả lời. **Model tự chọn bố cục** (đoạn văn, tiêu đề, gạch đầu dòng, chèn
 * bảng nào) thay vì giao diện đóng khung cứng — nhưng chỉ được chọn trong các loại khối có thật:
 *  - `para` / `bullets`: chữ do model viết, mọi con số phải trích `evidence_id` (validator kiểm).
 *  - `data`: **code điền số liệu**, model chỉ quyết có chèn hay không và đặt tiêu đề.
 *  - `advice`: **nhận định/kinh nghiệm triển khai**, không cần bằng chứng — xem ghi chú bên dưới.
 *  - `closing`: câu mời hỏi tiếp, không được chứa con số.
 *
 * `advice` tồn tại vì hàng rào "mọi ý phải trích được bằng chứng" vốn chỉ hợp với phần BÁO CÁO số
 * liệu; nó vô tình cấm luôn phần TƯ VẤN (cách cấu trúc thanh toán, nên chia mấy đợt…) — thứ người
 * bán cần nhất mà dữ liệu Kalodata không bao giờ chứng minh được. Khối này được miễn trích dẫn
 * nhưng đổi lại **không được nêu số tiền/tỉ lệ tự nghĩ**: câu có đơn vị tiền hay % vẫn phải đi qua
 * đúng bộ kiểm chứng như `para`/`bullets`. Giao diện dán nhãn rõ đây là nhận định, không phải số liệu.
 */
export type AnswerBlock =
  | { type: "para"; text: string; evidence_ids?: string[]; web_urls?: string[] }
  | { type: "heading"; text: string }
  | { type: "bullets"; items: { text: string; evidence_ids: string[]; web_urls?: string[] }[] }
  | { type: "advice"; title?: string; items: { text: string; evidence_ids?: string[] }[] }
  | { type: "data"; data: DataBlockId; title?: string }
  /**
   * Bảng dựng từ **hàng của một bằng chứng trong phiên agent** (docs/02-tola-ai.md): model chỉ trỏ
   * `source` = evidence_id, code chép `rows` từ DB vào — model không viết được số nào ở đây.
   */
  | { type: "table"; title?: string; source: string; table: ToolTable }
  | { type: "closing"; text: string };

/** Hàng kết quả của một công cụ agent (`koc-data/tools.ts`) — giao diện vẽ theo `tool`. */
export interface ToolTable {
  tool: string;
  rows: Record<string, unknown>[];
}

/** Các bảng/dữ liệu code có thể dựng. Model chỉ được chèn khi bước tương ứng đã chạy. */
export type DataBlockId = "overview" | "categories" | "top_products" | "peers" | "videos" | "top_videos";

/** Bảng số liệu của báo cáo — do code dựng từ DB, AI không sinh ra con số nào ở đây. */
export interface ReportData {
  period_days: number;
  revenue: number;
  products_count: number;
  videos_count: number;
  followers: number;
  categories: { name: string; revenue: number; share: number; sub: string[] }[];
  top_products: { rank: number; product_id: string; name: string; revenue: number; share: number; sales_volume: number }[];
  /**
   * Video nổi bật lấy thẳng từ DB — **khác hẳn** `videos` trong `StepPayload`: chỗ kia là vài video
   * AI đã xem khung hình (đắt), chỗ này là bảng xếp hạng toàn bộ video theo số đo, 0 token.
   */
  top_videos: { rank: number; video_id: string; title: string; views: number; likes: number; revenue: number; is_ad: boolean }[];
}

export interface StepPayload {
  report?: ReportData;
  products?: { product_id: string; name: string; revenue: number; share: number }[];
  peers?: { creator_id: string; name: string; followers: number; revenue: number; engagement: number; analysed?: boolean }[];
  videos?: { video_id: string; title: string; views: number; times: number[]; summary: string; demo: string }[];
  /** Chế độ agent: hàng kết quả của lần gọi công cụ ứng với bước này (thẻ như Kalopilot). */
  table?: ToolTable;
  /** Chế độ agent: bằng chứng của phiên do bước này sinh ra — chip nguồn trong câu trả lời trỏ về đây. */
  evidence_id?: string;
  /** Chế độ agent: kết quả tìm kiếm web (thông tin NGOÀI dữ liệu Kalodata) của bước này. */
  web?: { title: string; url: string }[];
}

/** Loại của một bước — quyết định dẫn chứng nào hiển thị dưới bước đó. */
export type StepKind = "data" | "peers" | "videos" | "conclusion";

export type AskEvent =
  /**
   * Kế hoạch AI sẽ chạy — gửi ngay đầu luồng để người dùng thấy việc sắp làm.
   * `kind` phải đi kèm từng bước: kế hoạch là động nên **không được suy ra kind theo chỉ số**
   * (kế hoạch 3 bước `read_data → peers → answer` từng bị gán nhầm bước cuối thành "videos",
   * làm mất hẳn khối Kết luận).
   */
  | { type: "plan"; steps: { title: string; kind: StepKind }[]; /** Chế độ agent: kế hoạch không biết trước, bước thêm dần qua `step_add`. */ agent?: boolean }
  /** Chế độ agent: thêm một bước (mỗi lần gọi công cụ) — chỉ số = số bước hiện có. */
  | { type: "step_add"; title: string; kind: StepKind }
  /** Một bước bắt đầu chạy (hiện spinner). */
  | { type: "step_start"; index: number }
  /** Một bước xong: kết quả của riêng bước đó. */
  | { type: "step_done"; index: number; detail: string; payload?: StepPayload }
  /** Câu trả lời cuối: các khối do model dựng + gợi ý hỏi tiếp. `text`/`reasons` giữ lại cho
   * tương thích (tiêu đề cuộc trò chuyện, tin nhắn cũ, bộ test). */
  /**
   * `markdown` là đường đi hiện tại của chế độ agent: model tự viết cả bài, kể cả bảng, rồi code
   * đối chiếu từng con số (`lib/answer-verify.ts`). `blocks` giữ lại cho luồng cũ của chat hồ sơ
   * KOC và cho tin nhắn đã lưu trước đây.
   */
  | { type: "conclusion"; text: string; reasons: Reason[]; blocks?: AnswerBlock[]; markdown?: string; unverified?: string[]; follow_ups?: string[] }
  /** Kết thúc luồng; `cost_usd` để đối chiếu chi phí thật. */
  | { type: "done"; cost_usd: number }
  | { type: "error"; message: string }
  /**
   * Nội bộ server, không gửi xuống trình duyệt: agent quyết định câu hỏi là brief tuyển KOC và gọi
   * `start_campaign_analysis` → route chạy phân tích sâu S2→S5 rồi gọi agent lần hai để báo kết quả.
   */
  | { type: "deep_request"; brief: string };
