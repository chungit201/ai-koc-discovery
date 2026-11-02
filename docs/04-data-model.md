# Data Model — dữ liệu crawl, lưu DB và dùng làm bằng chứng

Mục tiêu: **mọi kết luận trong báo cáo đề xuất phải trỏ được về một bản ghi dữ liệu cụ thể** (số liệu Kalodata, video, khung hình, comment) — không có "AI nói vậy" mà không có nguồn.

```
Kalodata (raw) ──► raw_responses ──► bảng chuẩn hoá (creators, products, videos…)
                                            │
                                 AI phân tích (video_analyses, creator_assessments)
                                            │
                                     evidence  ◄── mỗi claim 1 dòng, có source_ref
                                            │
                                 recommendations (lý do + danh sách evidence_id)
```

## 1. Dữ liệu cần crawl (theo thứ tự funnel)

| # | Dữ liệu | Endpoint | Phạm vi | Dùng làm bằng chứng cho |
|---|---|---|---|---|
| 1 | Category Beauty/Skincare/Sunscreen | `category/rank` | 1 lần, cache dài | Lọc đúng ngành |
| 2 | Danh sách KOC | `creator/rank` (category + keyword, 30 ngày) | 100–500 KOC | Quy mô, tăng trưởng doanh thu, top category |
| 3 | Chi tiết KOC (toàn bộ + **lọc riêng category skincare**) | `creator/detail` ×2 | Top ~60 | Doanh thu ngành, GPM, tần suất đăng, % doanh thu video vs live |
| 4 | Sản phẩm KOC bán | `product/rank?creator_id` | Top ~60, 20–50 SP/KOC | Đã bán kem chống nắng chưa, mức giá, hoa hồng, brand từng hợp tác, có bán đối thủ không |
| 5 | Video của KOC | `video/rank?creator_id` | Top ~60, 20–30 video | Engagement thật, views ổn định, tỉ lệ video quảng cáo, ROAS |
| 6 | Chi tiết video chọn lọc | `video/detail` | 2–3 video × ~15 KOC | GPM, CPA, thời lượng |
| 7 | File video → keyframes + transcript | `video/url` + ffmpeg + STT | 2–3 video × ~15 KOC | Phân tích nội dung, hình ảnh, người xuất hiện → suy luận đối tượng khán giả |
| 8 | Comment / insight sản phẩm KOC bán | `product/comments`, `comment/insight` | Top SP của shortlist | Chân dung người mua (độ tuổi/giới tính ước tính), phản hồi chất lượng |
| 9 | Trend doanh thu | có sẵn trong 3, 6 | | Độ ổn định, không phải "ăn may" 1 video |

## 2. Schema DB (MongoDB — mỗi "bảng" dưới đây là một collection)

Quy ước MongoDB: dùng id gốc của Kalodata làm `_id` (`creator_id`, `product_id`, `video_id`) → upsert idempotent; cột `*_json` lưu thẳng thành sub-document/array; khoá unique ghi chú dưới đây được tạo bằng index trong `scripts/db-init.ts`.

### 2.1 Raw & tracking
| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `raw_responses` | `id`, `endpoint`, `request_hash` (unique), `request_json`, `response_json`, `credit_cost`, `fetched_at` | Lưu nguyên bản → audit, replay, cache. Không gọi lại nếu `request_hash` đã có và còn hạn |
| `api_calls` | `id`, `run_id`, `provider` (kalodata/claude), `endpoint/model`, `tokens_in`, `tokens_out`, `cost_usd`, `credit`, `latency_ms`, `cache_hit`, `status`, `created_at` | Benchmark chi phí & thời gian |

### 2.2 Dữ liệu chuẩn hoá
| Bảng | Cột chính |
|---|---|
| `creators` | `creator_id` PK, `handle`, `nickname`, `region`, `status` (INDEPENDENT/SELLER), `bio`, `followers`, contact (`email`, `zalo`, `ins`…), `updated_at` |
| `creator_metrics` | `creator_id`, `date_range`, `category_scope` (all/skincare), `revenue`, `sales_volume`, `unit_price`, `video_revenue`, `live_revenue`, `video_views`, `video_gpm`, `live_gpm`, `new_followers`, `video_number`, `live_number`, `shop_number`, `product_number`, `revenue_trend` (json), `raw_response_id` |
| `products` | `product_id` PK, `name`, `seller_id`, `seller_name`, `unit_price`, `commission_rate`, `category_l1/l2/l3`, `launch_date` |
| `creator_products` | `creator_id`, `product_id`, `date_range`, `revenue`, `sales_volume`, `video_revenue`, `live_revenue`, `raw_response_id` |
| `videos` | `video_id` PK, `creator_id`, `title`, `publish_date`, `duration`, `views`, `likes`, `comments`, `shares`, `revenue`, `gpm`, `ads_roas`, `ad_cpa`, `is_ad`, `is_ai_video`, `product_ids` (json), `raw_response_id` |
| `video_assets` | `video_id`, `local_path`, `keyframes` (json: [{t, path}]), `transcript` (json: [{t_start, t_end, text}]), `sha256` |
| `product_comments` | `product_id`, `comment_id`, `text`, `rating`, `created_at` |

