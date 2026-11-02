# Benchmark — chi phí, thời gian, độ tin cậy

> Đo thực tế ngày **2026-11-02** trên máy local (Windows 11, Claude CLI headless), MongoDB trên
> server `66.42.50.32` qua SSH tunnel. Mọi con số dưới đây lấy từ `campaigns.{scoring,s3,s4,s5}`
> và `api_calls` trong DB, không phải ước lượng — trừ các mục ghi rõ **(ước tính)**.
>
> Chạy lại: `npm run bench -- "<brief>" [--pass2]` (tạo chiến dịch mới, chạy S1→S5, in báo cáo JSON).

## 1. Chiến dịch đo

| | |
|---|---|
| Brief | "Cần 6 KOC trang điểm có tương tác cao, nữ 18-30, tổng ngân sách 60 triệu, mỗi KOC 5-15 triệu" |
| Campaign id | `7ee62bfa-0621-4d9f-950f-15698dd81675` |
| Danh mục AI hiểu được | Trang điểm (`848648`), nữ, 18–24 + 25–34, 60 tr, 5–15 tr/KOC, 6 KOC |
| Pool dữ liệu | 1.027 KOC đã crawl · 3.744 video |
| Chọn danh mục khác hẳn 2 chiến dịch cũ (chăm sóc da / chống nắng) để **không ăn cache** → đo chi phí "lần đầu" thật |

## 2. Lần chạy đầu (chưa có cache video)

| Bước | Model | Đơn vị xử lý | Call | Token in | Token out | Chi phí | Thời gian |
|---|---|---|---|---|---|---|---|
| S1 phân tích brief | Haiku 4.5 | 1 brief | 1 | 6.020 | 845 | $0,01735 | 10,9 s |
| S2 lọc cứng + chấm điểm | — (code) | 1.012 KOC → 93 đạt → 18 shortlist | 0 | 0 | 0 | **$0** | 1,9 s |
| S3 sàng lọc nội dung | Haiku 4.5 | 18 KOC (8 từ cache, 10 mới) | 1 | 13.991 | 6.461 | $0,04301 | 68,0 s |
| S4 phân tích video | Sonnet 5 (vision) | 10 KOC × 2 video = 20 video mới | 20 | 135.936 | 7.330 | $0,35730 | **41,1 s** |
| S5 đề xuất + chia ngân sách | Haiku 4.5 | 6 KOC được chọn | 1 | 10.943 | 8.933 | $0,07294 | 58,8 s |
| **Tổng** | | | **23** | **166.890** | **23.569** | **$0,49** | **≈ 2,9 phút** |

S2 tạo **706 evidence** (mỗi số liệu một bằng chứng) — đây là nguồn duy nhất cho mọi con số
xuất hiện trong lý do đề xuất. S5 **loại 3 lý do** do validator không tìm thấy bằng chứng khớp
(`src/lib/evidence/validate.ts`), đúng như nguyên tắc chống AI bịa.

### Kết quả đề xuất
6/6 KOC yêu cầu, tất cả đều đã qua phân tích video, phân bổ **đúng 60.000.000 ₫**:
5,0 / 11,9 / 13,3 / 11,6 / 13,2 / 5,0 triệu — mọi KOC nằm trong khoảng 5–15 tr của brief.

## 3. Chạy lại cùng chiến dịch (toàn bộ từ cache)

Xoá summary của cả 4 bước, giữ nguyên cache AI, rồi `npm run resume`:

| Bước | Nguồn | Chi phí | Thời gian |
|---|---|---|---|
| S2 | tính lại bằng code | $0 | 1,9 s |
| S3 | 18/18 KOC từ `ai_assessments` | $0 | 0,6 s |
| S4 | 20/20 video từ `ai_assessments` | $0 | 1,7 s |
| S5 | 1/1 call từ `llm_cache` | $0 | 0,4 s |
| **Tổng** | | **$0** | **5,8 s** |

Đây là điều kiện bình thường khi người bán mở lại chiến dịch, đổi brief trên cùng tập KOC, hoặc
server khởi động lại giữa lúc đang xử lý.

## 4. Độ tin cậy (Step 9)

