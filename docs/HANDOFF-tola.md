# Bàn giao: trợ lý Tola (nhánh `feat/tola-assistant-ui`)

Cập nhật 2026-11-03. Đọc file này trước khi code tiếp.

## Kiến trúc hiện tại

Tola là **lối vào duy nhất**. Trang `/campaigns` đã xoá hẳn.

```
/tola  ──POST──▶  src/app/api/tola/ask/route.ts  (NDJSON stream)
                   ├─ resolveMentions()        @handle → creator_id  (lib/mentions.ts, code làm, không để agent đoán)
                   ├─ classifyAsk()            "deep" (brief tuyển KOC) | "quick"
                   ├─ deep → runDeepSearch()    lib/tola-deep.ts: chạy S2→S5 NGAY trong tiến trình Next,
                   │                            phát từng thẻ bước ra chat (MCP child process chết sau mỗi lượt
                   │                            nên không chạy pipeline trong agent được)
                   ├─ askTola()                lib/chat-creator-agent.ts → Claude CLI + MCP koc (scripts/koc-mcp.ts)
                   │                            chỉ số bước của agent được +offset cho khỏi đè thẻ pipeline
                   └─ lưu `tola_chats`         lịch sử hội thoại, cột trái /tola
```

Chống bịa = **kiểm tra đầu ra**, không khoá đầu vào: model viết markdown tự do (bảng, bố cục của
nó), rồi `lib/answer-verify.ts` đối chiếu mọi con số với evidence của phiên; số không tra được bị
gạch chân nhạt ở giao diện (`components/answer-markdown.tsx`). Thiết kế cũ (model chỉ được phát
khối định sẵn) làm mọi câu trả lời giống hệt nhau nên đã bỏ.

File chính: `lib/tola-deep.ts`, `app/api/tola/ask/route.ts`, `lib/chat-creator-agent.ts`,
`lib/answer-verify.ts`, `lib/mentions.ts`, `lib/koc-data/tools.ts`, `components/tola-chat.tsx`,
`components/tola-history.tsx`, `lib/brand.ts` (`AI_NAME`).

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
