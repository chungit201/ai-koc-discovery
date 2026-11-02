# Kết quả test hỏi đáp ở trang hồ sơ KOC

> Chạy 2026-11-02 11:02 UTC · KOC `7088624652566660098` · http://localhost:3002 · `npm run test:koc`
> **13/15 ca đạt** · tổng chi phí AI **$0.0000** · tổng thời gian 23.0s

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
| 1 | `metrics-overview` | Chỉ số & điểm nổi bật | ✅ | 4 bước | 2 | 1.9s | $0.0000 |
| 2 | `metrics-stability` | Chỉ số & điểm nổi bật | ❌ | 2 bước | 0 | 1.7s | $0.0000 |
| 3 | `metrics-engagement` | Chỉ số & điểm nổi bật | ✅ | 2 bước | 2 | 1.9s | $0.0000 |
| 4 | `metrics-audience` | Chỉ số & điểm nổi bật | ✅ | 2 bước | 1 | 1.5s | $0.0000 |
| 5 | `products-category` | Sản phẩm & danh mục | ✅ | 2 bước | 2 | 1.8s | $0.0000 |
| 6 | `products-brand` | Sản phẩm & danh mục | ❌ | 2 bước | 0 | 1.8s | $0.0000 |
| 7 | `profile-contact` | Hồ sơ & chi phí | ✅ | 2 bước | 1 | 1.4s | $0.0000 |
| 8 | `profile-cost` | Hồ sơ & chi phí | ✅ | 2 bước | 1 | 1.5s | $0.0000 |
| 9 | `profile-mcn` | Hồ sơ & chi phí | ✅ | 2 bước | 1 | 1.5s | $0.0000 |
| 10 | `content-quality` | Nội dung & video | ✅ | 3 bước | 3 | 1.8s | $0.0000 |
| 11 | `content-demo` | Nội dung & video | ✅ | 3 bước | 3 | 1.8s | $0.0000 |
| 12 | `oos-voice` | Ngoài phạm vi | ✅ | 1 bước | 0 | 0.1s | $0.0000 |
| 13 | `thread-1-overview` | Hỏi nối tiếp | ✅ | 2 bước | 6 | 1.4s | $0.0000 |
| 14 | `thread-2-cost` | Hỏi nối tiếp | ✅ | 2 bước | 1 | 1.4s | $0.0000 |
| 15 | `thread-3-contact` | Hỏi nối tiếp | ✅ | 2 bước | 1 | 1.4s | $0.0000 |

## Chi tiết từng ca

### 1. ✅ `metrics-overview` — Chỉ số & điểm nổi bật

**Câu hỏi:** Đánh giá khả năng bán hàng, so với creator cùng tầm thế nào?

**Kế hoạch AI lập:** 1. Lấy thông tin quy mô follower để xác định nhóm so sánh · 2. Phân tích doanh thu, lượt xem, tương tác, sản phẩm đã bán trong 30 ngày · 3. So sánh hiệu suất bán hàng với creator cùng quy mô follower · 4. Tổng hợp đánh giá khả năng bán hàng và vị trí trong nhóm peer

**Kết quả từng bước:** 19 chỉ số từ DB: doanh thu, lượt xem, tương tác, sản phẩm, độ ổn định theo ngày · 260 KOC mỹ phẩm 220,3k–881,2k follower · doanh thu gấp 81 lần trung vị nhóm · tương tác thấp hơn trung vị nhóm 87% · Tổng hợp từ bằng chứng · 2 ý có nguồn

**Dẫn chứng kèm theo:** 4 sản phẩm, 4 KOC cùng tầm, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** Khả năng bán hàng vượt trội so với nhóm cùng tầm, nhưng không phải nhất và chủ yếu từ livestream.

**Bố cục model tự dựng:** para → para

**Các ý + bằng chứng được trích:**

