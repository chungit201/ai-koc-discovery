# Kết quả test hỏi đáp ở trang hồ sơ KOC

> Chạy 2026-11-02 12:37 UTC · KOC `7088240910156923905` · http://localhost:3002 · `npm run test:koc`
> **14/15 ca đạt** · tổng chi phí AI **$0.4705** · tổng thời gian 511.5s

## Tiêu chí chấm

| Tiêu chí | Cách kiểm |
|---|---|
| Có dẫn chứng | Mỗi ý trong kết luận phải trích ≥1 `evidence_id`; số ý tối thiểu theo từng ca |
| Đúng trọng tâm | Ý phải trích đúng **nhóm bằng chứng** của câu hỏi (vd hỏi chi phí → `_cost`, hỏi liên hệ → `_contact`, hỏi video → `_video_`) |
| Kế hoạch bám câu hỏi | Bước bắt buộc phải có, bước thừa không được xuất hiện |
| Không nhiễu | Câu hỏi hồ sơ/liên hệ không được kèm bảng báo cáo hay thẻ sản phẩm |
| Không lách validator | Không được viết số bằng chữ ("hai mươi triệu") |

## Tổng hợp

| # | Ca | Nhóm | Kết quả | Kế hoạch | Ý có dẫn chứng | Thời gian | Chi phí |
|---|---|---|---|---|---|---|---|
| 1 | `metrics-overview` | Chỉ số & điểm nổi bật | ✅ | 3 bước | 3 | 1.9s | $0.0000 |
| 2 | `metrics-stability` | Chỉ số & điểm nổi bật | ❌ | 2 bước | 1 | 22.2s | $0.0254 |
| 3 | `metrics-engagement` | Chỉ số & điểm nổi bật | ✅ | 2 bước | 2 | 68.9s | $0.0557 |
| 4 | `metrics-audience` | Chỉ số & điểm nổi bật | ✅ | 2 bước | 1 | 32.3s | $0.0306 |
| 5 | `products-category` | Sản phẩm & danh mục | ✅ | 2 bước | 2 | 1.9s | $0.0000 |
| 6 | `products-brand` | Sản phẩm & danh mục | ✅ | 2 bước | 1 | 33.6s | $0.0327 |
| 7 | `profile-contact` | Hồ sơ & chi phí | ✅ | 2 bước | 1 | 21.7s | $0.0246 |
| 8 | `profile-cost` | Hồ sơ & chi phí | ✅ | 2 bước | 1 | 51.6s | $0.0437 |
| 9 | `profile-mcn` | Hồ sơ & chi phí | ✅ | 2 bước | 1 | 21.0s | $0.0248 |
| 10 | `content-quality` | Nội dung & video | ✅ | 3 bước | 5 | 73.0s | $0.0659 |
| 11 | `content-demo` | Nội dung & video | ✅ | 3 bước | 3 | 34.7s | $0.0346 |
| 12 | `oos-voice` | Ngoài phạm vi | ✅ | 1 bước | 0 | 0.1s | $0.0000 |
| 13 | `thread-1-overview` | Hỏi nối tiếp | ✅ | 2 bước | 4 | 67.1s | $0.0553 |
| 14 | `thread-2-cost` | Hỏi nối tiếp | ✅ | 2 bước | 1 | 51.4s | $0.0468 |
| 15 | `thread-3-contact` | Hỏi nối tiếp | ✅ | 2 bước | 1 | 30.2s | $0.0305 |

## Chi tiết từng ca

### 1. ✅ `metrics-overview` — Chỉ số & điểm nổi bật

**Câu hỏi:** Đánh giá khả năng bán hàng, so với creator cùng tầm thế nào?

**Kế hoạch AI lập:** 1. Lấy chỉ số bán hàng 30 ngày (doanh thu, sản phẩm bán, tương tác, độ ổn định) · 2. Lập nhóm KOC cùng tầm follower và so sánh hiệu suất bán hàng · 3. Đánh giá khả năng bán hàng và xếp hạng so với creator cùng tầm

**Kết quả từng bước:** 23 chỉ số từ DB: doanh thu, lượt xem, tương tác, sản phẩm, độ ổn định theo ngày · 6 KOC mỹ phẩm 128,6k–514,2k follower · doanh thu gấp 7,7 lần trung vị nhóm · tương tác thấp hơn trung vị nhóm 32% · Tổng hợp từ bằng chứng · 3 ý có nguồn

