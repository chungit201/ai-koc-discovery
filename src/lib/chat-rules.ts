/**
 * Giới hạn **khoá cứng** cho hội thoại. Đây là luật của hệ thống, không phải lời dặn trong prompt:
 * model có thể bị thuyết phục, hằng số thì không.
 *
 * Trước đây file còn `limitDeepen` / `limitExclude` (trần số KOC được xem video thêm hoặc bị loại
 * trong một lượt) dùng cho chat trên trang chiến dịch. Trang đó đã bỏ; khi làm các công cụ ghi
 * `deepen_koc` / `exclude_koc` cho Tola thì lấy lại từ git history của file này.
 */

/**
 * Câu hỏi về giọng nói / âm thanh. S4 gửi cho model **4 khung hình tĩnh**, không có audio và
 * không có transcript, nên đây là thứ hệ thống thật sự không biết. Trả lời thẳng còn hơn hứa
 * "để mình xem video" rồi vẫn không có câu trả lời.
 */
const VOICE = /giọng nói|chất giọng|giọng có hay|nói có hay|phát âm|voice|âm thanh|nhạc nền|nói chuyện có/i;
export const asksAboutVoice = (text: string) => VOICE.test(text);

export const NO_AUDIO =
  "Phần xem video của mình chỉ đọc được hình ảnh (4 khung hình: cách demo sản phẩm, bối cảnh, độ tự nhiên) — chưa nghe được âm thanh nên mình không đánh giá giọng nói được, và mình không muốn đoán bừa. Bạn có thể xem trực tiếp video trong thẻ KOC; còn về hình ảnh và cách review thì mình phân tích được.";
