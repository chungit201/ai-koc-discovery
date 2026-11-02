# ⚠ BÀN GIAO — hiện trạng & việc cần làm tiếp (2026-11-02)

> Đọc file này TRƯỚC khi sửa code phần hỏi đáp KOC. Kèm [`07-test-plan.md`](07-test-plan.md)
> (bộ test) và [`01-plan.md`](01-plan.md) (Step 10b/10c).

## 0. TRẠNG THÁI: 🟡 CÒN PHẢI TEST THÊM

> Cập nhật 2026-11-02. **Chưa chốt.** Chủ dự án sẽ tự test lại tay trên giao diện rồi sửa trạng thái
> ở chính mục này. Đừng coi là xong, cũng đừng bật lại cache (mục 2.2) trước khi trạng thái đổi.

Tự động thì đang **14/15 ca** (`npm run test:koc -- 7088240910156923905`), nhưng còn **chưa kiểm tay**:

- [ ] Nhìn mắt bảng **top video** trên giao diện: ảnh bìa có lên không, bấm có phát được không,
      nhãn "quảng cáo" có đúng video chạy ads không.
- [ ] Nhìn mắt **ảnh sản phẩm** trong bảng top 10 (ảnh lấy từ CDN Kalodata, có sản phẩm sẽ 404 →
      rơi về icon hộp; cần xem tỉ lệ hỏng có chấp nhận được không).
- [ ] Đối chiếu lại số liệu với Kalodata **sau khi crawl xong** — xem mục "Đang crawl" bên dưới.
- [ ] `peer_live` (so hiệu quả live với nhóm) **chưa chạy lần nào** vì thiếu dữ liệu; phải xác nhận
      lại sau khi crawl.
- [ ] Ca `metrics-stability` còn đỏ vì kỳ vọng test, cần quyết định hạ `min_reasons` hay không.

### Đang crawl (chạy nền, 2026-11-02)

Crawler đang chạy để lấp hai lỗ hổng dữ liệu đã xác định — **không phải việc của code**:

| Lỗ hổng | Trước khi crawl | Mở khoá được gì |
|---|---|---|
| `creator/detail` (chứa `live_gpm`) | 32/1027 KOC | Claim `peer_live` — so hiệu quả live với trung vị nhóm, thứ hạng #n/N |
| `creator_products` chưa đủ trang | 55/109 sản phẩm của @phuongsena | Doanh thu sản phẩm, cơ cấu danh mục, thị phần thương hiệu đang tính trên **nửa danh mục** |

Crawl xong thì **chạy lại `npm run test:koc`** và đối chiếu lại với Kalopilot: các con số tổng sẽ
đổi, và `peer_live` sẽ bắt đầu xuất hiện trong câu trả lời.

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
- `src/lib/evidence/creator.ts` — **23 claim** bằng chứng do code dựng từ MongoDB
- `src/lib/evidence/creator-video.ts` — phân tích video (dùng chung cache với S4)
- `src/lib/chat-rules.ts` — luật khoá cứng (không đánh giá giọng nói, không xem video hàng loạt)
- `src/lib/chat-events.ts` — kiểu sự kiện stream + `AnswerBlock`
- `src/app/api/kocs/[id]/ask/route.ts` — route stream NDJSON, lưu `creator_chats`
- `src/components/ask-bar.tsx` — thanh hỏi nổi + overlay + nhịp hiển thị do client điều phối
- `scripts/test-koc-chat.ts` — bộ test 15 ca (`npm run test:koc`)

## 2. ⚠ VẤN ĐỀ ĐANG MỞ — ưu tiên theo thứ tự

### 2.1 Bộ test — **14/15** trên `@phuongsena` (2026-11-02)
Đã làm xong hướng đề xuất cũ: `focusEvidenceIds()` trong `chat-creator.ts` **chọn sẵn id bằng chứng
theo từ khoá câu hỏi** rồi đưa vào prompt, và `autoCite()` dò nhóm trọng tâm **trước** phần còn lại
(cùng một con số nằm trong nhiều claim, thứ tự map cũ hay gắn `_revenue` thay vì `_consistency`).

Ca duy nhất còn đỏ là `metrics-stability`: *"chỉ 1/2 ý có dẫn chứng"* — model trích **đúng**
`_consistency` nhưng gộp trọn câu trả lời vào một đoạn. Đây là **kỳ vọng test sai chứ không phải
lỗi hệ thống** (cùng loại với ghi chú đã để sẵn ở ca `products-category`): câu hỏi đóng/mở kiểu
"có ổn định không" chỉ cần 1 ý. Hạ `min_reasons` của ca này xuống 1 là xanh.

⚠ `metrics-engagement` **dao động giữa các lần chạy** — có lượt Haiku viết đoạn có số rồi bị bộ lọc
xoá vì không dò được nguồn, thành "0 ý". Thấy ca này đỏ thì chạy lại trước khi đi sửa code.

Chạy lại: `npm run dev` rồi `npm run test:koc -- <creatorId>` → ghi đè `docs/08-test-koc-chat.md`.

### 2.2 Cache câu trả lời ĐANG TẮT
`ANSWER_CACHE_ENABLED` trong `chat-creator.ts` đọc `KOC_ANSWER_CACHE`, **mặc định tắt**.
Bật lại (`KOC_ANSWER_CACHE=1` trong `.env.local`) **sau khi** bộ test xanh ổn định.
Lý do tắt: cache che mất lỗi khi prompt/bằng chứng vừa đổi — xem `07-test-plan.md` mục 6.