**Dẫn chứng kèm theo:** 4 sản phẩm, 4 KOC cùng tầm, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** Creator này bán hàng rất mạnh, vượt trội creator cùng quy mô follower; doanh thu gấp 7,7 lần trung vị nhóm đối chuẩn.

**Bố cục model tự dựng:** para → para → para → data:peers

**Các ý + bằng chứng được trích:**

- Khả năng bán hàng của creator này rất mạnh, xếp hạng số 1 trong nhóm creator mỹ phẩm cùng quy mô (128,6k–514,2k follower). Trong 30 ngày, doanh thu ₫30,3 tỉ gấp 7,7 lần trung vị nhóm đối chuẩn ₫3,9 tỉ. — `ev_koc_7088240910156923905_revenue`, `ev_koc_7088240910156923905_peer_revenue`
- Về cơ chế bán, creator chủ yếu dùng livestream, chốt được ₫33 tỉ từ 23k đơn trong tháng với tỷ lệ conversion 0,92% trên lượt xem live. Giá trị đơn bình quân ₫1,5 tr cho thấy khả năng upsell tốt. — `ev_koc_7088240910156923905_sales`, `ev_koc_7088240910156923905_live_conversion`, `ev_koc_7088240910156923905_subcategory_mix`, `ev_koc_7088240910156923905_channel_mix`
- Lưu ý: tương tác video của creator (0,40%) thấp hơn trung vị nhóm (0,58%), nhưng điều này không ảnh hưởng đến khả năng chốt sale vì chiến lược bán hàng chủ yếu qua livestream, không phụ thuộc vào tương tác video feed. — `ev_koc_7088240910156923905_peer_engagement`

**Gợi ý hỏi tiếp:**

- Sản phẩm nào bán chạy nhất?
- Tỷ lệ repeat customer như thế nào?
- Chi phí livestream mỗi phiên là bao nhiêu?

### 2. ❌ `metrics-stability` — Chỉ số & điểm nổi bật

**Câu hỏi:** Doanh thu có ổn định trong 30 ngày không?

**Kế hoạch AI lập:** 1. Đọc dữ liệu 30 ngày của KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** 23 chỉ số từ DB: doanh thu, lượt xem, tương tác, sản phẩm, độ ổn định theo ngày · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** 4 sản phẩm, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** KOC có doanh thu toàn bộ 30 ngày với phân bố doanh thu khá đều.

**Bố cục model tự dựng:** para → closing

**Các ý + bằng chứng được trích:**

- Doanh thu của KOC này khá ổn định. Cô bán hàng mỗi ngày trong cả 30 ngày, và ngày cao nhất chỉ chiếm 9% tổng doanh thu, điều này cho thấy doanh thu phân bố khá đều trên từng ngày chứ không phụ thuộc quá nhiều vào bất kỳ ngày nào cụ thể. — `ev_koc_7088240910156923905_consistency`

**Gợi ý hỏi tiếp:**

- Doanh thu livestream so với video bán hàng như thế nào?
- Sản phẩm nào mang lại doanh thu cao nhất trong 30 ngày?

**Không đạt:**

- chỉ 1/2 ý có dẫn chứng

### 3. ✅ `metrics-engagement` — Chỉ số & điểm nổi bật

**Câu hỏi:** Tỷ lệ tương tác của KOC này cao hay thấp?

**Kế hoạch AI lập:** 1. Đọc dữ liệu 30 ngày của KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** 23 chỉ số từ DB: doanh thu, lượt xem, tương tác, sản phẩm, độ ổn định theo ngày · Tổng hợp từ bằng chứng · 2 ý có nguồn

**Dẫn chứng kèm theo:** 4 sản phẩm, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** Tỷ lệ tương tác thấp, nhóm thấp, kém peer cùng tầm.

**Bố cục model tự dựng:** para → para

**Các ý + bằng chứng được trích:**

