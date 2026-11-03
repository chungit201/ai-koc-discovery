# 12 — AI trả lời câu hỏi "tìm KOC" như thế nào

Viết cho người kiểm thử: mỗi bước làm gì, con số nào do code quyết, chỗ nào AI được nói, và lật đúng
file nào khi kết quả trông sai. Ví dụ xuyên suốt là câu thật của người dùng:

> tìm 5 KOC TikTok phù hợp để quảng bá sản phẩm kem chống nắng.
> Khách hàng mục tiêu: Nữ, 18–30 tuổi. Ngân sách chiến dịch: 30 triệu VNĐ.

Nguyên tắc chung: **con số thuộc về code, câu chữ thuộc về AI.** AI bóc yêu cầu, đọc nội dung, xem
khung hình và viết nhận định; còn lọc, chấm điểm, chọn người, chia tiền đều là hàm thuần trong
`src/lib/scoring` + `src/lib/pipeline`. Cuối cùng `lib/answer-verify.ts` soi lại từng con số trong
bài viết; số nào không tra được trong bằng chứng của phiên thì bị gạch chân trên giao diện.

## Toàn cảnh

```
/api/tola/ask
 ├─ classifyAsk()            deep | quick                      lib/tola-deep.ts
 └─ runDeepSearch()          phát step_add / step_done ra chat
     ├─ 1. Hiểu yêu cầu      createCampaignFromBrief()         AI bóc → code cắt gọt
     ├─ 2. S2 chấm điểm      scoreCampaign()                   0 token
     ├─ 3. S3 đọc nội dung   runS3()                           Haiku, lô 10
     ├─ 4. S4 xem video      runS4()                           Sonnet, 4 khung hình/video
     └─ 5. S5 chọn & chia    runS5()                           code chọn, Haiku viết lý do
 └─ askTola()                agent đọc campaign_context rồi viết báo cáo
     └─ verifyAnswer()       đối chiếu mọi con số với evidence của phiên
```

## 1. Phân loại — `classifyAsk()`

`deep` = sắp chi tiền, cần danh sách có bằng chứng; `quick` = tra cứu, hỏi về một KOC.

**Code bắt trước, model bắt sau.** `looksLikeBrief()` nhận ra brief bằng regex (động từ đi tìm + số
lượng KOC, hoặc ngân sách + từ "KOC") và trả `deep` luôn, không gọi model: nhanh hơn, 0 token, và
tất định. Hàng rào này có vì model bấp bênh thật — cùng câu ví dụ dưới đây, một lần Haiku trả `deep`,
lần sau trả `quick`, mà `quick` thì cả S2→S5 không chạy và người bán nhận một câu tra cứu hời hợt.
Câu không khớp regex mới hỏi Haiku; Haiku lỗi thì mặc định `quick` (thà nông còn hơn âm thầm tiêu
vài chục cent).

## 2. Hiểu yêu cầu — `createCampaignFromBrief()`

AI bóc tiêu chí, rồi `sanitizeExtracted()` (`lib/brief.ts`) **cắt gọt lại**: giá trị nào không hợp lệ
bị bỏ về mặc định. Câu ví dụ ra:

| trường | giá trị | ghi chú |
|---|---|---|
| `product_focus` | `kem chống nắng` | đổi cả bộ trọng số ở bước 3 |
| `koc_count` | 5 | |
| `budget_total` | 30.000.000 | |
| `audience_gender` | `female` | thành bộ lọc cứng |
| `audience_ages` | `["18-24","25-34"]` | "18–30" map sang 2 rổ tuổi của Kalodata |

AI cũng **lập kế hoạch** (`sanitizePlan`, `lib/plan.ts`): câu này chạy đủ 4 bước; brief kiểu "ai
doanh thu cao nhất" thì bước xem video bị cắt khỏi kế hoạch và không tốn tiền.

## 3. S2 — lọc & chấm điểm, 0 token (`scoring/run.ts`)