- Điều đáng lưu ý là doanh thu cao như vậy hầu như toàn bộ đến từ livestream (₫10,1 tỉ, chiếm 99% tổng), còn video chỉ sinh ra ₫100,9 tr. Trong 30 ngày, creator tổ chức 28 phiên live với ₫6,4 tr trên 1.000 lượt xem live. Nên nếu bạn muốn đánh giá khả năng bán qua content video thì con số sẽ thấp hơn nhiều. — `ev_koc_7088624652566660098_revenue`, `ev_koc_7088624652566660098_views`, `ev_koc_7088624652566660098_consistency`, `ev_koc_7088624652566660098_videos`, `ev_koc_7088624652566660098_sales`, `ev_koc_7088624652566660098_channel_mix`
- Một điểm khác cần chú ý: tỷ lệ tương tác video của creator chỉ 0,45%, thấp hơn 87% so với trung vị nhóm cùng tầm (3,58%). Điều này có thể liên quan đến chiến lược chủ yếu dựa vào livestream thay vì xây dựng độc lập từ video. — `ev_koc_7088624652566660098_peer_engagement`

**Gợi ý hỏi tiếp:**

- Sản phẩm nào bán chạy nhất của creator này?
- Danh mục trang điểm chiếm bao nhiêu doanh thu?
- Phương Sena bán hơn ₫30 tỉ qua livestream hay video?

### 2. ❌ `metrics-stability` — Chỉ số & điểm nổi bật

**Câu hỏi:** Doanh thu có ổn định trong 30 ngày không?

**Kế hoạch AI lập:** 1. Đọc dữ liệu 30 ngày của KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** 19 chỉ số từ DB: doanh thu, lượt xem, tương tác, sản phẩm, độ ổn định theo ngày · Tổng hợp từ bằng chứng · 0 ý có nguồn

**Dẫn chứng kèm theo:** 4 sản phẩm, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** Doanh thu ổn định với phân bổ đều trên 30 ngày.

**Bố cục model tự dựng:** para

**Gợi ý hỏi tiếp:**

- Sản phẩm nào bán chạy nhất trong kỳ này?
- Doanh thu gấp bao nhiêu lần trung vị nhóm cùng tầm?
- Livestream hay video bình thường là kênh bán chính?

**Không đạt:**

- chỉ 0/2 ý có dẫn chứng
- không trích bằng chứng đúng trọng tâm (consistency)

### 3. ✅ `metrics-engagement` — Chỉ số & điểm nổi bật

**Câu hỏi:** Tỷ lệ tương tác của KOC này cao hay thấp?

**Kế hoạch AI lập:** 1. Đọc dữ liệu 30 ngày của KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** 19 chỉ số từ DB: doanh thu, lượt xem, tương tác, sản phẩm, độ ổn định theo ngày · Tổng hợp từ bằng chứng · 2 ý có nguồn

**Dẫn chứng kèm theo:** 4 sản phẩm, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** Tỷ lệ tương tác của KOC này xếp vào nhóm thấp, kém đối chiếu với nhóm cùng tầm.

**Bố cục model tự dựng:** para → para → closing

**Các ý + bằng chứng được trích:**

- Tỷ lệ tương tác của KOC này là 0,45%, xếp vào nhóm thấp. So với 260 KOC cùng tầm (220,3k–881,2k follower), tỷ lệ 0,45% thấp hơn trung vị nhóm 87%, chỉ đạt 3,58% của trung vị nhóm cùng tầm. — `ev_koc_7088624652566660098_engagement`, `ev_koc_7088624652566660098_peer_revenue`, `ev_koc_7088624652566660098_peer_engagement`
- Để so sánh cụ thể: KOC doanh thu cao nhất trong nhóm cùng tầm như Phương Sena, Mần đẹp 💅, hay Ngân lỳ ☺️66P1 đều có tỷ lệ tương tác từ 0,40% đến 1,37%, trong đó Ngân lỳ ☺️66P1 đạt 1,37%. Điều này cho thấy mặc dù KOC bán hàng rất khủng, khán giả lại không tương tác video nhiều. — `ev_koc_7088624652566660098_peer_top`

**Gợi ý hỏi tiếp:**

- Doanh thu của KOC này so với nhóm cùng tầm như thế nào?
- Chính livestream hay video nào chính là nguồn doanh thu chính?
- Khán giả KOC này là ai?

### 4. ✅ `metrics-audience` — Chỉ số & điểm nổi bật

**Câu hỏi:** Khán giả của KOC này chủ yếu là ai?

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** Khán giả chủ yếu là nữ trẻ nhóm tuổi 25-34

**Bố cục model tự dựng:** para → closing

**Các ý + bằng chứng được trích:**

- Khán giả của KOC này đa số là nữ, nhóm tuổi 25-34. — `ev_koc_7088624652566660098_audience`

**Gợi ý hỏi tiếp:**