| Tình huống | Kết quả |
|---|---|
| Kill process giữa S4 (test 2026-11-02) | Resume bỏ qua S2/S3, 16/16 video từ cache, **$0**, 6,4 s |
| S3 vượt timeout CLI 90 s làm pipeline chết (gặp thật trong lần bench đầu) | `pipeline_error` được ghi, `npm run resume` chạy tiếp từ S3 và hoàn tất bình thường. Đã nâng timeout lên 240 s + thử lại 1 lần (xem §6) |
| Hai tiến trình cùng chạy một chiến dịch | Lease `pipeline.lease_until` chặn tiến trình thứ hai |

## 5. Quy mô & so sánh baseline

Chi phí đơn vị đo được (lần đầu, chưa cache):

- S3: **$0,0043 / KOC** (10 KOC/call)
- S4: **$0,0179 / video** ⇒ $0,0357 / KOC (2 video)
- S1 + S5: **$0,09 / chiến dịch**, gần như không đổi theo quy mô

Ước tính cho pool lớn hơn, giữ nguyên hình phễu (S3 trên shortlist của S2, S4 trên top 10):

| Pool KOC qua S2 | S3 | S4 | Tổng/chiến dịch **(ước tính)** |
|---|---|---|---|
| 18 (đo thật) | $0,043 | $0,357 | **$0,49** |
| 50 | $0,22 | $0,36 | ≈ $0,67 |
| 500 | $2,15 | $0,36 | ≈ $2,6 |

Chi phí S4 **không tăng theo pool** vì chỉ top 10 KOC sau S3 được phân tích video — đây là lý do
chính khiến phễu rẻ.

### Baseline "đưa mọi thứ cho một LLM lớn" **(ước tính)**
Nếu bỏ phễu và đẩy toàn bộ 1.012 KOC trong pool kèm 2 video/KOC vào model vision:

- text: 1.012 KOC × ~1.400 token = ~1,42 M token in ⇒ ~$4,3 (giá Sonnet $3/M in)
- video: 1.012 × 2 = 2.024 video × $0,0179 = ~$36,2
- **tổng ≈ $40 / chiến dịch**, so với **$0,49** đo thật ⇒ tiết kiệm khoảng **80×**

Chưa kể baseline không có bằng chứng truy vết được, không resume được, và chạy lại vẫn tốn
nguyên tiền (phễu chạy lại = $0).

## 6. Vấn đề phát hiện khi benchmark và đã sửa

1. **Timeout CLI 90 s quá chặt cho S3.** Thống kê `api_calls`: S4 ~7 s/call, S5 ~21 s, nhưng S3
   (10 KOC/call) trung bình 32 s và đã thấy 67 s; khi chạy song song với việc tải khung hình S4
   thì vượt 90 s và làm sập cả pipeline. → nâng lên 240 s và **thử lại 1 lần khi timeout**
   (`src/lib/llm/claude.ts`).
2. **Ghi sai tên model.** `claude -p --model sonnet` trả về `modelUsage` chứa **nhiều** model
   (có một dòng haiku phụ trợ của CLI); code lấy `Object.keys(...)[0]` nên gán nhãn sai →
   `llm_models` và khoá cache `ai_assessments` bị lệch. → chọn khoá khớp alias đã yêu cầu, nếu
   không có thì lấy model tiêu thụ nhiều token nhất (`pickModelId`).
   *Hệ quả còn lại:* 20 bản phân tích video của chiến dịch này đang lưu dưới tên model sai, nên
   lần chạy S4 tiếp theo trên chúng sẽ phân tích lại (~$0,36).
3. **Phân bổ ngân sách thấp hơn sàn của brief.** Brief ghi 5–15 tr/KOC nhưng một KOC được chia
   **3 tr** vì code chỉ lấy sàn là chi phí ước tính của KOC. → thêm sàn `budget_min_per_koc`
   (bỏ sàn nếu tổng ngân sách không đủ cho mọi KOC ở mức đó), ghi vào `s5.floor_per_koc`.
   Đo lại: 5,0 / 11,9 / 13,3 / 11,6 / 13,2 / 5,0 tr — không còn KOC dưới sàn.

## 7. Giới hạn của phép đo

- Pool 1.027 KOC (mục tiêu 500 KOC đầy đủ thông tin đã đạt một phần: ~140 đủ chi tiết).
- Chi phí KOC là **ước tính theo bậc follower**, độ tin cậy thấp — không phải rate card thật.
- Thời gian phụ thuộc mạng (S4 dùng ffmpeg seek thẳng link MP4) và tải của Claude CLI; chi phí
  token thì ổn định giữa các lần chạy.
- Giá quy đổi lấy từ `total_cost_usd` do Claude CLI trả về cho từng call.
