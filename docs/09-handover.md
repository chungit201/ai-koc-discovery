# ⚠ BÀN GIAO — hiện trạng & việc cần làm tiếp (2026-11-02)

> Đọc file này TRƯỚC khi sửa code phần hỏi đáp KOC. Kèm [`07-test-plan.md`](07-test-plan.md)
> (bộ test) và [`01-plan.md`](01-plan.md) (Step 10b/10c).

## 1. Đang làm gì

Tính năng **hỏi đáp AI ở trang hồ sơ KOC** (`/kocs/[id]`) — mục tiêu: chất lượng phân tích ngang
Kalopilot (sản phẩm của Kalodata). Luồng hiện tại:

```
Câu hỏi → planAnalysis() lập kế hoạch (Haiku, danh sách bước đóng)
       → chạy từng bước: profile | read_data | peers | videos   (code, 0 token trừ videos)
       → creatorHighlights() viết câu trả lời (Haiku) dưới dạng BLOCKS do model tự dựng
       → validateReasons() + autoCite() kiểm mọi con số phải có trong evidence
       → stream NDJSON qua POST /api/kocs/[id]/ask → UI hiện dần từng bước
```

File chính:
- `src/lib/chat-creator.ts` — kế hoạch, trả lời, cache, parse JSON, luật khoá cứng
- `src/lib/evidence/creator.ts` — **20 claim** bằng chứng do code dựng từ MongoDB
- `src/lib/evidence/creator-video.ts` — phân tích video (dùng chung cache với S4)
- `src/lib/chat-rules.ts` — luật khoá cứng (không đánh giá giọng nói, không xem video hàng loạt)
- `src/lib/chat-events.ts` — kiểu sự kiện stream + `AnswerBlock`
- `src/app/api/kocs/[id]/ask/route.ts` — route stream NDJSON, lưu `creator_chats`
- `src/components/ask-bar.tsx` — thanh hỏi nổi + overlay + nhịp hiển thị do client điều phối
- `scripts/test-koc-chat.ts` — bộ test 15 ca (`npm run test:koc`)

## 2. ⚠ VẤN ĐỀ ĐANG MỞ — ưu tiên theo thứ tự

### 2.1 Bộ test chưa xanh (lần chạy cuối còn dở)
Lần chạy gần nhất (cache đã tắt, gọi model thật) còn hỏng ở nhóm `metrics-*`:
`metrics-overview` (1 lỗi), `metrics-stability` (1), `metrics-engagement` (2). Triệu chứng lặp lại
là **model viết đoạn có số nhưng không trích được `evidence_id` đúng trọng tâm** → `autoCite()` dò
được nguồn nhưng không phải nhóm bằng chứng mà bộ test kỳ vọng (`consistency`, `engagement`).

Hướng xử lý đề xuất: trong prompt trả lời, **liệt kê sẵn id bằng chứng liên quan nhất tới câu hỏi**
(code chọn theo từ khoá) để model trích đúng chỗ, thay vì để nó tự mò trong 20 claim.

Chạy lại: `npm run dev` rồi `npm run test:koc` → kết quả ghi đè `docs/08-test-koc-chat.md`.

### 2.2 Cache câu trả lời ĐANG TẮT
`ANSWER_CACHE_ENABLED` trong `chat-creator.ts` đọc `KOC_ANSWER_CACHE`, **mặc định tắt**.
Bật lại (`KOC_ANSWER_CACHE=1` trong `.env.local`) **sau khi** bộ test xanh ổn định.
Lý do tắt: cache che mất lỗi khi prompt/bằng chứng vừa đổi — xem `07-test-plan.md` mục 6.

### 2.3 Còn thiếu so với Kalopilot (đã đối chiếu trên @phuongsena — đạt ~70–75%)
- ❌ So **hiệu quả live với nhóm đối chuẩn** (họ nêu "vượt 66% trung bình nhóm"); mình đã có
  `live_gpm` của từng KOC, chỉ cần tính trung vị nhóm rồi so.