- Sản phẩm nào bán chạy nhất trên kênh này?
- Tỷ lệ tương tác video của KOC này như thế nào?
- Doanh thu của KOC này so với các KOC cùng tầm ra sao?

### 5. ✅ `products-category` — Sản phẩm & danh mục

**Câu hỏi:** Chủ yếu bán danh mục và sản phẩm nào?

**Kế hoạch AI lập:** 1. Đọc dữ liệu 30 ngày của KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** 19 chỉ số từ DB: doanh thu, lượt xem, tương tác, sản phẩm, độ ổn định theo ngày · Tổng hợp từ bằng chứng · 2 ý có nguồn

**Dẫn chứng kèm theo:** 4 sản phẩm, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** KOC tập trung bán trang điểm với thương hiệu Bảng.

**Bố cục model tự dựng:** para → data:categories → para → closing

**Các ý + bằng chứng được trích:**

- KOC chủ yếu bán trang điểm, chiếm 74% doanh thu sản phẩm với 10,2 tỉ đồng, tiếp theo là chăm sóc da với 23% doanh thu. — `ev_koc_7088624652566660098_category_mix`
- Trong danh mục trang điểm, sản phẩm bán chạy nhất là kem che khuyết điểm & phấn nền (2,6 tỉ, 19% doanh thu), phấn mắt (2,2 tỉ, 16%), và tẩy trang (1,3 tỉ, 10%). Thương hiệu Bảng xuất hiện nhiều nhất với 16/100 sản phẩm, đóng góp 21% tổng doanh thu sản phẩm. — `ev_koc_7088624652566660098_subcategory_mix`, `ev_koc_7088624652566660098_brand_focus`

**Gợi ý hỏi tiếp:**

- Sản phẩm nào bán chạy nhất?
- Thương hiệu Bảng có những sản phẩm nào?
- Doanh thu livestream vs video?

### 6. ❌ `products-brand` — Sản phẩm & danh mục

**Câu hỏi:** KOC có bị phụ thuộc vào một thương hiệu nào không?

**Kế hoạch AI lập:** 1. Đọc dữ liệu 30 ngày của KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** 19 chỉ số từ DB: doanh thu, lượt xem, tương tác, sản phẩm, độ ổn định theo ngày · Tổng hợp từ bằng chứng · 0 ý có nguồn

**Dẫn chứng kèm theo:** 4 sản phẩm, bảng báo cáo

**Trả lời (tóm tắt nội bộ):** KOC độc lập, không bị phụ thuộc thương hiệu nào.

**Bố cục model tự dựng:** para

**Gợi ý hỏi tiếp:**

- Sản phẩm bán chạy nhất của KOC là cái gì?
- KOC bán những danh mục mỹ phẩm nào?

**Không đạt:**

- chỉ 0/1 ý có dẫn chứng
- không trích bằng chứng đúng trọng tâm (products / category_mix)

### 7. ✅ `profile-contact` — Hồ sơ & chi phí

**Câu hỏi:** Tôi có thể liên hệ với KOC ở đâu?

**Kế hoạch AI lập:** 1. Xem hồ sơ KOC và kênh liên hệ công khai · 2. Tổng hợp thông tin liên hệ

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** KOC chưa công khai thông tin liên hệ trực tiếp.

**Bố cục model tự dựng:** para → closing

**Các ý + bằng chứng được trích:**

- KOC hiện chưa có liên hệ công khai trong hồ sơ. Bạn có thể tiếp cận qua kênh TikTok @maitrinh0912 hoặc qua MCN UpBase Technology Joint Stock Company, nơi KOC đang hợp tác. — `ev_koc_7088624652566660098_contact`, `ev_koc_7088624652566660098_followers`

**Gợi ý hỏi tiếp:**

- Doanh thu từ livestream chiếm bao nhiêu tổng doanh thu?
- KOC đã bán những sản phẩm nào bán chạy nhất?

### 8. ✅ `profile-cost` — Hồ sơ & chi phí

**Câu hỏi:** Chi phí hợp tác ước tính bao nhiêu một video?

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** Chi phí ước tính khoảng 9,6–24 triệu một video, nhưng độ tin cậy thấp.

**Bố cục model tự dựng:** para → closing

**Các ý + bằng chứng được trích:**