- Tỷ lệ tương tác của KOC này thấp. Video có tương tác 0,40%, nằm trong nhóm thấp so với 1012 KOC đã thu thập. — `ev_koc_7088240910156923905_engagement`
- Khi đối chuẩn với 6 KOC cùng danh mục bán hàng và quy mô follower (128,6k–514,2k), tương tác 0,40% này thấp hơn trung vị nhóm 32%, ở mức 0,58%. Bích Ngọc và Mây Ăn Ảnh 🌨 trong nhóm đạt 0,57% và 0,60%, cao hơn rõ rệt; chỉ có Lữ Nhật Hào thấp hơn với 0,35%. — `ev_koc_7088240910156923905_engagement`, `ev_koc_7088240910156923905_category_mix`, `ev_koc_7088240910156923905_subcategory_mix`, `ev_koc_7088240910156923905_products`, `ev_koc_7088240910156923905_peer_revenue`, `ev_koc_7088240910156923905_peer_engagement`, `ev_koc_7088240910156923905_peer_top`

**Gợi ý hỏi tiếp:**

- Tại sao doanh thu cao nhưng tương tác lại thấp?
- Khán giả của KOC là ai?
- Danh mục sản phẩm chính của KOC là gì?

### 4. ✅ `metrics-audience` — Chỉ số & điểm nổi bật

**Câu hỏi:** Khán giả của KOC này chủ yếu là ai?

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** Khán giả chủ yếu là nữ giới, nhóm tuổi 25-34

**Bố cục model tự dựng:** para

**Các ý + bằng chứng được trích:**

- Khán giả của KOC chủ yếu là nữ giới, nhóm tuổi 25-34. Với 257,1k follower độc lập không thuộc MCN nào, cô ấy thu hút đa số những người phụ nữ trẻ đang theo dõi hành trình skincare và làm đẹp của mình. — `ev_koc_7088240910156923905_audience`, `ev_koc_7088240910156923905_followers`

**Gợi ý hỏi tiếp:**

- KOC này bán nhiều sản phẩm danh mục nào nhất?
- Doanh thu và tương tác của KOC so với đối thủ cùng lĩnh vực như thế nào?
- Video có lượt xem cao nhất của KOC là video gì?

### 5. ✅ `products-category` — Sản phẩm & danh mục

**Câu hỏi:** Chủ yếu bán danh mục và sản phẩm nào?

**Kế hoạch AI lập:** 1. Đọc dữ liệu sản phẩm và danh mục bán trong 30 ngày · 2. Tổng hợp danh mục và sản phẩm chủ yếu

**Kết quả từng bước:** 23 chỉ số từ DB: doanh thu, lượt xem, tương tác, sản phẩm, độ ổn định theo ngày · Tổng hợp từ bằng chứng · 2 ý có nguồn

**Dẫn chứng kèm theo:** 4 sản phẩm, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** KOC bán chủ yếu chăm sóc da qua thương hiệu Lubylab

**Bố cục model tự dựng:** para → data:categories → data:top_products → para → closing

**Các ý + bằng chứng được trích:**

- KOC bán chủ yếu là chăm sóc da với ₫23,5 tỉ doanh thu, chiếm 72% tổng doanh thu sản phẩm trong 30 ngày. Trong đó, Lubylab là thương hiệu chính với 36/55 sản phẩm bán, chiếm 76% doanh thu. Sản phẩm top bán chạy là combo kem chống nắng Lubylab (5,2 tỉ) và kem Liposome cica PDRN (3,5 tỉ). — `ev_koc_7088240910156923905_category_mix`, `ev_koc_7088240910156923905_brand_focus`, `ev_koc_7088240910156923905_products`, `ev_koc_7088240910156923905_orders`, `ev_koc_7088240910156923905_revenue`
- Trong nhóm chăm sóc da, bộ dụng cụ chăm sóc da bán nhiều nhất với ₫10,5 tỉ (32% doanh thu), theo sau là serum & tinh chất ₫4,9 tỉ (15%). Giá sản phẩm trung vị là ₫1,6 tr/sản phẩm, dải từ ₫178,3k đến ₫5,1 tr. KOC đã bán được 19,9k đơn từ 55 sản phẩm, với giá trị đơn bình quân ₫1,6 tr. — `ev_koc_7088240910156923905_subcategory_mix`, `ev_koc_7088240910156923905_price_range`, `ev_koc_7088240910156923905_orders`

**Gợi ý hỏi tiếp:**

