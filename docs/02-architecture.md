# DETOLA KOC AI Agent — Mô hình MVP

> Cập nhật 2026-11-01. ✅ = đã chạy được · ⬜ = thuộc MVP, chưa làm · 🔜 = sau MVP.

## 1. MVP giải quyết bài toán gì

Người bán (brand mỹ phẩm) nhập yêu cầu chiến dịch → hệ thống đề xuất **N KOC TikTok Việt Nam phù hợp**, mỗi KOC có **điểm, lý do và bằng chứng cụ thể** (số liệu, sản phẩm đã bán, video + thời điểm), với **chi phí AI thấp** và **chạy tiếp được khi bị gián đoạn**.

**Tiêu chí MVP hoàn thành** (khớp yêu cầu ở [00-problem-statement.md](00-problem-statement.md)):

| Hạng mục | Mức MVP |
|---|---|
| Chất lượng | Demo 1 chiến dịch (kem chống nắng, nữ 18–30, 30 triệu, 5 KOC) ra 5 KOC có lý do + bằng chứng kiểm chứng được, có phân tích video bằng AI |
| Token efficiency | Lọc bằng code trước; AI chỉ chạy trên danh sách rút gọn; cache mọi kết quả AI; báo cáo token/chi phí từng bước |
| Scalability | Pool 50–500 KOC đầy đủ thông tin (hiện 1.027 KOC, crawl bù dần) |
| Reliability | Checkpoint từng KOC/từng bước; kill giữa chừng → resume không gọi lại phần đã xong |

## 2. Phạm vi

| Trong MVP | Ngoài MVP (🔜) |
|---|---|
| 1 nền tảng: TikTok · 1 quốc gia: Việt Nam | Shopee, Instagram, đa quốc gia |
| Danh mục mỹ phẩm (chăm sóc da, trang điểm, chống nắng) | Mọi ngành hàng |
| Nguồn dữ liệu: Kalodata web (tài khoản Premium) | Kalodata Open API (đã khoá — tốn credit), nguồn khác |
| Chạy local + MongoDB trên server | Deploy, worker riêng, đa người dùng, đăng nhập |
| Claude qua Claude CLI | Anthropic SDK (cùng interface khi deploy) |
| Chi phí KOC = **ước tính** | Bảng giá thật từ KOC/agency |
| Audience = nhóm đa số Kalodata cung cấp | Phân bố tuổi/giới chi tiết |

## 3. Luồng vận hành