### 2.3 Còn thiếu so với Kalopilot (đối chiếu trên @phuongsena — nay ~85%)
- ✅ **Khoảng giá sản phẩm** — claim `price_range` (trung vị ₫1,6tr, dải 178k–5,1tr; khớp đúng
  "combo 1,3–5 triệu" mà họ nêu) + claim `orders`.
- ✅ **Top video** — bảng `top_videos` do code dựng từ `videos` (view/like/doanh thu/cờ quảng cáo,
  ảnh bìa bấm xem được), **0 token**, tách hẳn khỏi bước "AI xem khung hình" vốn đắt.
- ✅ **Ảnh sản phẩm** trong bảng top sản phẩm + cột số đơn.
- ⚠ **So hiệu quả live với nhóm** — claim `peer_live` đã viết xong nhưng **gần như không bao giờ
  bắn**: `live_gpm` nằm ở bản ghi `creator/detail`, mà mới crawl **32/1027** KOC. Cần crawl thêm
  `creator/detail` thì claim tự sống, không phải sửa code.
- ❌ **Độ phủ sản phẩm mới 50%**: `creators.product_count` = 109 nhưng `creator_products` chỉ có 55
  sản phẩm của @phuongsena. Crawler chưa lấy hết trang → mọi con số "tổng doanh thu sản phẩm" đang
  dựa trên nửa danh mục.
- ❌ **Số shop hợp tác** (họ nêu 43) — **không suy ra được**. `products.seller_name` chỉ cho thấy 2
  shop vì ta mới có 55 sản phẩm; đừng dựng claim từ nó, sẽ sai.
- ❌ **Danh mục cấp 1** — `products.category_l1` có trong DB nhưng chưa dùng (mới L2→L3).
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
8. **`creator_products` lưu MỘT DÒNG MỖI `(product_id, date_range)`** — KOC crawl 2 lần thì mỗi sản
   phẩm có 2 dòng. Cộng doanh thu mà quên `$group` theo `product_id` là **nhân đôi số liệu**. Đúng
   lỗi đã gặp: câu trả lời nói "46,6 tỉ / 77%" trong khi bảng ngay dưới nói "23,5 tỉ / 72%", vì
   `creatorEvidence()` thiếu `$group` còn `creatorReport()` thì có. `videos` thì KHÔNG lặp.
9. **Có HAI tầng cache, xoá một tầng là chưa sạch**: `ai_assessments` (theo bằng chứng+câu hỏi) và
   `llm_cache` (theo prompt, trong `claude.ts`). Tắt `KOC_ANSWER_CACHE` **không** tắt `llm_cache` —
   ca test chạy ~2 giây với giá $0 là dấu hiệu nó đang trả lời từ `llm_cache`.

## 5. Nguyên tắc không được phá

- **Mọi con số trong câu trả lời phải truy được về một `evidence_id` có thật.** Bảng số liệu do code
  dựng; model chỉ chọn chèn và đặt tiêu đề. `autoCite()` chỉ *tìm hộ* nguồn, không nới điều kiện.
- **AI chỉ chọn trong danh sách đóng** (bước phân tích, loại khối, ý định chat); code ép thứ tự,
  ràng buộc và giới hạn.
- **Không hứa điều hệ thống không làm được** — giọng nói/âm thanh là ví dụ đã khoá cứng.
- **Không nói chuyện cache/token với người dùng** trong mô tả từng bước.

## 6. Nhật ký thay đổi — 2026-11-02 (chưa nghiệm thu, xem mục 0)

**Sửa lỗi số liệu sai gấp đôi.** `creatorEvidence()` cộng doanh thu sản phẩm mà thiếu `$group` theo
`product_id`, trong khi `creatorReport()` có → câu trả lời tự mâu thuẫn với bảng nằm ngay dưới nó
("46,6 tỉ / 77%" vs "23,5 tỉ / 72%"; doanh thu thật 30,3 tỉ). Ảnh hưởng **mọi KOC crawl từ 2 lần
trở lên**. Hai nơi nay dùng chung một phép gộp — xem bẫy #8.

**Trích dẫn đúng trọng tâm.** `focusEvidenceIds()` chọn sẵn id bằng chứng theo từ khoá câu hỏi và
đưa vào prompt; `autoCite()` dò nhóm trọng tâm trước. Bộ test từ 11/15 → 14/15.

**Bằng chứng mới** (`creator.ts`): `price_range`, `orders`, `top_videos`, `peer_live`. 20 → 23 claim.

**Giao diện** (`ask-bar.tsx`): bảng top sản phẩm thêm ảnh bìa + cột số đơn (component `ProductThumb`
đã tồn tại sẵn nhưng chưa ai gọi); thêm bảng `top_videos` có ảnh bìa bấm phát được và nhãn
"quảng cáo".

**Đã xoá sạch** `ai_assessments` (184), `creator_chats` (133), `llm_cache` (85) theo yêu cầu —
lần chạy sau sẽ gọi model thật từ đầu, kể cả phân tích video.

`ANSWER_PROMPT_VERSION` hiện là `koc-answer-v11`.
