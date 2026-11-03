/**
 * Giới hạn **khoá cứng** cho hội thoại. Đây là luật của hệ thống, không phải lời dặn trong prompt:
 * model có thể bị thuyết phục, hằng số thì không.
 *
 * Trước đây file còn `limitDeepen` / `limitExclude` kiểm tra danh sách id do model đưa ra. Việc đó
 * giờ nằm trong chính công cụ (`exclude_koc`, `deepen_koc` ở `koc-data/tools.ts`): công cụ tự đối
 * chiếu id với shortlist nên không cần một tầng lọc riêng, chỉ còn hai cái trần ở đây.
 */

/**
 * Số KOC được phân tích video thêm trong MỘT lần gọi. Xem video là bước đắt nhất
 * (~$0,018/video, 2 video/KOC) và chậm nhất, nên yêu cầu kiểu "xem video của tất cả KOC" bị từ
 * chối; người bán phải chỉ ra người họ thấy ưng.
 */
export const DEEPEN_MAX_KOCS = 1;

/** Số KOC tối đa bị loại trong một lần gọi — tránh một câu chat xoá sạch đề xuất. */
export const EXCLUDE_MAX_KOCS = 3;

/**
 * Câu hỏi về giọng nói / âm thanh. S4 gửi cho model **4 khung hình tĩnh**, không có audio và
 * không có transcript, nên đây là thứ hệ thống thật sự không biết. Trả lời thẳng còn hơn hứa
 * "để mình xem video" rồi vẫn không có câu trả lời.
 */
const VOICE = /giọng nói|chất giọng|giọng có hay|nói có hay|phát âm|voice|âm thanh|nhạc nền|nói chuyện có/i;
export const asksAboutVoice = (text: string) => VOICE.test(text);

export const NO_AUDIO =
  "Phần xem video của mình chỉ đọc được hình ảnh (4 khung hình: cách demo sản phẩm, bối cảnh, độ tự nhiên) — chưa nghe được âm thanh nên mình không đánh giá giọng nói được, và mình không muốn đoán bừa. Bạn có thể xem trực tiếp video trong thẻ KOC; còn về hình ảnh và cách review thì mình phân tích được.";