```
 NGƯỜI BÁN (Next.js)
 ┌─────────────────────────────────────────────┐
 │ ✅ "+ Chiến dịch mới"                        │
 │   • Mô tả bằng lời (prompt)                 │
 │   • HOẶC Bộ lọc nâng cao (danh mục, ngân    │
 │     sách, follower, số KOC)                 │
 └───────────────┬─────────────────────────────┘
                 ▼
 ┌─────────────────────────────────────────────┐
 │ ✅ S1 — PHÂN TÍCH BRIEF (Claude Haiku)       │
 │   prompt → tiêu chí JSON, chỉ trích xuất    │
 │   điều người dùng viết; code kiểm tra lại   │
 │   cache theo nội dung → lặp lại = 0 token   │
 └───────────────┬─────────────────────────────┘
                 ▼
 ┌─────────────────────────────────────────────┐
 │ ✅ "AI ĐÃ HIỂU CHIẾN DỊCH" — người bán duyệt │
 │   tiêu chí + nguồn (AI / Bộ lọc / Mặc định) │
 │   gợi ý AI · cảnh báo mâu thuẫn ngân sách   │
 │   [Sửa bộ lọc]   [Xác nhận & tìm kiếm]      │
 └───────────────┬─────────────────────────────┘
                 ▼  campaign lưu MongoDB
 ┌─────────────────────────────────────────────┐
 │ ✅ S2 — LỌC CỨNG + CHẤM ĐIỂM (0 token)        │
 │   lọc: danh mục, follower, khán giả, MCN,   │
 │        chi phí ước tính ≤ ngân sách/KOC     │
 │   điểm: doanh thu ngành · ổn định theo ngày │
 │        · tương tác · mức chuyên sản phẩm    │
 │        · khớp khán giả · hiệu quả chi phí   │
 │   mỗi số liệu → 1 evidence (evidence_id)    │
 │   ~1.000 KOC → top ~30                      │
 └───────────────┬─────────────────────────────┘
                 ▼
 ┌─────────────────────────────────────────────┐
 │ ✅ S3 — SÀNG LỌC NỘI DUNG (Claude Haiku)     │
 │   bio + tiêu đề video + tên sản phẩm,       │
 │   gộp 10–20 KOC / 1 lần gọi                 │
 │   độ hợp thương hiệu · rủi ro (bán đối thủ) │
 │   top ~30 → ~10–15                          │
 └───────────────┬─────────────────────────────┘
                 ▼
 ┌─────────────────────────────────────────────┐
 │ ✅ S4 — PHÂN TÍCH VIDEO (Claude Sonnet vision)│
 │   2–3 video / KOC rút gọn → ảnh bìa +       │
 │   keyframes (+ lời thoại)                   │
 │   demo sản phẩm? chất lượng? người xuất hiện│
 │   bằng chứng kèm mốc thời gian · cache      │
 └───────────────┬─────────────────────────────┘
                 ▼
 ┌─────────────────────────────────────────────┐
 │ ✅ S5 — XẾP HẠNG & LÝ DO                     │
 │   điểm tổng = định lượng + nội dung + video │
 │   chọn N KOC (đa dạng, vừa ngân sách)       │
 │   AI viết lý do CHỈ dẫn evidence_id có thật │
 │   validator loại lý do không có bằng chứng  │
 │   phân bổ ngân sách gợi ý từng KOC          │
 └───────────────┬─────────────────────────────┘
                 ▼
 ┌─────────────────────────────────────────────┐
 │ ⬜ TRANG KẾT QUẢ CHIẾN DỊCH                   │
 │   N KOC · điểm thành phần · lý do + bằng    │
 │   chứng (click → số liệu / video / thời     │
 │   điểm) · token, chi phí, thời gian         │
 └─────────────────────────────────────────────┘
```

### Luồng dữ liệu nền (độc lập với chiến dịch)

```
 Kalodata WEB (phiên đăng nhập, Premium)                          ✅
   npm run crawl:web --fill-missing  (KHÔNG dùng API key — đã khoá)
   • 8 s/request · ≤250/giờ · ≤1.000/ngày · tự nghỉ, tự chạy tiếp
   • gặp cảnh báo khoá tài khoản → DỪNG HẲN, không retry
   • chỉ bù dữ liệu cho top_kocs/top1000, không thêm KOC mới
        │ mỗi KOC: chi tiết + audience · doanh thu tổng & theo ngày
        │          · 50 sản phẩm · 30 video
        ▼
 ┌──────────────── MongoDB 8 (server 66.42.50.32) ────────────────┐
 │ creators · creator_metrics · products · creator_products ·     │
 │ videos · raw_responses (gốc, giữ vĩnh viễn = bằng chứng) ·     │
 │ stage_items (checkpoint) · campaigns · llm_cache · api_calls · │
 │ avatars · video_media · top_kocs                               │
 └─────────────────────────────────────────────────────────────────┘
   ▲ SSH tunnel tự nối lại: scripts/db-tunnel.ps1 (local 27117)  ✅

 Media hiển thị (0 credit, không dùng tài khoản)                  ✅
   avatar · ảnh sản phẩm · ảnh bìa video: CDN img.kalocdn.com
   phát video: tikwm → MP4 stream qua /api/video/[id]/play (cache 3h)
```

## 4. Thành phần