- Danh mục nào khác KOC bán ngoài chăm sóc da?
- Doanh thu livestream so với video như thế nào?
- Doanh thu 30 ngày gấp mấy lần KOC cùng quy mô?

### 6. ✅ `products-brand` — Sản phẩm & danh mục

**Câu hỏi:** KOC có bị phụ thuộc vào một thương hiệu nào không?

**Kế hoạch AI lập:** 1. Đọc dữ liệu 30 ngày của KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** 23 chỉ số từ DB: doanh thu, lượt xem, tương tác, sản phẩm, độ ổn định theo ngày · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** 4 sản phẩm, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** KOC độc lập pháp lý nhưng sản phẩm tập trung rất cao vào Lubylab

**Bố cục model tự dựng:** para

**Các ý + bằng chứng được trích:**

- Về mặt pháp lý, KOC là nhà sáng tạo độc lập, không thuộc shop hay MCN nào, nên không bị ràng buộc hợp đồng. Tuy nhiên, về nội dung và danh mục bán hàng thì lại tập trung rất mạnh vào Lubylab. Trong 55 sản phẩm đã bán, Lubylab chiếm 36 sản phẩm (65% số lượng) và mang lại 76% doanh thu sản phẩm. Điều này có nghĩa KOC vẫn có rủi ro phụ thuộc sản phẩm — nếu Lubylab giảm hợp tác hoặc thay đổi chính sách, doanh thu sẽ bị ảnh hưởng đáng kể. — `ev_koc_7088240910156923905_brand_focus`, `ev_koc_7088240910156923905_products`, `ev_koc_7088240910156923905_orders`, `ev_koc_7088240910156923905_top_videos`

**Gợi ý hỏi tiếp:**

- Top sản phẩm Lubylab bán chạy nhất là những gì?
- KOC bán bao nhiêu sản phẩm từ các brand khác?
- Lubylab có yêu cầu exclusivity (bán riêng) không?

### 7. ✅ `profile-contact` — Hồ sơ & chi phí

**Câu hỏi:** Tôi có thể liên hệ với KOC ở đâu?

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** KOC chưa công bố liên hệ công khai; chỉ có TikTok.

**Bố cục model tự dựng:** para → closing

**Các ý + bằng chứng được trích:**

- Hiện tại KOC chưa có liên hệ công khai trong hồ sơ. Bạn chỉ có thể liên hệ với cô ấy qua kênh TikTok @phuongsena bằng tin nhắn riêng hoặc bình luận trên video của cô. — `ev_koc_7088240910156923905_contact`

**Gợi ý hỏi tiếp:**

- KOC bán danh mục sản phẩm nào chủ yếu?
- Doanh thu livestream so với video là bao nhiêu?
- Khán giả của KOC là ai?

### 8. ✅ `profile-cost` — Hồ sơ & chi phí

**Câu hỏi:** Chi phí hợp tác ước tính bao nhiêu một video?

**Kế hoạch AI lập:** 1. Lấy thông tin quy mô follower và MCN của KOC · 2. Ước tính chi phí hợp tác dựa trên bậc follower

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** Chi phí ước tính một video tương đối cao, cần liên hệ trực tiếp để xác định.

**Bố cục model tự dựng:** para

**Các ý + bằng chứng được trích:**

- Chi phí hợp tác ước tính từ 4 triệu đến 10 triệu đồng một video, tùy theo quy mô follower. KOC này hiện có 257,1k follower và chưa công bố liên hệ hợp tác trong hồ sơ, nên bạn nên liên hệ trực tiếp qua TikTok @phuongsena để thương lượng chi phí cụ thể. Tuy nhiên con số này chỉ là ước tính với độ tin cậy thấp, giá thực tế có thể khác. — `ev_koc_7088240910156923905_cost`, `ev_koc_7088240910156923905_followers`

**Gợi ý hỏi tiếp:**

- KOC bán những sản phẩm gì, danh mục chủ yếu là gì?
- Doanh thu từ livestream chiếm bao nhiêu so với video content?

### 9. ✅ `profile-mcn` — Hồ sơ & chi phí

**Câu hỏi:** KOC này có thuộc MCN nào không?

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** KOC không thuộc MCN, hoạt động độc lập

**Bố cục model tự dựng:** para