- Chi phí hợp tác ước tính khoảng 9,6 triệu đến 24 triệu đồng một video, được tính theo bậc follower với lệ phí MCN là 1,2 lần. Tuy nhiên, đây là con số ước tính có độ tin cậy thấp, nên bạn nên liên hệ trực tiếp với KOC hoặc MCN UpBase Technology để xác nhận giá chính xác. — `ev_koc_7088624652566660098_cost`

**Gợi ý hỏi tiếp:**

- Doanh thu từ livestream và video chia cách như thế nào?
- KOC đã bán bao nhiêu sản phẩm trong 30 ngày qua?
- Tỷ lệ tương tác video của KOC này so với nhóm cùng tầm thế nào?

### 9. ✅ `profile-mcn` — Hồ sơ & chi phí

**Câu hỏi:** KOC này có thuộc MCN nào không?

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** KOC thuộc MCN UpBase

**Bố cục model tự dựng:** para

**Các ý + bằng chứng được trích:**

- Có, KOC này thuộc MCN UpBase Technology Joint Stock Company. — `ev_koc_7088624652566660098_followers`

**Gợi ý hỏi tiếp:**

- Doanh thu 30 ngày của KOC này so với nhóm cùng tầm như thế nào?
- Khán giả chính của KOC này là ai?
- Danh mục sản phẩm bán nhiều nhất là gì?

### 10. ✅ `content-quality` — Nội dung & video

**Câu hỏi:** Chất lượng nội dung và cách review sản phẩm ra sao?

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Xem khung hình video để đánh giá chất lượng nội dung và cách review sản phẩm · 3. Tổng hợp đánh giá chất lượng nội dung và cách review sản phẩm

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Đã xem 2 video, mỗi video 4 khung hình · Tổng hợp từ bằng chứng · 3 ý có nguồn

**Dẫn chứng kèm theo:** 2 video

**Trả lời (tóm tắt nội bộ):** Nội dung có sự chênh lệch chất lượng giữa video demo chi tiết và video livestream.

**Bố cục model tự dựng:** para → heading → bullets → closing

**Các ý + bằng chứng được trích:**

- Chất lượng nội dung của KOC không ổn định. Có những video demo sản phẩm chi tiết và chuyên nghiệp, nhưng cũng có những video chỉ quay màn hình livestream bán hàng mà không có demo sản phẩm cụ thể. — `ev_koc_7088624652566660098_video_7637821422731005191`, `ev_koc_7088624652566660098_video_7694248416360123655`
- Video demo sản phẩm: Video 'Ai đang phân vân không biết chọn mỹ phẩm gì thì vô live Mai' (89,1k view) có demo sản phẩm 78/100, chất lượng hình ảnh 70/100, độ tự nhiên 75/100. KOC giới thiệu chi tiết các bảng phấn mắt Cheeryep và mời khách xem tiếp trong livest — `ev_koc_7088624652566660098_video_7637821422731005191`
- Video livestream: Video 'Manifest live Mai Trịnh lúc nào cũng có deal zá hạt dẻ' (42,5k view) chỉ quay màn hình livestream bán hàng, không có demo sản phẩm (5/100), chất lượng hình ảnh 40/100, độ tự nhiên 30/100. — `ev_koc_7088624652566660098_video_7694248416360123655`

**Gợi ý hỏi tiếp:**

- Sản phẩm nào bán chạy nhất?
- Doanh thu bán hàng trong 30 ngày ổn định không?
- Tương tác video so với KOC cùng tầm thế nào?

### 11. ✅ `content-demo` — Nội dung & video

**Câu hỏi:** KOC có demo sản phẩm trực tiếp trong video không?

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Xem video bằng AI · 3. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Đã xem 2 video, mỗi video 4 khung hình · Tổng hợp từ bằng chứng · 3 ý có nguồn

**Dẫn chứng kèm theo:** 2 video

**Trả lời (tóm tắt nội bộ):** Mai Trịnh có demo sản phẩm trong một số video nhưng không phải tất cả.

**Bố cục model tự dựng:** para → para → para → data:videos → closing

**Các ý + bằng chứng được trích:**