| Thành phần | Vị trí | Trạng thái |
|---|---|---|
| UI: Nhà sáng tạo (bảng xếp hạng, lọc), Chi tiết KOC, Chiến dịch | `src/app/kocs`, `src/app/campaigns` | ✅ |
| Modal "Chiến dịch mới" 2 bước (brief → xác nhận) | `src/components/deep-search-button.tsx`, `src/app/actions/campaign.ts` | ✅ |
| Brief parser (S1) | `src/lib/brief-parser.ts`, `src/lib/brief.ts` | ✅ |
| LLM gateway: Claude CLI, cache, đo token/chi phí | `src/lib/llm/claude.ts` | ✅ |
| Crawler web Kalodata + checkpoint + nhịp an toàn | `scripts/crawl-web.ts`, `src/lib/kalodata/web-client.ts`, `src/lib/crawl/checkpoint.ts` | ✅ |
| Chọn & giữ top 1.000 KOC | `scripts/top-kocs.ts` | ✅ |
| Media: video proxy, ảnh CDN | `src/app/api/video`, `src/app/api/avatar`, `src/lib/tiktok-media.ts` | ✅ |
| Chấm điểm định lượng + evidence (S2) | `src/lib/scoring/rules.ts`, `src/lib/scoring/run.ts` → `campaign_scores`, `evidence` | ✅ |
| Sàng lọc nội dung (S3) — cache theo KOC + content_hash + model_id + prompt_version | `src/lib/pipeline/s3-content.ts`, `src/lib/ai/assessments.ts` → `ai_assessments` | ✅ |
| Phân tích video (S4) — 1 ảnh 4 khung/video, cache theo video + nội dung + model + prompt | `src/lib/pipeline/s4-video.ts`, `src/lib/media/frames.ts`, `/api/frames/[id]` | ✅ |
| Xếp hạng + lý do (S5) | `src/lib/pipeline/s5-recommend.ts`, `src/lib/evidence/validate.ts` | ✅ đo: $0,004 / chiến dịch 5 KOC, 0 lý do bị loại |
| Validator bằng chứng | `src/lib/evidence/validate.ts` | ⬜ |
| Trang kết quả + chi phí | `src/app/campaigns/[id]` | ⬜ |

## 5. Ước tính chi phí AI cho 1 chiến dịch (MVP)

| Bước | Model | Số lần gọi | Ước tính |
|---|---|---|---|
| S1 brief | Haiku | 1 (cache khi lặp) | ~$0.001 (đo thực tế: 2.3k in / 0.8k out) |
| S2 chấm điểm | — (code) | 0 | $0 |
| S3 nội dung | Haiku | ~2–3 (gộp 10–20 KOC/lần) | ~$0.01 |
| S4 video | Sonnet vision | 20 (10 KOC × 2 video) | **đo thực tế: $0.326** (≈$0.017/video, ~3.1k in / 0.45k out, 3.2 phút); chạy lại = $0 |
| S5 lý do | Haiku | 1 | **$0.004 (đo)** |
| **Tổng** | | | **≈ $0.35–0.65 / chiến dịch đầu tiên** — chiến dịch sau gặp lại KOC/video đã phân tích ≈ $0 (cache theo KOC + nội dung + model, xem §6) |

Con số thật được ghi trong `api_calls` và hiển thị ở trang kết quả (benchmark ở `05-benchmark.md`).

## 6. Quyết định chính

