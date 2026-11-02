# Implementation Plan

> **Mô hình MVP hiện hành:** [02-architecture.md](02-architecture.md) — luồng S1 → S5, phạm vi, chi phí, trạng thái từng thành phần.
> Trạng thái 2026-11-01: ✅ hạ tầng · crawl web (1.027 KOC, 140 đầy đủ, đang bù dần) · UI KOC · "Chiến dịch mới" + S1 phân tích brief + bước xác nhận. ✅ S2 chấm điểm định lượng + evidence (`s2-v3`, 0 token, ~5s, tự chạy khi xác nhận chiến dịch). ✅ S3 sàng lọc nội dung (Haiku, `s3-v1`): 10 KOC/lần gọi, chạy nền sau S2; đo thực tế 15 KOC = 2 lần gọi, ~$0,009, ~37s; chạy lại = 0 token (cache `ai_assessments`). Điểm sau S3 = 75% S2 + 25% mức độ review/demo − 3/rủi ro. ✅ S4 phân tích video (Sonnet vision `claude-sonnet-5-5`, `s4-v1`): top 10 KOC sau S3 × 2 video (1 đúng chủ đề nhiều view + 1 doanh thu cao); mỗi video gửi 1 ảnh 4 khung (10/35/60/85% thời lượng, 1080×480 ~43KB) + tiêu đề. Đo thực tế 20 video: **$0,326**, 60k in / 8,4k out, 3,2 phút (chủ yếu tải MP4); chạy lại 0 token. Điểm sau S4 = 60% điểm S3 + 40% điểm video (KOC không có video đúng sản phẩm ×0,6). ✅ S5 đề xuất (2026-11-02, `s5-v1`, `src/lib/pipeline/s5-recommend.ts`): code chọn N KOC theo hạng cuối, tổng chi phí min ≤ ngân sách, tối đa 2 KOC/MCN; code chia ngân sách (bắt đầu ở mid, co về min nếu vượt, dư thì cộng theo điểm tới max, làm tròn 100k, không vượt tổng); 1 lần gọi Haiku viết 2–3 lý do + 1 lưu ý/KOC, mỗi lý do trích `evidence_id`; `src/lib/evidence/validate.ts` loại lý do không có/sai bằng chứng hoặc có con số không nằm trong claim được trích. Đo thực tế (chiến dịch kem chống nắng, 5 KOC, 30M): **$0,004**, 22s, phân bổ 30M/30M, 0 lý do bị loại. Chạy tay: `npm run s5 -- <campaignId>`. Toàn bộ S2 → S5 chạy nền sau khi xác nhận; trang chiến dịch hiển thị dạng hội thoại AI agent (các bước → bảng phân bổ → thẻ KOC đề xuất + dự phòng). ⚡ Tăng tốc S4 (2026-11-02): chiến dịch "da dầu mụn" đo 80s cho 14 video mới (3 song song, tải nguyên MP4). Đổi sang: ffmpeg seek thẳng link MP4 (chỉ lấy 4 khung, đo ~3s/video thay vì tải cả file; lỗi thì quay về tải file), 6 video song song, tải trước khung hình ngay sau S2 (song song với S3, 0 chi phí AI), chống tải trùng. Chi phí AI không đổi. ✅ Lưu tiến độ & chạy tiếp (2026-11-02, `src/lib/pipeline/run.ts`): mỗi bước ghi kết quả vào campaign (`scoring`/`s3`/`s4`/`s5`) + `pipeline.stage`; trong bước, kết quả AI lưu theo lô (S3) / theo video (S4), khung hình lưu đĩa. Lease `pipeline.lease_until` (gia hạn mỗi phút, hết hạn 3 phút) chống 2 tiến trình chạy trùng. Server khởi động (`src/instrumentation.ts`) tự chạy tiếp chiến dịch dở; trang chiến dịch hiện "Tiếp tục xử lý" khi lỗi/gián đoạn; chạy tay `npm run resume [-- <id>]`. Test: xoá `s4`+`s5` của chiến dịch da dầu mụn → resume bỏ qua S2/S3, S4 16/16 video từ cache, S5 từ cache: 6,4s, **$0**. ✅ S5 v2 chọn & chia ngân sách (2026-11-02): (A) trần mỗi KOC = ngân sách tối đa/KOC trong brief, hoặc 1,5 × tổng ÷ N (bỏ trần nếu brief ưu tiên độ phủ); (B) mọi KOC bắt đầu ở giá min, phần dư chia theo điểm tới min(max, trần); (C) không chọn KOC điểm < 55 để lấp đủ số — báo "chỉ có k/N"; (D) S4 chỉ xem video của KOC có giá min ≤ trần. UI giải thích KOC điểm cao bị loại vì vượt trần. Đo lại chiến dịch da dầu mụn (20M/4): 4 KOC đều đã xem video, điểm TB 64,2 → 66,8, 3/4.1/6.1/6.8 tr. ✅ Benchmark (2026-11-02, `npm run bench`, [`05-benchmark.md`](05-benchmark.md)): chiến dịch mới "trang điểm, 6 KOC, 60 tr" — lần đầu $0,49 / 2,9 phút (23 call; S4 20 video mới 41 s), chạy lại từ cache $0 / 5,8 s; baseline LLM lớn ~$40 ⇒ rẻ hơn ~80×. ⬜ Tiếp theo: README + bàn giao (Step 10), crawl bù KOC chưa đủ thông tin, backup mongodump.
> S2 — lọc cứng: đủ dữ liệu chi tiết, follower, giới tính, MCN, chi phí ước tính ≤ tối đa/KOC, ≥3 video. Điểm: hiệu suất, khớp nội dung (tỉ lệ + doanh thu tuyệt đối SP đúng loại + video + mức chuyên), tương tác, hợp ngân sách, ổn định theo ngày, khớp khán giả; trọng số tăng "khớp nội dung" lên 35% khi brief nêu sản phẩm cụ thể. Mỗi số liệu → 1 evidence. Chi phí KOC = ước tính theo bậc follower (tin cậy thấp).