Lọc cứng trước, mỗi lý do loại được **đếm và nói ra** trong câu trả lời (`EXCLUDE_LABELS`): chưa có
dữ liệu chi tiết, tài khoản nhà bán tự vận hành, khán giả sai giới tính, dưới 3 video trong kỳ, chi
phí ước tính vượt trần mỗi KOC.

Rồi chấm 7 thành phần, phần trăm tính **trong nội bộ nhóm đạt tiêu chí**. Có `product_focus` thì
trọng số đổi sang `WEIGHTS_PRODUCT_FOCUS`: **hợp sản phẩm 0.35** (thay vì 0.25), hiệu suất 0.20 → 0.15.
Rút gọn còn `max(15, 5×3)` = 15 người.

## 4. S3 — đọc nội dung (`pipeline/s3-content.ts`)

Haiku đọc bio + sản phẩm đã bán + tiêu đề video của 15 người theo lô 10, trả về phong cách, ngách, độ
kỹ của review, rủi ro. Cache theo nội dung (`ai_assessments`) nên chạy lại là 0 đồng.

## 5. S4 — xem video, bước đắt nhất (`pipeline/s4-video.ts`)

Phạm vi: `S4_KOCS = min(10, max(6, 5×2))` = **10 KOC × 2 video**, chỉ những người S5 còn có thể chọn
(chi phí ước tính nằm trong trần ngân sách). Mỗi video gửi **một tấm 4 khung hình, không có âm thanh**.

### Chọn video nào — thứ tự ưu tiên

1. Video **gắn đúng sản phẩm** chiến dịch (`videos.product_ids` → `products.name` khớp regex), doanh
   thu cao nhất
2. Cũng gắn đúng sản phẩm, view cao nhất
3. **Tiêu đề** khớp regex
4. Doanh thu cao nhất
5. View cao nhất

Cả hai video chọn được đều lạc đề nhưng KOC vẫn còn video gắn đúng sản phẩm → **bù thêm đúng 1 video
đó**. Thà trả thêm ~$0,018 còn hơn kết luận sai rằng người này chưa từng demo sản phẩm.

> Trước đây bước này chỉ khớp theo **tiêu đề** và bỏ không dùng `product_ids` (86% video có trường
> này) — tiêu đề TikTok rất hay rỗng hoặc vu vơ ("Ai thấy góc nghiêng nó giống tôi ko?"). Đo trên
> cùng một brief, cùng pool 1.012 KOC:
>
> | | khớp sản phẩm | KOC không có video nào khớp |
> |---|---|---|
> | khớp theo tiêu đề (cũ) | 8/20 video | 5/10 |
> | ưu tiên sản phẩm gắn kèm (nay) | **13/20 video** | **1/10** |

### Khớp sản phẩm — ba căn cứ, ghi rõ căn cứ nào

`match_by` = `"sản phẩm gắn trong video"` (dữ liệu bán hàng, chắc nhất) → `"khung hình AI nhìn thấy"`
(`products_seen`) → `"tiêu đề video"` (yếu nhất). Phải ghi lại thay vì gộp thành `true/false`: một
video tiêu đề có `#kcn` nhưng trong khung hình toàn son vẫn tính là khớp, và người bán xứng đáng biết
nó khớp theo kiểu nào.

### Điểm

```
điểm video     = 0.4×demo + 0.3×chất lượng hình + 0.3×độ tự nhiên
điểm video/KOC = cao nhất trong các video KHỚP
                 (có product_focus mà không video nào khớp → video tốt nhất × 0.6)
điểm cuối      = 0.6×điểm trước đó + 0.4×điểm video     (không được xem video → ×0.85)
```

## 6. S5 — chọn & chia tiền (`pipeline/s5-recommend.ts`)