| Quyết định | Lý do |
|---|---|
| Funnel: code (0 token) → Haiku → Sonnet vision | Chi phí tỉ lệ với số KOC đi qua mỗi tầng; video chỉ chạy cho ~1–2% pool |
| Người bán duyệt tiêu chí trước khi tìm | Tránh tốn tiền chạy pipeline trên tiêu chí AI hiểu sai |
| Số liệu do code tính, AI chỉ dẫn `evidence_id` | Không bịa số; mọi lý do kiểm chứng được ([04-data-model.md §3.1](04-data-model.md)) |
| Checkpoint (run, KOC, bước) + cache theo nội dung | Resume chính xác; không trả tiền 2 lần cho cùng một việc |
| **Cache kết quả AI theo KOC + phiên bản nội dung + phiên bản model** | Khoá `(creator_id/video_id, content_hash, model_id, prompt_version)`. Đánh giá KOC/video không phụ thuộc chiến dịch → chiến dịch sau dùng lại, 0 token; nội dung KOC đổi, đổi model hoặc sửa prompt thì mới phân tích lại. Phần phụ thuộc chiến dịch (độ khớp, điểm tổng) tính bằng code |
| Kalodata web thay vì Open API | Có audience tuổi/giới; không tốn credit — đổi lại phải crawl chậm (đã từng bị khoá) |
| Pool cố định top 1.000 KOC, crawl bù dần | Đủ cho 50–500 KOC/chiến dịch; giữ lưu lượng an toàn cho tài khoản |
| MongoDB trên server | JSON lồng nhau từ Kalodata, không cần migration; dữ liệu tập trung |
| Claude CLI (local) | Không cần API key; khi deploy đổi sang Anthropic SDK cùng interface |

## 7. Rủi ro MVP

| Rủi ro | Giảm thiểu |
|---|---|
| Tài khoản Kalodata bị khoá lại | Nhịp chậm, giới hạn ngày, dừng hẳn khi có cảnh báo; dữ liệu đã crawl giữ nguyên |
| Pool chưa đủ chi tiết | Chấm điểm chỉ trên KOC đầy đủ; hiển thị số KOC sẵn sàng đánh giá |
| Chi phí KOC không có dữ liệu thật | Ghi rõ "ước tính" + confidence + căn cứ |
| tikwm / TikTok CDN không ổn định | Nhiều nguồn dự phòng, nút "Mở TikTok"; cache link 3h |
| Máy local tắt → crawler/tunnel dừng | Checkpoint + resume; script tunnel tự nối lại |


## Lưu tiến độ & chạy tiếp (✅ 2026-11-02)
- `runPipeline(id)` (`src/lib/pipeline/run.ts`) chạy S2→S5, bỏ qua bước đã có kết quả; trong bước dùng lại `ai_assessments` (S3 lưu theo lô, S4 theo video) và khung hình trên đĩa.
- Lease `pipeline.lease_until` (3 phút, gia hạn mỗi phút) chống chạy trùng; lỗi ghi `pipeline_error`.
- Tự chạy tiếp khi server khởi động (`src/instrumentation.ts`), nút "Tiếp tục xử lý" trên trang chiến dịch, hoặc `npm run resume`.
- Đo: chạy tiếp sau khi mất S4+S5 → 6,4s, $0 (toàn bộ từ cache).

## Ước tính giá booking — quyết định 2026-11-02
- **Giữ cách hiện tại**: khoảng giá theo bậc follower (× 1,2 nếu có MCN), nhãn "ước tính", độ tin cậy thấp (`estimateCost` trong `src/lib/scoring/rules.ts`).
- **Backlog (chưa làm):** giá = lượt xem đại diện / 1000 × CPM (khoảng thấp–cao). Điều kiện trước khi làm:
  1. lượt xem đại diện = trung vị video 30 ngày gần nhất (video trong DB hiện là video nổi bật → bị thổi phồng);
  2. hiệu chỉnh CPM từ 5–10 giá booking thật (chưa có nguồn công khai cho mỹ phẩm VN; CPM SEA $0,5–3 là CPM TikTok Ads, không dùng được);
  3. không dùng hệ số chất lượng do AI chấm cho giá (vi phạm §3.1); không cộng hệ số engagement (đã nằm trong view);
  4. tuỳ chọn "quyền dùng video chạy quảng cáo" trong brief → hệ số usage.
- Thử trên dữ liệu thật: view-based lệch mạnh so với follower-based (vd 1,4M follower nhưng ~43k view/video) → hướng đúng nhưng cần dữ liệu (1)(2).
