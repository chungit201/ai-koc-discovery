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

## Việc tiếp theo

1. **Công cụ ghi cho Tola** (phần còn lại của bước 2, chưa bắt đầu): `update_criteria`,
   `exclude_koc`, `deepen_koc` để câu "bỏ Ánh Ốc, gợi ý người khác" chạy được trong hội thoại.
   Trần số lượng cũ (`limitDeepen`, `limitExclude`, `DEEPEN_MAX_KOCS=1`, `EXCLUDE_MAX_KOCS=3`) lấy
   lại trong git history của `src/lib/chat-rules.ts`.
2. Ẩn sidebar của app ở `/tola` — desktop đang có hai cột trái.
3. Nút `@` nên mở danh sách chọn KOC thay vì chỉ chèn ký tự.
4. Tối ưu chi phí (người dùng chốt: chạy đúng trước, tối ưu sau).

## Lưu ý khi sửa

- `creators.handle` lưu **kèm** dấu `@` — phải chuẩn hoá hai đầu khi so sánh.
- Đừng viết dấu backtick trong template literal của `chat-creator-agent.ts` (đã làm vỡ file 2 lần).
- `scripts/crawl-shops.ts:47` dùng `C.shops` không tồn tại → `npm run build` fail. Lỗi có sẵn,
  không do đợt này.
- Reset dữ liệu test: `npm run reset:test -- --yes`.