Triển khai theo từng step, mỗi step kết thúc bằng một kết quả chạy được + commit. Đánh dấu `[x]` khi xong.

## Nguyên tắc thiết kế (định hướng mọi step)

1. **Funnel rẻ → đắt**: lọc bằng dữ liệu số (0 token) trước, LLM text rẻ sau, phân tích video (đắt nhất) chỉ cho shortlist.
2. **Mỗi bước là một job idempotent có checkpoint** trong DB → crash ở đâu resume từ đó, không gọi lại AI đã trả kết quả.
3. **Cache mọi thứ theo content hash** (raw Kalodata, transcript, kết quả LLM) → chạy lại brief khác không tốn lại token cho cùng KOC/video.
4. **Bằng chứng có trích dẫn**: mỗi lý do đề xuất phải trỏ về số liệu/video/timestamp cụ thể.
5. **Chống AI bịa** — số liệu do code tính; lý do chỉ dẫn `evidence_id` có thật (validate, loại lý do không bằng chứng); tuổi/giới/chi phí luôn là "ước tính" + confidence + basis. Chi tiết: [`04-data-model.md#31`](04-data-model.md).
6. **Cache kết quả AI theo KOC + phiên bản nội dung + phiên bản model** — mọi phân tích AI về một KOC (sàng lọc nội dung S3, phân tích video S4, ...) được lưu với khoá `(creator_id | video_id, content_hash, model_id, prompt_version)`:
   - `content_hash`: hash của đúng dữ liệu đưa vào AI (bio, danh sách video/sản phẩm, keyframes…) → nội dung KOC đổi thì hash đổi, tự phân tích lại; không đổi thì dùng lại.
   - `model_id`: tên model đầy đủ (vd `claude-haiku-…`), `prompt_version`: số phiên bản prompt → đổi model hoặc sửa prompt thì tạo bản mới, bản cũ vẫn giữ để so sánh.
   - Kết quả **không phụ thuộc chiến dịch** (đánh giá KOC/video độc lập), phần phụ thuộc chiến dịch (độ khớp tiêu chí, điểm tổng) tính bằng code từ kết quả đã cache → chiến dịch sau dùng lại, **không phân tích lại, 0 token**.
   - Báo cáo chi phí tách rõ: số KOC/video lấy từ cache vs phân tích mới.
7. **Đo lường từ ngày đầu**: log token in/out, cost, latency cho từng call.

## Pipeline mục tiêu

