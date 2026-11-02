/**
 * Giới hạn **khoá cứng** cho hội thoại nhiều lượt. Đây là luật của hệ thống, không phải lời dặn
 * trong prompt: model có thể bị thuyết phục, các hằng số dưới đây thì không. Mọi nhánh xử lý lượt
 * chat phải đi qua các hàm ở đây trước khi chạm vào pipeline.
 */

/**
 * Số KOC được phân tích video thêm trong MỘT lượt chat. Phân tích video là bước đắt nhất
 * (đo thực tế ~$0,018/video, 2 video/KOC) và chậm nhất, nên yêu cầu kiểu "xem video của tất cả
 * KOC" bị từ chối; người dùng phải chỉ ra KOC cụ thể họ thấy ưng.
 */
export const DEEPEN_MAX_KOCS = 1;

/** Số KOC tối đa bị loại trong một lượt — tránh một câu chat xoá sạch đề xuất. */
export const EXCLUDE_MAX_KOCS = 3;

/** Câu trả lời khi người dùng muốn xem video hàng loạt. Nói rõ lý do và mời chọn 1 KOC. */
export const DEEPEN_TOO_MANY =
  "Xem video là bước tốn thời gian và chi phí nhất nên mình không chạy cho cả danh sách. Bạn gửi mình 1 KOC bạn thấy ưng (tên hoặc số thứ tự trong danh sách) để mình phân tích video của riêng người đó nhé.";

/** Câu trả lời khi người dùng muốn xem kỹ hơn nhưng chưa nói rõ ai. */
export const DEEPEN_NEED_NAME =
  "Bạn muốn mình xem kỹ video của KOC nào? Gửi mình tên hoặc số thứ tự một người trong danh sách, mình sẽ phân tích video của họ ngay.";

/**
 * Người dùng xin xem video hàng loạt. Nhận diện bằng code chứ không dựa vào model: model được dặn
 * trả mảng rỗng cho "tất cả", nhưng mảng rỗng cũng là trường hợp "chưa nói rõ ai" — hai tình huống
 * này cần hai câu trả lời khác nhau.
 */
// Không dùng `\b`: ranh giới từ của JS chỉ tính ký tự ASCII nên `\btất cả\b` không bao giờ khớp
// tiếng Việt có dấu. Khớp chuỗi con là đủ cho mục đích chặn yêu cầu hàng loạt.
const BULK = /tất cả|toàn bộ|mọi koc|mọi người|cả danh sách|cả list|ai cũng|từng người|hết danh sách/i;
export const wantsBulk = (text: string) => BULK.test(text);

/**
 * Câu hỏi về giọng nói / âm thanh. S4 gửi cho model **4 khung hình tĩnh**, không có audio và
 * không có transcript, nên đây là thứ hệ thống thật sự không biết. Trả lời thẳng còn hơn hứa
 * "để mình xem video" rồi vẫn không có câu trả lời.
 */
const VOICE = /giọng nói|chất giọng|giọng có hay|nói có hay|phát âm|voice|âm thanh|nhạc nền|nói chuyện có/i;
export const asksAboutVoice = (text: string) => VOICE.test(text);

export const NO_AUDIO =
  "Phần xem video của mình chỉ đọc được hình ảnh (4 khung hình: cách demo sản phẩm, bối cảnh, độ tự nhiên) — chưa nghe được âm thanh nên mình không đánh giá giọng nói được, và mình không muốn đoán bừa. Bạn có thể xem trực tiếp video trong thẻ KOC; còn về hình ảnh và cách review thì mình phân tích được.";

export interface LimitCheck {
  ok: boolean;
  ids: string[];
  reply?: string;
}

/**
 * Lọc danh sách id do model đưa ra: chỉ giữ id có thật trong chiến dịch, rồi áp trần số lượng.
 * Vượt trần là từ chối hẳn (không âm thầm cắt bớt) để người dùng biết chính xác điều gì sẽ chạy.
 */
export function limitDeepen(ids: string[], known: Set<string>): LimitCheck {
  const valid = [...new Set(ids.filter((id) => known.has(id)))];
  if (!valid.length) return { ok: false, ids: [], reply: DEEPEN_NEED_NAME };
  if (valid.length > DEEPEN_MAX_KOCS) return { ok: false, ids: [], reply: DEEPEN_TOO_MANY };
  return { ok: true, ids: valid };
}

export function limitExclude(ids: string[], known: Set<string>): LimitCheck {
  const valid = [...new Set(ids.filter((id) => known.has(id)))];
  if (!valid.length) return { ok: false, ids: [], reply: "Bạn muốn bỏ KOC nào? Cho mình tên hoặc số thứ tự trong danh sách nhé." };
  if (valid.length > EXCLUDE_MAX_KOCS)
    return { ok: false, ids: [], reply: `Mỗi lần mình chỉ bỏ tối đa ${EXCLUDE_MAX_KOCS} KOC để đề xuất không bị xáo trộn quá nhiều. Bạn chọn giúp mình vài người cụ thể nhé.` };
  return { ok: true, ids: valid };
}