### 2.3 Kết quả AI
| Bảng | Cột chính |
|---|---|
| `video_analyses` | `video_id`, `model`, `prompt_version`, `input_hash` (unique → cache), `result_json` (hook, demo sản phẩm, chất lượng hình/âm, độ tin cậy, tone, người xuất hiện ước tính tuổi/giới, brand safety), `api_call_id` |
| `creator_assessments` | `run_id`, `creator_id`, `stage` (text_screen/video/final), `scores_json`, `audience_estimate_json` ({female_pct, age_band, confidence, basis[]}), `cost_estimate_json` ({min, max, method}), `api_call_id` |

### 2.4 Bằng chứng & đề xuất
| Bảng | Cột chính |
|---|---|
| `evidence` | `id`, `run_id`, `creator_id`, `type` (metric / product / video_moment / comment / bio), `claim` (câu kết luận ngắn), `value` (số/chuỗi), `source_table`, `source_id`, `timestamp_sec` (cho video), `url`, `strength` (strong/medium/weak) |
| `recommendations` | `run_id`, `creator_id`, `rank`, `final_score`, `score_breakdown_json`, `reasons_json` ([{text, evidence_ids[]}]), `risks_json`, `suggested_budget_vnd` |

### 2.5 Pipeline / resume
| Bảng | Cột chính |
|---|---|
| `campaigns` | `id`, `brief_json`, `criteria_json` (parsed), `created_at` |
| `pipeline_runs` | `id`, `campaign_id`, `status`, `current_stage`, `started_at`, `finished_at` |
| `stage_items` | `run_id`, `stage`, `item_id`, `status` (pending/running/done/failed), `attempts`, `error`, `input_hash`, `updated_at` · unique(`run_id`,`stage`,`item_id`) |

## 3. Bằng chứng được sinh ra thế nào

| Loại | Sinh bởi | Ví dụ claim | source |
|---|---|---|---|
| `metric` | Code (0 token) | "Doanh thu skincare 30 ngày: 412 triệu VNĐ, GPM 38k" | `creator_metrics#id` |
| `product` | Code | "Đã bán 3 sản phẩm chống nắng, 2.140 đơn" | `creator_products` |
| `metric` | Code | "Engagement trung vị 20 video: 9,4% (cao hơn 72% KOC cùng nhóm)" | `videos` (tính toán) |
| `video_moment` | Vision LLM | "Thoa thử kem lên da, quay cận texture ở 00:12" | `video_analyses` + `timestamp_sec` + keyframe |
| `comment` | LLM text | "Người mua nhắc 'da dầu', 'đi học' → khán giả trẻ" | `product_comments#id` |
| `bio` | LLM text | "Bio: 'review skincare cho da dầu mụn'" | `creators.bio` |

## 3.1 Nguyên tắc chống AI bịa (bắt buộc)

1. **Mọi con số do code tính, không để AI tự đưa ra số.**
   Doanh thu, engagement, GPM, số đơn, phần trăm, xếp hạng… đều được tính từ DB và lưu thành `evidence`. Prompt không yêu cầu LLM tính hay ước lượng số liệu hiệu suất.
2. **Khi viết lý do đề xuất, AI chỉ được dẫn mã bằng chứng đã có sẵn.**
   LLM nhận danh sách `evidence` có id, trả về `reasons[{text, evidence_ids}]`. Hệ thống kiểm tra từng mã: id không tồn tại hoặc không thuộc KOC đó → **loại lý do**. Lý do không có bằng chứng nào → **loại**. Câu chứa con số không khớp với evidence được dẫn → **loại**.
3. **Độ tuổi, giới tính và chi phí luôn ghi rõ là "ước tính"**, kèm `confidence` (low/medium/high) và `basis` (các `evidence_id` làm căn cứ). UI và báo cáo hiển thị nhãn "Ước tính" cho các trường này.

Kiểm tra tự động: validator ở `src/lib/evidence/validate.ts` (Step 7) + unit test cho cả 3 nguyên tắc.

## 4. Ví dụ output 1 KOC trong báo cáo

```json
{
  "rank": 1,
  "creator": "@abc.skincare",
  "final_score": 0.86,
  "score_breakdown": { "performance": 0.82, "content_fit": 0.91, "video_quality": 0.88, "audience_fit": 0.80, "cost_efficiency": 0.85 },
  "audience_estimate": { "female_pct": "75–85%", "age_band": "18–27", "confidence": "medium", "basis": ["ev_12", "ev_19", "ev_23"] },
  "cost_estimate_vnd": { "min": 4000000, "max": 7000000, "method": "tier follower + commission skincare 15%" },
  "reasons": [
    { "text": "Chuyên review skincare, 80% doanh thu 30 ngày đến từ ngành làm đẹp", "evidence_ids": ["ev_03", "ev_04"] },
    { "text": "Đã bán kem chống nắng với tỉ lệ chuyển đổi cao", "evidence_ids": ["ev_07"] },
    { "text": "Video demo texture rõ ràng, thoa thử trên da thật", "evidence_ids": ["ev_15"] }
  ],
  "risks": [{ "text": "Đang bán sản phẩm chống nắng của đối thủ X", "evidence_ids": ["ev_09"] }]
}
```

## 5. Chính sách cache / làm mới

| Dữ liệu | TTL |
|---|---|
| Category | 30 ngày |
| Creator rank / detail / product / video metrics | 1 ngày (dữ liệu Kalodata cập nhật hằng ngày) |
| File video, keyframes, transcript | Vĩnh viễn (theo `video_id`) |
| `video_analyses` | Vĩnh viễn theo `input_hash` (= video + model + prompt_version) |
| Comment insight | 14 ngày (Kalodata cập nhật ~2 tuần) |