```
Brief ─► [S1 Brief Parser] ─► [S2 Candidate Sourcing: Kalodata] ─► [S3 Hard Filter + Quant Score]  (0 token)
                                                                         │ top N (vd 500 → 60)
                                                                         ▼
                                    [S4 Text Screening: LLM nhỏ, batch nhiều KOC/1 call]   (rẻ)
                                                                         │ top M (vd 60 → 15)
                                                                         ▼
                 [S5 Video Analysis: chọn 2–3 video/KOC, keyframes + transcript → vision LLM]  (đắt)
                                                                         │
                                                                         ▼
                        [S6 Ranking & Report: tổng hợp điểm, lý do, bằng chứng, chọn top K=5]
```

## Steps

### Step 0 — Khởi tạo project ✅
- [x] `npx create-next-app` (TS, App Router, Tailwind, ESLint, `src/`)
- [x] Ghi tổng quan dự án vào `docs/00-problem-statement.md`, plan + kiến trúc vào `docs/`
- [ ] Tạo GitHub repo, push commit đầu _(làm sau)_

### ⚠ QUAN TRỌNG — chi tiêu credit phải được duyệt
Mọi thao tác **tốn credit Kalodata Open API** (tất cả `/openapi/v1/...` trừ `credit/balance`, `credit/logs` miễn phí) đều phải **hỏi và được người dùng đồng ý rõ ràng trước khi chạy**: nêu endpoint, số lần gọi, credit ước tính, số dư hiện tại. Script tốn credit: `npm run crawl`, `npm run avatars`, `npm run probe`.
**Quyết định 2026-11-01: KHÔNG dùng Open API / API key nữa.** Client bị khoá bằng `KALODATA_API_ENABLED=0`; mọi dữ liệu lấy qua web Kalodata (`crawl:web`, miễn phí trong gói Premium). Avatar: giữ 2.347 ảnh đã tải, KOC còn lại hiển thị chữ cái đầu.
Nhật ký chi tiêu: 2026-11-01 — Open API crawl ~10 credit (đã duyệt) · avatar 2,4 credit (**chưa hỏi trước — sai quy trình**, đã dừng). Số dư 137,29.

### Quyết định đã chốt
- **LLM:** gọi qua **Claude CLI** headless (`claude -p --output-format json --model <haiku|sonnet>`), bọc trong `src/lib/llm/` để đọc `usage`/`total_cost_usd` từ JSON output và ghi vào `llm_calls`. Không cần API key.
- **Chạy local trước**, deploy sau. Lưu ý: Claude CLI chỉ chạy trên máy có CLI đã đăng nhập → khi deploy cần worker riêng hoặc chuyển sang Anthropic SDK (giữ cùng interface).
- **Kalodata:** credentials trong `.env.local` (đã gitignore).
- **Database: MongoDB 8** trên server `66.42.50.32` (thay cho SQLite/Postgres). Dữ liệu Kalodata là JSON lồng nhau, schema còn thay đổi → document DB hợp hơn. Truy cập qua SSH tunnel. Chi tiết: [`06-server-setup.md`](06-server-setup.md).

### Step 1 — Kalodata Open API & data contract
- [x] Đọc docs Open API, lưu spec `docs/kalodata/openapi.json`, ghi chú `docs/03-kalodata.md` (endpoint, chi phí credit, rate limit).
- [x] Phát hiện: API TikTok **không có demographics follower** và **không có rate card** → AI suy luận độ tuổi/giới tính, chi phí ước tính từ commission/CPA.
- [ ] Tạo API key, viết client `src/lib/kalodata/` (auth, retry, rate limit 100/10s, đo credit, cache response).
- [ ] Script `scripts/kalodata-probe.ts`: gọi thử balance → category → creator rank → detail/product/video cho 3 KOC.
- [ ] Định nghĩa type `Creator`, `CreatorVideo`, `CreatorMetrics` (`src/lib/types.ts`) + Zod schema.
- [ ] Lưu 5–20 mẫu raw vào `fixtures/` để dev offline (không tốn quota).