**Các ý + bằng chứng được trích:**

- Không, KOC này không thuộc MCN nào. Với 257,1k follower, cô ấy hoạt động như một nhà sáng tạo độc lập. — `ev_koc_7088240910156923905_followers`

**Gợi ý hỏi tiếp:**

- KOC bán những sản phẩm gì, doanh thu bao nhiêu?
- Làm sao liên hệ với KOC?
- Khán giả của KOC là ai?

### 10. ✅ `content-quality` — Nội dung & video

**Câu hỏi:** Chất lượng nội dung và cách review sản phẩm ra sao?

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Xem khung hình video để đánh giá chất lượng nội dung, cách review, demo sản phẩm · 3. Tổng hợp nhận xét về nội dung, cách review và chất lượng hình ảnh

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Đã xem 2 video, mỗi video 4 khung hình · Tổng hợp từ bằng chứng · 5 ý có nguồn

**Dẫn chứng kèm theo:** 2 video, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** Phong cách review chi tiết nhưng tập trung quá mạnh vào Lubylab ảnh hưởng tính khách quan.

**Bố cục model tự dựng:** para → heading → para → heading → bullets → heading → para → data:top_videos → closing

**Các ý + bằng chứng được trích:**

- Chất lượng nội dung của KOC có phong cách review khá chi tiết, tập trung vào skincare routine và chăm sóc da. Tuy nhiên, có một điểm hạn chế là sự tập trung quá mạnh vào thương hiệu Lubylab, điều này ảnh hưởng tới tính khách quan của các bài review. — `ev_koc_7088240910156923905_brand_focus`
- KOC sử dụng phong cách review chi tiết với mức độ review đạt 70/100. Nội dung chủ yếu xoay quanh skincare routine, chăm sóc da và bảo vệ nắng. Cô đăng 30 video trong 30 ngày với tần suất đều đặn, mỗi video trung bình đạt 18,8k lượt xem. — `ev_koc_7088240910156923905_views`, `ev_koc_7088240910156923905_revenue`, `ev_koc_7088240910156923905_consistency`, `ev_koc_7088240910156923905_videos`, `ev_koc_7088240910156923905_sales`, `ev_koc_7088240910156923905_channel_mix`, `ev_koc_7088240910156923905_video_7691979426153762055`
- Các video đều có demo sản phẩm. Ví dụ, video 'Kem chống nắng Lubylab Elixir – bước cuối không thể bỏ qua t' (49,8k view) có demo thực tế, KOC cầm sản phẩm và thoa thử trên da. — `ev_koc_7088240910156923905_video_7691979426153762055`
- Chất lượng hình ảnh ở mức 65-70/100, độ tự nhiên của video khoảng 60/100. Một số video như 'Da xỉn màu, thiếu sức sống thì thử ngay Bút Bột Dưỡng Sáng' (23,6k view) có cầm sản phẩm giới thiệu nhưng chưa demo trực tiếp lên da. — `ev_koc_7088240910156923905_video_7691979426153762055`, `ev_koc_7088240910156923905_video_7693480710002199828`
- Lubylab chiếm 76% doanh thu sản phẩm với 36 trong 55 sản phẩm bán ra. Sự tập trung quá mạnh vào một thương hiệu duy nhất có thể làm giảm tính khách quan của nội dung, vì khán giả có thể nhận thấy rằng KOC chủ yếu là người quảng cáo cho Lubylab chứ không phải reviewer độc lập. — `ev_koc_7088240910156923905_brand_focus`

**Gợi ý hỏi tiếp:**

- Video nào của KOC này bán được nhiều tiền nhất?
- Nội dung review của KOC này so với các KOC khác như thế nào?
- KOC này có thích hợp để hợp tác không?

### 11. ✅ `content-demo` — Nội dung & video

**Câu hỏi:** KOC có demo sản phẩm trực tiếp trong video không?

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Xem video bằng AI · 3. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Đã xem 2 video, mỗi video 4 khung hình · Tổng hợp từ bằng chứng · 3 ý có nguồn

**Dẫn chứng kèm theo:** 2 video, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** KOC có demo sản phẩm trực tiếp trong một số video, nhưng không phải tất cả.

**Bố cục model tự dựng:** para → bullets → closing

