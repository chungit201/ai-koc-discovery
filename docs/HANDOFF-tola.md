# Bàn giao: trợ lý Tola (nhánh `feat/tola-assistant-ui`)

Cập nhật 2026-11-03. Đọc file này trước khi code tiếp.

## Kiến trúc hiện tại

Đã viết thành tài liệu riêng, có sơ đồ: **[13 — Trợ lý Tola](13-tola.md)** (cách vận hành, bộ công cụ,
chống bịa) và **[12 — Câu hỏi tìm KOC](12-tim-koc.md)** (thang điểm, ngưỡng, chỗ dễ vỡ khi kiểm thử).

## Đã xong

- Tola trả lời được cả brief tuyển KOC (chất lượng bằng luồng campaign cũ: S2 chấm điểm → S3 đọc
  bio/sản phẩm/tiêu đề → S4 xem khung hình → S5 chọn + chia ngân sách) và câu hỏi về một KOC.
- Tag `@handle` để hỏi riêng một KOC; câu ngoài DB thì agent đi WebSearch/WebFetch.
- Lịch sử chat kiểu Kalopilot (cột trái desktop + drawer mobile).
- Bảng màu periwinkle→hồng, responsive mobile (drawer lọc, tab bar, danh sách KOC dạng row ở
  mobile / bảng đủ cột ở desktop), logomark + tên Tola trong pill, animation ánh sáng lướt.
- Dọn code chết của trang chiến dịch (commit cuối).

- **Sửa danh sách ngay trong hội thoại** bằng 3 công cụ GHI (những công cụ duy nhất được ghi DB),
  chỉ hiện khi hội thoại đang có chiến dịch (`CAMPAIGN_TOOLS` trong `scripts/koc-mcp.ts`):
  | công cụ | người bán nói | chạy lại |
  |---|---|---|
  | `exclude_koc` (`undo` để đưa về) | "bỏ Ánh Ốc, tìm người khác" | S5 |
  | `update_criteria` (số KOC, 3 mức ngân sách) | "tôi chỉ có 60 triệu" | S5 |
  | `deepen_koc` (1 người/lần) | "xem kỹ video của Phương Sena" | S4 → S5 |

  Không công cụ nào chạy lại S2 — chấm điểm lại sẽ xoá kết quả S3/S4. Đổi sản phẩm/ngành thì hỏi
  một câu mới, route sẽ nhận ra là brief và chạy phân tích sâu từ đầu. `tola_chats.campaign_id` giờ
  được lưu cả khi chiến dịch sinh ra từ phân tích sâu, nên các lượt sau vẫn sửa được.

- **Dẫn chứng video hiện ra chỗ người bán thấy**: bước "Xem khung hình video" mang theo
  `payload.table` = `campaign_videos` (mọi video AI đã xem trong chiến dịch, kèm tên + handle KOC),
  giao diện vẽ chính tấm 4 khung hình `/api/frames/<video_id>` + ghi chú từng khung. `campaign_context`
  cũng kể phần "AI ĐÃ XEM" của từng người và prompt BẮT BUỘC có một mục về chất lượng review.
  Tóm tắt công cụ phải gọn: dài quá thì Claude CLI không đưa vào ngữ cảnh mà đổ ra file (dấu hiệu:
  thẻ bước ghi "Format: Plain text") — `toText` trong `scripts/koc-mcp.ts` có trần 24k ký tự, cắt
  hàng chi tiết trước, giữ tóm tắt và `numbers`.

## Việc tiếp theo

1. Ẩn sidebar của app ở `/tola` — desktop đang có hai cột trái.
2. Nút `@` nên mở danh sách chọn KOC thay vì chỉ chèn ký tự.
3. Tối ưu chi phí (người dùng chốt: chạy đúng trước, tối ưu sau).

## Lưu ý khi sửa

- `creators.handle` lưu **kèm** dấu `@` — phải chuẩn hoá hai đầu khi so sánh.
- Đừng viết dấu backtick trong template literal của `chat-creator-agent.ts` (đã làm vỡ file 2 lần).
- `scripts/crawl-shops.ts:47` dùng `C.shops` không tồn tại → `npm run build` fail. Lỗi có sẵn,
  không do đợt này.
- Reset dữ liệu test: `npm run reset:test -- --yes`.