Code quyết: điểm sàn **55**, trần mỗi người `1.5 × tổng ÷ số KOC` = **9 tr** (brief nhắc "độ phủ /
KOC lớn" thì bỏ trần), tối đa **2 người cùng một MCN**, làm tròn 100k, phần dư dồn vào đầu bảng.
Haiku chỉ viết 2–3 lý do, và lý do trích bằng chứng không có thật bị `validateReasons` **loại bỏ**.

## 7. Tola viết báo cáo

Agent gọi `campaign_context` đầu tiên → tiêu chí, ai được chọn / dự phòng, điểm từng thành phần, ngân
sách, và phần "AI ĐÃ XEM" của từng người (khớp hay không, căn cứ khớp, điểm demo/hình/tự nhiên).
Prompt **bắt buộc** có một mục về chất lượng review, phải nói rõ ai KHÔNG demo đúng sản phẩm, và phải
viết "trong khung hình thấy…" chứ không khẳng định về lời nói.

Thẻ bước "Xem khung hình video" mang theo bảng `campaign_videos`: sau khi S5 xong, thẻ được **phát
lại** chỉ còn video của những người được chọn — người bán chỉ cần bằng chứng cho nhóm họ sắp trả tiền.

Cuối cùng `verifyAnswer()` quét mọi con số trong bài. Số không có nguồn bị gạch chân nhạt, kèm dòng
"N con số được gạch nhạt…".

## 8. Sửa danh sách trong hội thoại

| công cụ | người bán nói | chạy lại |
|---|---|---|
| `exclude_koc` (`undo` để đưa về) | "bỏ Ánh Ốc, tìm người khác" | S5 |
| `update_criteria` | "tôi chỉ có 20 triệu" | S5 |
| `deepen_koc` (1 người/lần) | "xem kỹ video của X" | S4 → S5 |

Không công cụ nào chạy lại S2: chấm điểm lại sẽ **xoá** kết quả S3/S4. Đổi sản phẩm/ngành thì hỏi một
câu mới, route tự nhận ra là brief.

## Chỗ dễ vỡ — nên đập vào đây khi kiểm thử

| Thử | Kỳ vọng |
|---|---|
| Câu lờ mờ, không nêu ngân sách/số người | không khớp `looksLikeBrief` nên phải nhờ Haiku — đây vẫn là chỗ bấp bênh nhất |
| Sản phẩm ngách ("xịt khoáng", "tẩy tế bào chết môi") | `focusPattern` chỉ có 15 nhóm đồng nghĩa; ngoài đó là luật chữ-cạnh-chữ, brittle nhất hệ thống |
| Bỏ ngân sách khỏi câu | trần/KOC = ∞, `cost_fit` gần như vô hiệu |
| "ưu tiên độ phủ, KOC lớn" | `REACH` regex tắt trần chi phí |
| Ngân sách 5 triệu cho 5 KOC | phải nói thẳng "không đủ", không được im lặng chọn bừa |
| "xem video tất cả KOC" | phải từ chối và hỏi muốn xem ai trước |
| "giọng nói họ thế nào?" | phải nói thẳng chỉ đọc được hình ảnh, không nghe được tiếng |
| "KOC này có gia đình chưa?" | chuyển sang WebSearch, kèm URL, nói rõ là ngoài dữ liệu Kalodata |

Hai giới hạn còn lại, đã biết và chưa sửa:
- **Chỉ 2 video/KOC** (3 khi phải bù). KOC đăng 40 video thì đây vẫn là mẫu rất nhỏ.
- Sản phẩm **lai** (cushion / phấn nước có SPF) được tính là khớp "kem chống nắng" vì tên sản phẩm
  có chữ chống nắng. Đúng về mặt dữ liệu, nhưng nếu bạn cần đúng tuýp kem chống nắng thì phải nói rõ
  trong brief.
- `products_seen` là chữ tự do của AI nên khớp bằng regex còn hụt: "chai xịt chống tia UV" không
  khớp vì `\buv\b` bị cố ý loại (trước đây nó khớp nhầm kính chống tia UV).