**Các ý + bằng chứng được trích:**

- KOC có demo sản phẩm trực tiếp (thoa thử lên da) nhưng không phải video nào cũng vậy. Trong số các video được xem chi tiết, có video thể hiện demo đầy đủ, còn lại chỉ là giới thiệu và cầm sản phẩm nói chuyện mà chưa thực hành trên da. — `ev_koc_7088240910156923905_video_7691979426153762055`, `ev_koc_7088240910156923905_video_7693480710002199828`
- Video 'Kem chống nắng Lubylab Elixir – bước cuối không thể bỏ qua t' (49,8k view): KOC nữ **thoa thử kem chống nắng Lubylab trực tiếp**, với độ demo sản phẩm 70/100, trong bối cảnh livestream sự kiện. — `ev_koc_7088240910156923905_video_7691979426153762055`
- Video '✨ Da xỉn màu, thiếu sức sống thì thử ngay Bút Bột Dưỡng Sáng' (23,6k view): KOC giới thiệu bút dưỡng sáng da, cầm sản phẩm nói chuyện nhưng **chưa thoa trực tiếp lên da**, độ demo chỉ 70/100. — `ev_koc_7088240910156923905_video_7693480710002199828`

**Gợi ý hỏi tiếp:**

- KOC chủ yếu bán những sản phẩm gì?
- Video nào của KOC có lượt xem cao nhất?
- Chi phí hợp tác với KOC này khoảng bao nhiêu?

### 12. ✅ `oos-voice` — Ngoài phạm vi

**Câu hỏi:** Giọng nói của KOC này có hay không?

**Kế hoạch AI lập:** 1. Kiểm tra phạm vi dữ liệu

**Kết quả từng bước:** Dữ liệu video chỉ có khung hình, không có âm thanh

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** Phần xem video của mình chỉ đọc được hình ảnh (4 khung hình: cách demo sản phẩm, bối cảnh, độ tự nhiên) — chưa nghe được âm thanh nên mình không đánh giá giọng nói được, và mình không muốn đoán bừa. Bạn có thể xem trực tiếp video trong thẻ KOC; còn về hình ảnh và cách review thì mình phân tích được.

**Bố cục model tự dựng:** (trống)

### 13. ✅ `thread-1-overview` — Hỏi nối tiếp

**Câu hỏi:** Đánh giá tổng quan KOC này giúp tôi _(hỏi nối tiếp trong cuộc `t-follow`)_

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 4 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** KOC Phương Sena mạnh doanh thu và ổn định, yếu tương tác và brand concentration.

**Bố cục model tự dựng:** para → heading → para → heading → bullets → heading → para → closing

**Các ý + bằng chứng được trích:**