- ❌ **Khoảng giá sản phẩm** (họ nêu "combo 1,3–5 triệu"); `creator_products.unit_price` đã có.
- ❌ **Số shop hợp tác** (họ nêu 43) — chưa crawl.
- ❌ **Xuất báo cáo .md** tải về.

## 3. Những gì ĐÃ xong (đừng làm lại)

| Hạng mục | Trạng thái |
|---|---|
| Kế hoạch do AI lập từ prompt, danh sách bước đóng, code ép thứ tự + ràng buộc regex | ✅ |
| Chỉ hiện kế hoạch khi việc đủ nặng (≥3 bước hoặc có video/đối chuẩn) và đã chờ > 700ms | ✅ |
| Nhịp hiển thị **do client điều phối** (spinner tối thiểu 480ms/bước, không phụ thuộc tốc độ server) | ✅ |
| Model **tự dựng bố cục** bài trả lời (`AnswerBlock`: para/heading/bullets/data/closing) | ✅ |
| Bảng số liệu **do code dựng** (overview/categories/top_products/peers/videos) — AI chỉ chọn chèn | ✅ |
| Luôn có câu dẫn mở đầu (không để bài bắt đầu bằng bảng trơ) | ✅ |
| `autoCite()` — code tự dò nguồn cho số model quên gắn id (vẫn đòi số phải có trong evidence) | ✅ |
| Nhóm đối chuẩn siết lại: cùng nhóm sản phẩm + có bán thật + 10 người gần nhất về quy mô | ✅ |
| Hỏi tiếp trong cùng cuộc trò chuyện (`creator_chats`, sidebar lịch sử, nút cuộc mới) | ✅ |
| Gợi ý "Bạn cũng có thể hỏi" (ngoài khối kết luận, chip bo tròn) | ✅ |
| Luật khoá cứng: không đánh giá giọng nói; không xem video hàng loạt (1 KOC/lượt) | ✅ |

## 4. Bẫy đã dính — đừng dính lại

1. **Sửa file src/ trong lúc bộ test đang chạy** → Next biên dịch lại, cắt luồng đang mở, mọi ca
   báo `ngoại lệ: terminated`. Chạy test xong rồi mới sửa.
2. **Cache che lỗi**: ca báo `$0` + "blocks rỗng" thường là **bản cache cũ**, không phải lỗi logic
   hiện tại. Thấy `$0` thì nghi cache trước khi nghi code.
3. **PowerShell nuốt `$`**: `node -e "...{$in:...}"` bị hỏng cú pháp. Dùng file script hoặc bash.
4. **`\b` trong regex không khớp tiếng Việt có dấu** (`\btất cả\b` không bao giờ đúng).
5. **Regex ràng buộc kế hoạch dễ khớp nhầm**: "demo **sản phẩm**" khớp luật bán hàng; "bao nhiêu một
   **video**" khớp luật nội dung. Đã siết nhưng còn mong manh.
6. **Model trả JSON có nháy kép chưa escape** → đã có `repairQuotes()`; đừng bỏ.
7. **Thay cả khối code bằng script** dễ xoá nhầm phần vừa thêm — tôi đã mất 3 claim
   (`sales`/`channel_mix`/`independence`) kiểu này, phải khôi phục.

## 5. Nguyên tắc không được phá

- **Mọi con số trong câu trả lời phải truy được về một `evidence_id` có thật.** Bảng số liệu do code
  dựng; model chỉ chọn chèn và đặt tiêu đề. `autoCite()` chỉ *tìm hộ* nguồn, không nới điều kiện.
- **AI chỉ chọn trong danh sách đóng** (bước phân tích, loại khối, ý định chat); code ép thứ tự,
  ràng buộc và giới hạn.
- **Không hứa điều hệ thống không làm được** — giọng nói/âm thanh là ví dụ đã khoá cứng.
- **Không nói chuyện cache/token với người dùng** trong mô tả từng bước.