- Có, nhưng không phải tất cả video của Mai Trịnh đều có demo sản phẩm trực tiếp. Trong 30 video 30 ngày, có những video demo chi tiết với sản phẩm thực, nhưng cũng có video chỉ quay màn hình livestream mà không có nội dung demo. — `ev_koc_7088624652566660098_videos`
- Video nhiều view nhất (89,1k lượt) có demo sản phẩm khá đầy đủ. Video 'Ai đang phân vân không biết chọn mỹ phẩm gì thì vô live Mai' đạt mức demo 78/100, chất lượng hình 70/100, độ tự nhiên 75/100. Mai giới thiệu các bảng phấn mắt Cheeryep, hộp phấn mắt nắp xanh lá và nắp hồng, đồng thời mời khán giả xem thêm tư vấn trong livestream. — `ev_koc_7088624652566660098_video_7637821422731005191`
- Ngược lại, một số video không có demo trực tiếp. Video 'Manifest live Mai Trịnh lúc nào cũng có deal zá hạt dẻ' (42,5k view) chỉ quay màn hình livestream với danh sách sale, không có người dẫn hay demo thực tế, chỉ đạt 5/100 về demo, 40/100 chất lượng hình và 30/100 độ tự nhiên. — `ev_koc_7088624652566660098_video_7694248416360123655`

**Gợi ý hỏi tiếp:**

- Doanh thu chính là từ video hay livestream của Mai Trịnh?
- Mai Trịnh bán những danh mục mỹ phẩm nào nhiều nhất?
- Tương tác và engagement của Mai Trịnh so với các KOC cùng tầm như thế nào?

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

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 6 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** KOC maitrinh0912 là nhóm dẫn đầu về doanh thu mỹ phẩm nhưng có tương tác yếu

**Bố cục model tự dựng:** para → heading → para → para → heading → para → heading → para → heading → para → closing

**Các ý + bằng chứng được trích:**

- KOC maitrinh0912 là một người bán hàng mỹ phẩm rất mạnh về doanh thu, thuộc nhóm dẫn đầu trong số 1012 KOC được khảo sát. Tuy nhiên, tương tác lại ở nhóm thấp, điều này cho thấy khán giả chủ yếu chuyên mua hàng hơn là tương tác nội dung. — `ev_koc_7088624652566660098_revenue`, `ev_koc_7088624652566660098_views`, `ev_koc_7088624652566660098_engagement`, `ev_koc_7088624652566660098_contact`
- Doanh thu mỹ phẩm 30 ngày đạt 9,7 tỉ đồng, cao hơn 100% các KOC khác, xếp maitrinh0912 vào nhóm dẫn đầu. So sánh với 260 KOC cùng tầm (220,3k–881,2k follower), doanh thu gấp 81 lần trung vị nhóm (120,1 triệu đồng). Chỉ hai KOC khác là Phương Sena (30,3 tỉ và 12,3 tỉ) và Mần đẹp 💅 (11,2 tỉ) bán được nhiều hơn. — `ev_koc_7088624652566660098_revenue`, `ev_koc_7088624652566660098_views`, `ev_koc_7088624652566660098_contact`, `ev_koc_7088624652566660098_consistency`, `ev_koc_7088624652566660098_brand_focus`, `ev_koc_7088624652566660098_products`, `ev_koc_7088624652566660098_videos`, `ev_koc_7088624652566660098_peer_revenue`, `ev_koc_7088624652566660098_peer_top`
- Danh mục bán chạy nhất là Trang điểm với 10,2 tỉ đồng (74% doanh thu), tiếp đến Chăm sóc da với 3,1 tỉ đồng (23%). Trong đó, Kem che khuyết điểm & Phấn nền là nhóm sản phẩm dẫn đầu với 2,6 tỉ đồng (19% doanh thu sản phẩm). Thương hiệu Bảng xuất hiện nhiều nhất, chiếm 21% doanh thu sản phẩm. — `ev_koc_7088624652566660098_category_mix`, `ev_koc_7088624652566660098_subcategory_mix`, `ev_koc_7088624652566660098_brand_focus`
- Lượt xem 30 ngày là 9,1 triệu, cao hơn 75% các KOC khác, thuộc nhóm trên trung bình. Tuy nhiên, tỷ lệ tương tác video chỉ 0,45%, chỉ cao hơn 5% các KOC — đây là nhóm thấp. So với nhóm cùng tầm, tương tác thấp hơn trung vị nhóm 87% (0,45% so với 3,58%). Điều này phản ánh một khán giả có mục đích mua sắm rõ ràng hơn là tương tác với nội dung. — `ev_koc_7088624652566660098_views`, `ev_koc_7088624652566660098_engagement`, `ev_koc_7088624652566660098_peer_engagement`
- Khán giả chủ yếu là phụ nữ, nhóm tuổi 25-34. Với 440,6k follower, maitrinh0912 hoạt động độc lập, không phụ thuộc shop nào. Doanh thu xuất hiện đều đặn 30 ngày liên tiếp, ngày cao nhất chỉ chiếm 5% tổng doanh thu, cho thấy tính ổn định cao. Nguồn doanh thu chủ yếu từ livestream (10,1 tỉ đồng, 99% tổng) thay vì video thường (100,9 triệu đồng), với 28 phiên live trong kỳ. — `ev_koc_7088624652566660098_revenue`, `ev_koc_7088624652566660098_views`, `ev_koc_7088624652566660098_engagement`, `ev_koc_7088624652566660098_followers`, `ev_koc_7088624652566660098_contact`, `ev_koc_7088624652566660098_audience`, `ev_koc_7088624652566660098_consistency`, `ev_koc_7088624652566660098_videos`, `ev_koc_7088624652566660098_sales`, `ev_koc_7088624652566660098_channel_mix`
- Chi phí ước tính khoảng 9,6–24 triệu đồng mỗi video, tuy mức độ tin cậy thấp. Maitrinh0912 hiện chưa công khai thông tin liên hệ nhưng thuộc MCN UpBase Technology Joint Stock Company, có thể liên hệ qua đây hoặc tài khoản TikTok @maitrinh0912. — `ev_koc_7088624652566660098_cost`, `ev_koc_7088624652566660098_contact`, `ev_koc_7088624652566660098_followers`