- Phương Sena là creator độc lập với 257,1k followers, không thuộc MCN, có doanh thu mỹ phẩm 30 ngày ₫30,3 tỉ — vượt xa so với 6 KOC cùng nhóm quy mô. Cụ thể, doanh thu gấp 7,7 lần trung vị nhóm (₫3,9 tỉ) và cao hơn các đối thủ như Nguyễn Quỳnh Anh (₫6,5 tỉ), Bích Ngọc (₫4,7 tỉ) hay Mây Ăn Ảnh (₫4,3 tỉ). Tuy vậy, tương tác chỉ 0,40% — thấp hơn 32% so với trung vị nhóm — và nội dung quá tập trung vào brand Lubylab (76% doanh thu sản phẩm), ảnh hưởng đến tính khách quan. — `ev_koc_7088240910156923905_followers`, `ev_koc_7088240910156923905_revenue`, `ev_koc_7088240910156923905_peer_revenue`, `ev_koc_7088240910156923905_peer_top`, `ev_koc_7088240910156923905_engagement`, `ev_koc_7088240910156923905_peer_engagement`, `ev_koc_7088240910156923905_brand_focus`
- Xếp hạng 1/7 trong nhóm đối chuẩn cùng quy mô (128,6k–514,2k follower). Đặc biệt nổi bật là tính ổn định: có doanh thu cả 30 ngày liên tiếp, ngày cao nhất chỉ chiếm 9% tổng doanh thu — điều này cho thấy hiệu suất bán hàng rất đều. Chiến lược chủ yếu qua livestream (₫33 tỉ, 100% tổng doanh thu từ hàng thật), bán được 23k đơn với tỷ lệ chốt đơn 0,92% trên lượt xem livestream — con số khá tốt cho ngành mỹ phẩm. — `ev_koc_7088240910156923905_peer_revenue`, `ev_koc_7088240910156923905_consistency`, `ev_koc_7088240910156923905_channel_mix`, `ev_koc_7088240910156923905_sales`, `ev_koc_7088240910156923905_live_conversion`
- Tương tác video 0,40% — nhóm thấp, 32% dưới trung vị nhóm đối chuẩn (0,58%). Nguyễn Quỳnh Anh (cùng nhóm) có tương tác 2,82%; Bích Ngọc 0,57%; Lữ Nhật Hào 0,35%. — `ev_koc_7088240910156923905_engagement`, `ev_koc_7088240910156923905_peer_engagement`, `ev_koc_7088240910156923905_peer_top`
- 30 video trong 30 ngày, 14 video chạy quảng cáo. Video top performer: 'Kem chống nắng Lubylab Elixir' 49,8k view, mang về ₫6,5 tr; 'Cushion Lubylab' 46,6k view, ₫3,7 tr; 'Tẩy trang Lubylab' 43,9k view, ₫4 tr. Nội dung tập trung skincare routine, face care, sun protection — hầu hết có demo sản phẩm. Chi phí ước tính ₫4–10 tr/video theo quy mô follower (độ tin cậy thấp). — `ev_koc_7088240910156923905_videos`, `ev_koc_7088240910156923905_top_videos`, `ev_koc_7088240910156923905_cost`

**Gợi ý hỏi tiếp:**

- Sản phẩm nào bán tốt nhất, tôi nên ưu tiên danh mục nào khi hợp tác?
- So sánh KOC này với Nguyễn Quỳnh Anh, nên chọn ai để bán hàng?
- Khán giả của KOC này là ai, phù hợp với sản phẩm của tôi không?

### 14. ✅ `thread-2-cost` — Hỏi nối tiếp

**Câu hỏi:** Thế còn chi phí hợp tác thì sao? _(hỏi nối tiếp trong cuộc `t-follow`)_

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC để xác định quy mô follower · 2. Ước tính chi phí hợp tác dựa trên bậc follower

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** Chi phí ước tính ₫4–₫10 tr/video nhưng độ tin cậy thấp, cần liên hệ trực tiếp.

**Bố cục model tự dựng:** para

**Các ý + bằng chứng được trích:**

- Chi phí hợp tác được ước tính ₫4 tr–₫10 tr/video, tính theo bậc follower của Phương Sena là 257,1k. Tuy nhiên con số này chỉ là ước tính với độ tin cậy thấp, nên bạn nên liên hệ trực tiếp qua TikTok @phuongsena (kênh công khai duy nhất trong hồ sơ) để thương lượng chi phí cụ thể. Mức giá sẽ thay đổi tuỳ theo hình thức hợp tác bạn lựa chọn. — `ev_koc_7088240910156923905_cost`, `ev_koc_7088240910156923905_followers`, `ev_koc_7088240910156923905_contact`

**Gợi ý hỏi tiếp:**

- Doanh thu từ livestream hay video dạng clip lớn hơn?
- Sản phẩm top 3 bán chạy nhất của Phương Sena là cái nào?
- Tương tác của Phương Sena thấp hơn bao nhiêu so với KOC ngang cơ?

### 15. ✅ `thread-3-contact` — Hỏi nối tiếp

**Câu hỏi:** Vậy liên hệ với họ bằng cách nào? _(hỏi nối tiếp trong cuộc `t-follow`)_

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** KOC chưa công bố thông tin liên hệ công khai.

**Bố cục model tự dựng:** para

**Các ý + bằng chứng được trích:**

- Phương Sena chưa có liên hệ công khai trong hồ sơ. Cách duy nhất để tiếp cận hiện tại là qua kênh TikTok @phuongsena của cô ấy. — `ev_koc_7088240910156923905_contact`

**Gợi ý hỏi tiếp:**

- Nên gửi sản phẩm danh mục nào cho cô ấy?
- Khán giả chủ yếu của cô ấy là ai?
- Doanh thu của cô ấy ổn định trong tháng không?