### Step 2 — Database trên server (MongoDB) ✅ phần server
- [x] SSH key login vào server (không cần gõ password nữa).
- [x] Firewall UFW: chỉ mở SSH (22).
- [x] Cài MongoDB 8.0.34, bind `127.0.0.1`, bật authentication; user `admin` (root) + user app `detola` (readWrite DB `detola`).
- [x] Local truy cập qua SSH tunnel `npm run db:tunnel` (local `27117` → server `27017`); kiểm tra `npm run db:ping` → `ok=1`.
- [ ] `src/lib/db/`: client MongoDB singleton + typed collections (TypeScript + Zod) theo [`04-data-model.md`](04-data-model.md): raw_responses, api_calls, creators, creator_metrics, products, creator_products, videos, video_assets, product_comments, video_analyses, creator_assessments, evidence, recommendations, campaigns, pipeline_runs, stage_items.
- [ ] Script `scripts/db-init.ts`: tạo collections + indexes (unique `request_hash`, `(run_id, stage, item_id)`, `creator_id`, `video_id`, TTL index cho cache).
- [ ] Backup: `mongodump` hằng ngày bằng cron trên server.

### Step 2c — Crawl dữ liệu về MongoDB ✅
- [x] Kalodata Open API client `src/lib/kalodata/client.ts`: cache theo request hash (TTL), retry/backoff, xử lý "traffic control", đo credit vào `api_calls`.
- [x] Checkpoint từng item `src/lib/crawl/checkpoint.ts` (`stage_items`) → `--resume <runId>` chỉ làm lại phần chưa xong.
- [x] `npm run crawl` (Open API): creators → detail (all + skincare) → products → videos. Run 1: 200 ứng viên, top 30, ~10 credit.
- [x] Phát hiện web Kalodata có **giới tính/độ tuổi follower** + filter theo audience → crawler thứ 2 `npm run crawl:web` dùng session đăng nhập (miễn phí trong gói Premium). Chi tiết: [`07-kalodata-web.md`](07-kalodata-web.md).
- [x] Category VN: Beauty `601450` → Chăm sóc da `848776` → Kem chống nắng da mặt `601602`.
- [ ] Hoàn tất run Open API dở (videos bị throttle): `npm run crawl -- --resume 66d014f4-2c45-4481-b5d2-5ad00b383db7`.

### Step 2d — Crawl 500 KOC mỹ phẩm đầy đủ thông tin (chậm, an toàn)
Phạm vi chốt lại: **50–500 KOC đầy đủ thông tin**, không crawl toàn ngành (sau sự cố khoá tài khoản 2026-11-01).
- [x] Danh sách: top 2.000 KOC / nhóm tuổi (40 trang × 2 nhóm 18–24, 25–34), Chăm sóc da + Trang điểm, độc lập, follower đa số nữ.
- [x] Chọn top 500 theo điểm tổng hợp (doanh thu 50% · engagement 30% · lượt xem 20%) — code, không AI.
- [x] Mỗi KOC xử lý trọn gói 6 request (detail+audience → doanh thu + theo ngày → sản phẩm → video), KOC điểm cao làm trước.
- [x] Nhịp: 8 s/request, ≤ 250/giờ, ≤ 1.000/ngày; chạm giới hạn ngày thì tự chờ rồi chạy tiếp; gặp cảnh báo khoá → dừng hẳn.
- [ ] Chạy xong (~3.000 request ≈ 3 ngày) → `npm run db:audit`.

### Step 2b — Job runner, checkpoint

- [ ] Runner: mỗi stage xử lý theo batch, ghi status `pending/running/done/failed`, retry + backoff; resume bằng cách bỏ qua item `done`.
- [ ] Concurrency limit (p-limit) cho Kalodata và LLM.

### Step 3 — Brief Parser (S1)
- [ ] Form UI nhập brief (sản phẩm, target, ngân sách, số KOC).
- [ ] 1 LLM call (structured output) → `CampaignCriteria`: category, keywords, demographic, khoảng follower phù hợp ngân sách, trọng số chấm điểm.
- [ ] Cache theo hash brief.

### Step 4 — Sourcing + Quant Score (S2, S3) — 0 token
- [ ] Query Kalodata theo category/keyword (beauty, skincare, sunscreen…), lấy pool ứng viên.
- [ ] Hard filter: quốc gia VN, % nữ, độ tuổi audience, hoạt động gần đây, giá ước tính ≤ ngân sách/K.
- [ ] Quant score có trọng số: engagement rate, GMV/views, độ ổn định, tỉ lệ nội dung beauty, cost-efficiency (CPM ước tính). Chuẩn hoá percentile.
- [ ] Output: top N.

### Step 5 — Text Screening (S4) — LLM rẻ
- [ ] Nén dữ liệu: bio + 10–20 caption/hashtag gần nhất + metrics tóm tắt (~300 token/KOC).
- [ ] Batch 10–20 KOC / call, model nhỏ (Haiku), JSON output: brand-fit, rủi ro (đối thủ, nội dung nhạy cảm), giọng điệu.
- [ ] Prompt caching cho phần system/criteria dùng chung.

