/**
 * Tên trợ lý AI của sản phẩm — hiện trên nút tròn giữa thanh tab dưới (mobile), ở đầu mỗi câu trả
 * lời, và trong lời mời hỏi tiếp. Giống cách Kalodata gọi trợ lý của họ là "Pilot".
 *
 * "Tola" rút từ DE-TOLA: ngắn, đọc được bằng tiếng Việt, vừa đúng một nhãn tab. Đây là chỗ DUY NHẤT
 * định nghĩa tên — đổi ở đây là đổi toàn bộ giao diện.
 *
 * File riêng (không nằm trong `sidebar.tsx`) để tránh vòng import: sidebar dùng `DeepSearchButton`,
 * mà nút đó lại cần tên trợ lý.
 */
export const AI_NAME = "Tola";

/** Tên đầy đủ dùng ở chỗ trang trọng hơn (tiêu đề câu trả lời, thẻ giới thiệu). */
export const AI_FULL_NAME = `${AI_NAME} · DETOLA AI`;