**Gợi ý hỏi tiếp:**

- Tương tác 0,45% thấp có ảnh hưởng gì đến khả năng bán hàng?
- So sánh KOC này với Phương Sena và Mần đẹp như thế nào?
- Livestream chiếm 99% doanh thu — KOC này có chạy quảng cáo video không?

### 14. ✅ `thread-2-cost` — Hỏi nối tiếp

**Câu hỏi:** Thế còn chi phí hợp tác thì sao? _(hỏi nối tiếp trong cuộc `t-follow`)_

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** Chi phí ước tính thấp nhưng độ tin cậy không cao.

**Bố cục model tự dựng:** para → closing

**Các ý + bằng chứng được trích:**

- Chi phí ước tính để hợp tác là 9,6 – 24 triệu đồng mỗi video, tính theo bậc follower nhân với hệ số 1,2 do MCN. Tuy nhiên, con số này có độ tin cậy thấp, nên bạn nên kiểm chứng trực tiếp qua MCN UpBase Technology Joint Stock Company hoặc kênh TikTok của KOC để có mức giá chính xác. — `ev_koc_7088624652566660098_cost`

**Gợi ý hỏi tiếp:**

- Sản phẩm nào KOC này bán chạy nhất?
- So sánh tương tác của KOC này với những KOC cùng tầm?
- Doanh thu livestream so với video của KOC này thế nào?

### 15. ✅ `thread-3-contact` — Hỏi nối tiếp

**Câu hỏi:** Vậy liên hệ với họ bằng cách nào? _(hỏi nối tiếp trong cuộc `t-follow`)_

**Kế hoạch AI lập:** 1. Đọc hồ sơ KOC · 2. Tổng hợp câu trả lời

**Kết quả từng bước:** Hồ sơ: handle TikTok, MCN, kênh liên hệ công khai, follower, khán giả · Tổng hợp từ bằng chứng · 1 ý có nguồn

**Dẫn chứng kèm theo:** (không có)

**Trả lời (tóm tắt nội bộ):** Liên hệ thông qua MCN hoặc kênh TikTok của KOC.

**Bố cục model tự dựng:** para

**Các ý + bằng chứng được trích:**

- KOC chưa công bố liên hệ trực tiếp trên hồ sơ. Bạn có thể tiếp cận qua kênh TikTok @maitrinh0912 hoặc liên hệ thông qua MCN UpBase Technology Joint Stock Company — đây là cách chính để đàm phán hợp tác. — `ev_koc_7088624652566660098_contact`, `ev_koc_7088624652566660098_followers`

**Gợi ý hỏi tiếp:**

- Thương hiệu nào đã hợp tác thành công với KOC này?
- Doanh thu từ livestream vs video khác nhau như thế nào?