### Step 6 — Video Analysis (S5) — đắt nhất, chỉ shortlist
- [ ] Chọn 2–3 video đại diện/KOC (top performance + gần nhất + có gắn sản phẩm skincare).
- [ ] Tải video → ffmpeg trích 4–6 keyframes (scene change), downscale ~512px; transcript bằng Whisper/STT hoặc caption có sẵn.
- [ ] 1 vision call/video: chất lượng hình, cách review sản phẩm, độ tin cậy, phù hợp target, có demo texture/kết quả không… kèm timestamp làm bằng chứng.
- [ ] Cache theo `video_id`.

### Step 7 — Ranking & Report (S6)
- [ ] Final score = w1·quant + w2·text + w3·video; đa dạng hoá (tránh 5 KOC giống hệt nhau).
- [ ] 1 LLM call viết lý do đề xuất cho top K, mỗi lý do có link bằng chứng (metric, video URL, timestamp).
- [ ] Phân bổ ngân sách gợi ý cho 5 KOC.

### Step 8 — UI Dashboard
- [ ] Trang campaign: tiến độ từng stage realtime (polling/SSE), nút **Resume**.
- [ ] Trang kết quả: card KOC, điểm thành phần, bằng chứng, keyframes.
- [ ] Trang usage: tokens, cost, thời gian theo stage.

### Step 9 — Reliability test & Benchmark
- [x] Kill process giữa chừng → resume → không gọi lại call đã xong (test 2026-11-02: 16/16 video từ cache, $0).
- [x] Chạy demo chiến dịch mới (trang điểm, 6 KOC, 60 tr) → [`05-benchmark.md`](05-benchmark.md): lần đầu **$0,49 / 2,9 phút** (S4 20 video mới chỉ 41 s sau tối ưu ffmpeg), chạy lại từ cache **$0 / 5,8 s**; ước tính cost cho 50/500 KOC.
- [x] So sánh baseline "đưa mọi thứ cho LLM lớn": ước tính ~$40/chiến dịch ⇒ tiết kiệm ~80×.
- [x] 3 lỗi phát hiện khi benchmark đã sửa: timeout CLI 90 s → 240 s + retry; gán sai tên model từ `modelUsage` (lệch cache); phân bổ ngân sách thấp hơn sàn `budget_min_per_koc`. Chi tiết: [`05-benchmark.md#6`](05-benchmark.md).

### ⚠ QUAN TRỌNG — đang dở: hỏi đáp AI ở trang hồ sơ KOC
**Đọc [`09-handover.md`](09-handover.md) trước khi sửa code phần này.** Tóm tắt:
- Tính năng đã chạy được (kế hoạch động → từng bước → bài trả lời do model tự dựng bố cục, mọi con số truy được về `evidence_id`), chất lượng đạt ~70–75% so với Kalopilot khi đối chiếu trên @phuongsena.
- **Bộ test `npm run test:koc` CHƯA xanh**: nhóm `metrics-*` còn hỏng vì model trích bằng chứng không đúng trọng tâm. Hướng sửa: prompt trả lời nên được code gợi sẵn id bằng chứng liên quan tới câu hỏi.
- **Cache câu trả lời đang TẮT** (`KOC_ANSWER_CACHE`), bật lại sau khi test xanh.
- Còn thiếu so với Kalopilot: so hiệu quả live với nhóm đối chuẩn, khoảng giá sản phẩm, số shop hợp tác, xuất báo cáo `.md`.

