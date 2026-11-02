# Kalodata Open API — Integration Notes

Nguồn: https://www.kalodata.com/open-center/docs · Spec OpenAPI đầy đủ lưu tại [`kalodata/openapi.json`](kalodata/openapi.json)
(tải từ `https://www.kalodata.com/api/open-center/api-docs/public`).

## 1. Kết nối

| | |
|---|---|
| Base URL | `https://www.kalodata.com` |
| Auth | Header `X-API-Key: <key>` — tạo key tại Kalodata → Account |
| Method | Tất cả `POST` + JSON (trừ `GET /openapi/v1/credit/balance`) |
| Common params | `region: "VN"`, `language: "vi-VN"`, `currency: "VND"`, `date_range` |
| `date_range` | `lastDay`, `last7Day`, `last30Day`, … `last365Day`, `yyyy-MM-dd~yyyy-MM-dd`, `yyyy-MM`. Endpoint **rank giới hạn ≤ 30 ngày** |
| Rate limit | 100 req / 10s (comments, credit: 10 req / 10s) |
| Phân trang | `page_size` ≤ 100, `page_number` từ 1 |
| Response | `{ success, data, message, code, cached }` |

## 2. Chi phí (1 credit ≈ 0.1 USD)

| Loại | Giá |
|---|---|
| Detail API (creator/video/product/shop/category) | 0.1 credit / call |
| Rank API | 0.1 × ceil(rows/100) / call → lấy 100 dòng/lần là rẻ nhất |
| Video URL (signed, hết hạn 5 phút) | **0.5 credit** / call → chỉ dùng cho shortlist |
| Product comment insight | 1 credit (lần đầu / khi cập nhật) |
| Product images, product comments | 0.01 credit |
| Credit balance / logs | Miễn phí |

→ Chi phí Kalodata cũng phải được đo như chi phí LLM (bảng `api_calls`).

## 3. Endpoint dùng cho KOC Discovery

| Mục đích | Endpoint | Field chính |
|---|---|---|
| **Tìm ứng viên** | `POST /openapi/v1/tiktok/creator/rank` | filter: `category_id_list`, `keyword`, `followers_range`, `engagement_rate` (LOW <8% / MEDIUM 8–20% / HIGH >20%), `creator_type`, `revenue_range`, `product_id`, `shop_id`. Trả: `creator_id`, `creator_handle`, `creator_nickname`, `creator_followers`, `revenue`, `revenue_growth_rate`, `content_views`, `sales_volumn`, `video_revenue`, `live_revenue`, `category_list`, `ter_category_list` |
| **Chi tiết KOC** | `POST /openapi/v1/tiktok/creator/detail` | `creator_bio`, `creator_status`, contact (email/zalo/ins…), `revenue`, `sales_volumn`, `unit_price`, `video_views`, `video_gpm`, `live_gpm`, `new_followers`, `video_number`, `live_number`, `shop_number`, `product_number`, `revenue_trend`, `top3_product_ids`. Có thể lọc `category_ids` → doanh thu riêng mảng skincare |
| **Sản phẩm KOC bán** | `POST /openapi/v1/tiktok/product/rank` + `creator_id` | `product_name`, `revenue`, `sales_volumn`, `unit_price`, `commission_rate`, `video_revenue`, `live_revenue`, category 3 cấp, `seller_name` |
| **Video của KOC** | `POST /openapi/v1/tiktok/video/rank` + `creator_id` | `video_title`, `views`, `revenue`, `digg_count`, `share_count`, `comment_count`, `ads_roas`, `ad`, `ai_video`, `publish_date` |
| **Chi tiết video** | `POST /openapi/v1/tiktok/video/detail` | thêm `video_gpm`, `ad_cpa`, `ads_views`, `duration`, `revenue_trend` |
| **File video (cho AI)** | `POST /openapi/v1/tiktok/video/url` | signed URL 5 phút → tải ngay, cache local |
| **Category** | `POST /openapi/v1/tiktok/category/rank` | tìm `category_id` của Beauty / Skincare / Sunscreen (`category_level` 1–3) |
| Đối thủ / benchmark | `product/rank` (keyword "kem chống nắng"), `product/comment/insight` | biết KOC nào đang bán sản phẩm chống nắng nào |

## 4. Mapping yêu cầu → dữ liệu

| Yêu cầu | Lấy từ đâu |
|---|---|
| Doanh thu KOC | `creator/detail.revenue`, `video_revenue`, `live_revenue`, `revenue_trend` |
| Thống kê sản phẩm | `product/rank?creator_id=` (doanh thu, số lượng, giá, hoa hồng từng sản phẩm) |
| Hiệu suất nội dung | `video/rank?creator_id=` (views, engagement, GPM, ROAS) |
| **Chi phí hợp tác** | ⚠ Kalodata **không có rate card**. Ước tính = `commission_rate` sản phẩm cùng ngành + `ad_cpa`/ROAS + bậc follower (công thức ước tính ở Step 4) |
| **Độ tuổi / giới tính khách hàng** | ✅ Có qua **web Kalodata** (`followerSex`, `followerAgeMax` + filter) — xem [07-kalodata-web.md](07-kalodata-web.md). Open API TikTok **không trả demographics** (chỉ có ở API Shopee creator). → **Suy luận bằng AI**: (1) loại sản phẩm & mức giá KOC bán, (2) người xuất hiện + phong cách trong video (vision), (3) bio/caption, (4) comment sản phẩm. Ghi rõ là "ước tính" + độ tin cậy trong báo cáo |

## 5. Ước tính credit cho 1 campaign

| Bước | Calls | Credit |
|---|---|---|
| Category lookup | 1–2 | 0.2 |
| Creator rank 500 KOC (5 trang × 100) | 5 | 0.5 |
| Creator detail top 60 | 60 | 6 |
| Product rank + video rank top 60 | 120 | 12 |
| Video URL 3 video × 15 KOC | 45 | 22.5 |
| **Tổng** | | **~41 credit ≈ 4 USD** |

→ Video URL chiếm >50% chi phí Kalodata → chỉ tải video ở stage cuối, và cache file.

## 6. Việc cần làm

- [ ] Tạo API key ở Account, điền `KALODATA_API_KEY` trong `.env.local`.
- [ ] Gọi thử `credit/balance` (free) để xác thực key.
- [ ] Gọi thử `need_extra: true` ở `creator/detail` để xem có thêm field (có thể có demographics).
- [ ] Lưu response mẫu vào `fixtures/kalodata/`.