### Step 10b — Chat nhiều lượt trên một chiến dịch
Nối tiếp "kế hoạch động" (2026-11-02): mỗi lượt chat là **một kế hoạch nhỏ** chạy trên chiến dịch đang có.
Nhờ cache theo KOC/video, lượt tiếp theo gần như $0 (đổi ngân sách ≈ $0,07 vì S3/S4 toàn cache).
Quyết định: **ghi đè kết quả, giữ 1 bản mới nhất**; **chạy thẳng không hỏi xác nhận chi phí**.
- [x] Evidence id: **đo ra là đã ổn định sẵn** (`ev_<campaign>_<creator>_<key>`; test chạy S2 hai lần → 734/734 id giữ nguyên, claim không đổi). Lỗi thật nằm chỗ khác: S2 chạy lại thay mới `campaign_scores` nên **mất phần làm giàu của S3/S4**, trong khi `campaign.s3/s4` vẫn còn → pipeline bỏ qua và xếp hạng âm thầm tụt về chỉ-S2. Đã sửa: `scoreCampaign` xoá luôn summary `s3/s4/s5` để dựng lại từ cache (0 token).
- [x] Lượt mới gửi khi lượt trước đang chạy → trả lời "đang chạy yêu cầu trước", không nuốt tin nhắn.
- [x] `campaigns.messages[]` + `excluded_creator_ids[]` + `deep_creator_ids[]`; action `sendMessage`; `components/composer.tsx`; trang chiến dịch render hội thoại nhiều lượt.
- [x] `src/lib/chat.ts`: phân loại intent trong danh sách đóng; bản đồ `RERUN_FROM` (đổi gì → chạy lại từ đâu) nằm trong code, AI chỉ phân loại và đề xuất giá trị, mọi giá trị đi qua `sanitizeExtracted`.
- [x] `src/lib/chat-rules.ts` — **luật khoá cứng**: `DEEPEN_MAX_KOCS = 1` (không bao giờ xem video cả danh sách; mời người dùng chỉ 1 KOC), `EXCLUDE_MAX_KOCS = 3`, nhận diện yêu cầu hàng loạt bằng code. Lưu ý: `\b` của JS chỉ tính ASCII nên không dùng được với tiếng Việt có dấu.
- [x] `explain`: 1 call Haiku trả lời **chỉ từ evidence đã có**, qua `validateReasons`. Đo thực tế: ~25s, ~$0,05/lượt (hơi đắt vì gửi bằng chứng của 12 KOC — có thể thu hẹp sau).
- [x] Đo thực tế lượt "tăng ngân sách lên 80 triệu": phân loại $0,010 → chạy lại S2→S5 149s, S4 14 video mới $0,030, S5 $0,117.
- [x] **Ngữ cảnh phiên làm việc** (`campaignState()` trong `chat.ts`): mỗi lượt chat đều nhận (a) tiêu chí hiện tại, (b) tiến độ đã chạy tới bước nào, (c) **kết luận từng KOC** — điểm, ngân sách được chia, nhận xét S3, tóm tắt video S4 — và (d) 8 lượt hội thoại gần nhất. Không có khối này thì AI trả lời như chưa từng chạy chiến dịch: "xong chưa?" không biết đáp, "em xem đi" hỏi lại "KOC nào?". Mọi con số trong khối do code lấy từ DB, AI không tự tính. Đo sau khi thêm: "xong chưa?" → *"đã xong, 5 KOC, chia 29,8 triệu"*; "em xem đi" (sau lượt nói về Ánh Ốc) → hiểu đúng là Ánh Ốc và chạy lại `analyse_videos → recommend`.
- [x] **Giới hạn đã khoá: không đánh giá giọng nói.** S4 gửi cho model 4 khung hình tĩnh, không có audio, không có transcript → câu hỏi về giọng nói/âm thanh/nhạc nền trả lời thẳng là không có dữ liệu (`asksAboutVoice` + `NO_AUDIO` trong `chat-rules.ts`), thay vì hứa "để mình xem video" rồi vẫn không trả lời được. Muốn làm thật phải thêm bước trích audio + STT (Whisper) — xem Step 6, chưa làm.
- [ ] Thu hẹp bằng chứng gửi cho `explain` theo KOC được hỏi (hiện gửi của 12 KOC → ~$0,05/lượt); cập nhật `05-benchmark.md` phần chi phí mỗi lượt chat.

### Step 10c — Hỏi AI ở trang hồ sơ KOC ✅ (2026-11-02)
Thanh hỏi AI nổi ở đáy trang `/kocs/[id]`; gửi xong mở **overlay hội thoại**. Chỉ đọc dữ liệu đã thu thập — không chấm điểm, không chia ngân sách, không chạy pipeline.
- [x] `src/lib/evidence/creator.ts` — bằng chứng **độc lập chiến dịch** (`campaign_id: null`, id `ev_koc_<creator>_<key>`). Evidence của S2 không dùng lại được vì percentile ở đó tính trong nhóm đủ điều kiện của một chiến dịch; ở đây tính trên toàn pool đã crawl. Gồm doanh thu/view/tương tác (so pool), follower + MCN, khán giả, độ ổn định theo ngày, **cơ cấu danh mục + nhóm sản phẩm theo doanh thu** (`category_l2`/`l3`), sản phẩm dẫn đầu, chi phí ước tính.
- [x] `src/lib/chat-creator.ts` + `actions/koc-chat.ts` + collection `creator_chats`; dùng lại `validateReasons`, luật `chat-rules` (giọng nói), và đọc lại S3/S4 đã cache (0 token).
- [x] `components/ask-bar.tsx` (thanh nổi + overlay, optimistic) · `ChatThread` nhận `action` qua prop để dùng chung cho cả chiến dịch.
- [x] Đo thực tế: "chủ yếu bán danh mục và sản phẩm nào?" → *"danh mục Trang điểm, nhóm Tẩy trang 48% doanh thu; dẫn đầu Nước tẩy trang 48%, Setting spray 21%"*, 15,7s, $0,023.
- [x] **Hai lỗ hổng chống bịa phát hiện khi test, đã vá cho cả `koc-chat` lẫn `explain` của chat chiến dịch:** (1) model viết số **bằng chữ** ("hai mươi triệu") để lách `validateReasons` vốn chỉ soi chữ số → bắt buộc viết bằng chữ số; (2) model diễn giải ngược percentile ("cao hơn 19% KOC" → "cao hơn hầu hết") trong câu mở đầu vốn không chứa số nên không bị kiểm tra → **code tự dán nhãn mức** (nhóm dẫn đầu → nhóm thấp) vào claim và bắt AI dùng đúng nhãn.
- [x] **Nhóm cùng tầm** (`peer_revenue`, `peer_engagement`): KOC mỹ phẩm có 0,5×–2× số follower; so doanh thu/tương tác với **trung vị nhóm**. Trước đó AI trả lời "không có dữ liệu so sánh với creator khác" vì chỉ có percentile toàn pool — không đúng câu hỏi "so với creator cùng tầm".
- [x] **Dẫn chứng từ video, không nói suông**: `evidence/creator-video.ts` chọn 2 video tiêu biểu (nhiều view nhất + doanh thu cao nhất) → `analyseVideo()` (tách ra từ S4, **dùng chung cache** nên KOC từng nằm trong chiến dịch thì 0 token) → nhận định thành claim có `evidence_id`. Câu hỏi về đánh giá tổng quan hoặc nội dung/review/demo đều đi qua đường này. Đo thực tế: *"Một số video không demo sản phẩm cụ thể, chỉ demo 5/100 như video Halloween"* — dẫn đúng khung hình đã xem.
- [x] **Dẫn chứng trực quan**: ảnh bìa sản phẩm bán chạy (CDN Kalodata theo `product_id`) + thumbnail video kèm mốc giây AI đã xem, hiển thị ngay trong overlay.
- [x] **Cache điểm nổi bật** (`ai_assessments`, kind `creator_highlights`, khoá theo hash toàn bộ claim): lần đầu $0,078 / 57s → hỏi lại **$0 / 1,9s**, kể cả khi câu chữ khác đi. Crawl mới làm claim đổi → hash đổi → tự phân tích lại.
- [x] Phiên làm việc với từng KOC: mỗi **cuộc trò chuyện** là một doc `creator_chats` (`creator_id` + `title` + `messages[]`); overlay có sidebar lịch sử + nút "Cuộc trò chuyện mới"; ngữ cảnh chỉ lấy trong cùng một cuộc (8 lượt gần nhất). `threadId` do client sinh nên biết ngay cuộc đang mở mà không phải chờ server.
- [x] **Các bước phân tích hiển thị cho người dùng** (`AnalysisStep`): đọc dữ liệu 30 ngày → lập nhóm cùng tầm & so sánh → xem video bằng AI → tổng hợp kết luận. Nội dung từng bước do **code** viết từ số liệu thật, không phải AI kể chuyện.
- [x] **Nhóm cùng tầm nêu đích danh**: trả về 4 KOC doanh thu cao nhất trong dải 0,5×–2× follower kèm avatar, bấm sang hồ sơ được; prompt bắt buộc phải có ít nhất một ý đối chuẩn với nhóm. Đo thực tế: *"Doanh thu gấp 9,9 lần trung vị nhóm cùng tầm, vượt xa Chany (214,5 tr)"* — trước đó chỉ nói chung chung.
- [x] **Chạy theo luồng, hiện dần từng bước** (2026-11-02): `analyseCreatorStream()` phát sự kiện NDJSON (`plan` → `step_start` → `step_done` kèm dẫn chứng của riêng bước đó → `conclusion` → `done`) qua route handler `POST /api/kocs/[id]/ask`. **Server Action không stream được** nên bắt buộc dùng route handler; `handleCreatorTurn()` giờ chỉ là bản gom hết sự kiện (dùng cho CLI) để logic chỉ có một nguồn. Giao diện: kế hoạch hiện ngay → mỗi bước xong đổi spinner thành số thứ tự và dẫn chứng trồi lên (`animate-rise`), kết luận chạy chữ dần như ChatGPT (`Typewriter`). Lưu ý khi tự kiểm: `export const dynamic` không dùng được chung với `cacheComponents`, và gửi tiếng Việt qua bash/curl bị hỏng UTF-8 → tưởng nhầm là lỗi phân nhánh.
- [x] **Sửa lỗi nghiêm trọng: mọi câu hỏi nhận cùng một câu trả lời.** `creator_highlights` được cache theo `(KOC, bằng chứng)` — **không có câu hỏi trong khoá** — nên hỏi "chất lượng nội dung ra sao" lại nhận đúng bản đánh giá tổng quan. Thay bằng `creator_answer` cache theo `(KOC, bằng chứng, CÂU HỎI, ngữ cảnh hội thoại, model, prompt)`; prompt bắt buộc trả lời đúng trọng tâm câu hỏi. Đã xoá 7 bản `creator_highlights` cũ.
- [x] **Kế hoạch đọc từ prompt** (`planAnalysis`, `koc-plan-v1`): 1 call Haiku chọn các bước trong danh sách đóng (`read_data` luôn có · `peers` khi cần đối chuẩn · `videos` khi hỏi về nội dung/demo · `answer` luôn cuối), tự đặt tên bước theo câu hỏi; code ép thứ tự và ràng buộc. Trước đó kế hoạch cứng 4 bước nên câu nào cũng một quy trình. Đo thực tế: "chi phí hợp tác bao nhiêu" → 3 bước có `peers`, không có `videos`; "doanh thu có ổn định không" → 2 bước; "chất lượng nội dung ra sao" → 3 bước có `videos`.
- [x] Hai lỗi phụ lộ ra khi tự kiểm: (1) **câu trả lời rỗng bị cache** → mọi lần hỏi lại đều trả "chưa trả lời được" với 0 token, che mất lỗi thật → chỉ cache khi có nội dung; (2) model trả JSON có **dấu nháy kép chưa escape** trong chuỗi (`"text": "Video "Ai đang..." có demo tốt"`) làm `JSON.parse` hỏng → thêm `repairQuotes()` + dặn model dùng nháy đơn.
- [x] **Bộ test tự động** (`npm run test:koc`, [`07-test-plan.md`](07-test-plan.md) → kết quả [`08-test-koc-chat.md`](08-test-koc-chat.md)): 15 ca / 6 nhóm, chấm bằng tiêu chí máy kiểm được (mỗi ý phải trích `evidence_id`; phải trích **đúng nhóm bằng chứng** của câu hỏi; kế hoạch không được thừa/thiếu bước; câu hỏi hồ sơ không được kèm bảng bán hàng; không được viết số bằng chữ). Lần chạy đầu **14/15** — bắt được 2 lỗi ràng buộc kế hoạch mà thử tay không thấy: regex `SALES` khớp cả chữ "sản phẩm" trong *"demo sản phẩm"* (ép đọc chỉ số, bỏ xem video), và sau khi vá thì chữ "video" trong *"bao nhiêu một video"* lại ép chạy xem video thừa. Sau khi siết regex: **15/15**.
- [x] **`ratioText()`**: chênh lệch ≥ 2× thì viết "gấp 9,9 lần" thay vì "cao hơn 10486%" — con số phần trăm kiểu đó đọc vô nghĩa với người dùng.

### Step 10 — Bàn giao
- [ ] Hoàn thiện README (chạy, giới hạn, hướng mở rộng), sơ đồ kiến trúc, quay video demo.

## Còn chờ
- Kalodata API key (tạo ở Account) → `KALODATA_API_KEY` trong `.env.local`.
