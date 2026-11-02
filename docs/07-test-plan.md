# Kế hoạch test — hỏi đáp ở trang hồ sơ KOC

> Chạy: `npm run test:koc` (cần `npm run dev` đang chạy). Kết quả mỗi lần chạy ghi đè vào
> [`08-test-koc-chat.md`](08-test-koc-chat.md). Mặc định dùng KOC `7088624652566660098` (Mai Trịnh —
> dữ liệu đầy đủ: 50 sản phẩm, 52 video, có MCN); đổi bằng `npm run test:koc -- <creatorId> [baseUrl]`.

## 1. Vì sao cần bộ test này

Ba lỗi nghiêm trọng từng lọt qua vì tôi chỉ thử **một câu hỏi** rồi kết luận là chạy tốt:

| Lỗi | Vì sao mắt thường khó thấy |
|---|---|
| Mọi câu hỏi nhận cùng một câu trả lời | Cache không có câu hỏi trong khoá — chỉ lộ khi hỏi **nhiều câu khác nhau trên cùng một KOC** |
| Hỏi liên hệ vẫn đổ bảng top sản phẩm | Câu trả lời vẫn đúng, chỉ phần dẫn chứng là nhiễu |
| AI viết số bằng chữ để lách validator | "hai mươi triệu" trông vẫn hợp lý, nhưng không bị kiểm tra bằng chứng |

Nên bộ test không chấm bằng cảm nhận mà bằng **tiêu chí máy kiểm được**.

## 2. Tiêu chí chấm

| # | Tiêu chí | Cách kiểm (tự động) |
|---|---|---|
| T1 | **Có dẫn chứng** | Mỗi ý trong kết luận phải trích ≥ 1 `evidence_id`; mỗi ca có ngưỡng số ý tối thiểu |
| T2 | **Đúng trọng tâm** | Ý phải trích đúng **nhóm bằng chứng** của câu hỏi: chi phí → `_cost`, liên hệ → `_contact`, video → `_video_`, đối chuẩn → `_peer_*`, ổn định → `_consistency`, danh mục → `_category_mix` |
| T3 | **Kế hoạch bám câu hỏi** | Bước bắt buộc phải có; bước thừa không được xuất hiện (hỏi liên hệ mà đọc chỉ số bán hàng là sai) |
| T4 | **Không nhiễu dẫn chứng** | Câu hỏi hồ sơ/liên hệ không được kèm bảng báo cáo hay thẻ sản phẩm |
| T5 | **Không lách validator** | Không có số viết bằng chữ ("hai mươi triệu", "tám mươi phần trăm") |
| T6 | **Hỏi nối tiếp đúng trọng tâm** | Trong cùng một cuộc trò chuyện, câu sau phải trích nhóm bằng chứng của **chính nó**, không lặp lại câu trước |

T2 là tiêu chí mạnh nhất: nó bắt được cả trường hợp câu trả lời "nghe có vẻ đúng" nhưng thực ra
đang dựa vào dữ liệu không liên quan.

## 3. Bộ prompt (15 ca / 6 nhóm)

### Nhóm 1 — Chỉ số & điểm nổi bật (bắt buộc có dẫn chứng)
| Ca | Câu hỏi | Kỳ vọng |
|---|---|---|
| `metrics-overview` | Đánh giá khả năng bán hàng, so với creator cùng tầm thế nào? | có `read_data` + `peers`; trích `peer_revenue`/`peer_engagement`/`peer_top`; ≥ 3 ý |
| `metrics-stability` | Doanh thu có ổn định trong 30 ngày không? | có `read_data`, **không** `videos`; trích `consistency`; ≥ 2 ý |
| `metrics-engagement` | Tỷ lệ tương tác của KOC này cao hay thấp? | trích `engagement`; ≥ 1 ý |
| `metrics-audience` | Khán giả của KOC này chủ yếu là ai? | trích `audience`; ≥ 1 ý |

### Nhóm 2 — Sản phẩm & danh mục
| Ca | Câu hỏi | Kỳ vọng |
|---|---|---|
| `products-category` | Chủ yếu bán danh mục và sản phẩm nào? | có `read_data`; trích `category_mix`/`products`; ≥ 2 ý |
| `products-brand` | KOC có bị phụ thuộc vào một thương hiệu nào không? | có `read_data`; trích `products`/`category_mix` |

### Nhóm 3 — Hồ sơ, liên hệ, chi phí (không được kéo bảng bán hàng)
| Ca | Câu hỏi | Kỳ vọng |
|---|---|---|
| `profile-contact` | Tôi có thể liên hệ với KOC ở đâu? | chỉ `profile` + `answer`; trích `contact`; **không** bảng báo cáo, **không** thẻ sản phẩm |
| `profile-cost` | Chi phí hợp tác ước tính bao nhiêu một video? | trích `cost`; phải nói rõ là "ước tính" |
| `profile-mcn` | KOC này có thuộc MCN nào không? | có `profile`, **không** `read_data`; không bảng báo cáo |

### Nhóm 4 — Nội dung & video (bắt buộc xem video)
| Ca | Câu hỏi | Kỳ vọng |
|---|---|---|
| `content-quality` | Chất lượng nội dung và cách review sản phẩm ra sao? | có `videos`; trích `video_*`; ≥ 2 ý |
| `content-demo` | KOC có demo sản phẩm trực tiếp trong video không? | có `videos`; trích `video_*` |

### Nhóm 5 — Ngoài phạm vi (phải nói thẳng)
| Ca | Câu hỏi | Kỳ vọng |
|---|---|---|
| `oos-voice` | Giọng nói của KOC này có hay không? | trả lời thẳng là không có **âm thanh**; không kèm dẫn chứng nào |

### Nhóm 6 — Hỏi nối tiếp trong cùng cuộc trò chuyện
| Ca | Câu hỏi | Kỳ vọng |
|---|---|---|
| `thread-1-overview` | Đánh giá tổng quan KOC này giúp tôi | ≥ 2 ý có dẫn chứng |
| `thread-2-cost` | Thế còn chi phí hợp tác thì sao? | chuyển trọng tâm sang `cost`, nói rõ "ước tính" |
| `thread-3-contact` | Vậy liên hệ với họ bằng cách nào? | chuyển trọng tâm sang `contact` |

Ba ca nhóm 6 chạy **trong cùng một `threadId`** để kiểm đúng thứ bạn yêu cầu: hỏi tiếp trong một
section phải bám câu hỏi mới, không lặp lại câu trả lời cũ.

## 4. Lỗi bộ test đã bắt được (2026-11-02)

Lần chạy đầu: **14/15**. Hai lỗi đều nằm ở ràng buộc kế hoạch bằng regex — thử tay vài câu không thấy:

| Ca | Triệu chứng | Nguyên nhân |
|---|---|---|
| `content-demo` | Hỏi *"có demo sản phẩm trong video không"* nhưng kế hoạch **không có bước xem video**, lại đọc chỉ số bán hàng | Regex `SALES` khớp chữ "sản phẩm" trong "demo sản phẩm" → ép `read_data`; chưa có ràng buộc ép `videos` |
| `profile-cost` | Hỏi *"chi phí bao nhiêu một video"* lại **chạy thừa bước xem video** | Regex nội dung khớp chữ "video" trần, trong khi đây là **đơn vị tính giá** |

Sau khi siết: `CONTENT_Q` chỉ khớp khi "video" đi kèm ý về nội dung (xem/chất lượng/demo/review…), và
khi câu hỏi thuộc nhóm nội dung thì chỉ ép đọc chỉ số nếu có từ khoá bán hàng thật sự → **15/15**.

## 5. Chẩn đoán "phân tích nông" (2026-11-02)

So với Kalopilot trên cùng KOC (@phuongsena) cùng câu hỏi, câu trả lời của mình nông hơn hẳn.
Kiểm tra DB thì **nguyên nhân không phải thiếu dữ liệu, cũng không phải giao diện** — là lớp bằng
chứng chỉ phơi ra ~15 claim hời hợt trong khi dữ liệu đã crawl có sẵn:

| Kalopilot nêu | Trường mình đã có nhưng chưa dùng |
|---|---|
| 23 nghìn đơn | `creator_metrics.sales_volume` = 22.990 |
| Đơn giá bình quân 1,5 tr | `unit_price` = 1.500.922 |
| Doanh thu/1.000 lượt xem live 13,2 tr | `live_gpm` = 13.188.912 |
| 95,8% doanh thu từ livestream | `live_revenue` vs `video_revenue` |
| 54 phiên live | `live_number` = 53 |
| Nhà sáng tạo độc lập | `creators.status` = INDEPENDENT |
| 8/10 sản phẩm thuộc Lubylab | suy được từ tên sản phẩm (`topBrand()`) |

Đã bổ sung 4 nhóm claim: `sales` (số đơn + đơn giá), `channel_mix` (live vs video + số phiên +
GPM live), `independence` (độc lập/thuộc shop + số sản phẩm đang bán + ngày hoạt động),
`brand_focus` (thương hiệu chiếm ưu thế). Bằng chứng tăng **15 → 19 claim**; câu trả lời cho
@phuongsena đổi từ "bán trang điểm là chính" thành nêu đúng *Lubylab 65 sản phẩm, 75% doanh thu*.

**Bài học:** chất lượng phân tích bị chặn bởi **lớp bằng chứng**, không phải bởi model hay UI.
Trước khi chỉnh prompt hay giao diện, kiểm xem dữ liệu đã crawl có đang bị bỏ phí không.

## 6. Cache câu trả lời đang TẮT (2026-11-02)

`ANSWER_CACHE_ENABLED` trong `src/lib/chat-creator.ts` đọc `KOC_ANSWER_CACHE`; mặc định **tắt**.

**Vì sao tắt:** cache khoá theo `(KOC, bằng chứng, câu hỏi, phiên bản prompt)` nên mỗi lần vừa sửa
prompt hoặc thêm bằng chứng, bộ test lại nhận **bản trả lời cũ** và che mất lỗi thật. Đã mất mấy
lượt chạy vì chuyện này: ca báo *"blocks rỗng"* với giá **$0** hoá ra là bản cache hỏng sinh từ
phiên bản prompt trước, không phải lỗi logic hiện tại.

**Bật lại** khi chất lượng đã ổn định: thêm `KOC_ANSWER_CACHE=1` vào `.env.local`. Khi đó hỏi lại
đúng một câu sẽ về 0 token như trước.

**Không ảnh hưởng tới phần đắt tiền:** `video_analysis` cache riêng theo video (dùng chung với S4)
nên vẫn không trả lại tiền. `llm_cache` ở tầng gọi model cũng vẫn bật — nó chỉ trả lại đúng văn bản
gốc của model cho cùng một prompt, còn toàn bộ khâu hậu xử lý (lọc khối, kiểm bằng chứng, chèn câu
dẫn) vẫn chạy lại mỗi lần nên không che được lỗi.

## 6. Chi phí & lưu ý khi chạy

- Mỗi lần chạy đủ bộ tốn khoảng **$0,4–0,7** (mỗi ca 1 call lập kế hoạch + 1 call trả lời, Haiku).
- Chạy lại **cùng bộ câu hỏi** sẽ gần như $0 vì cache khoá theo `(KOC, bằng chứng, câu hỏi)` —
  muốn đo lại chi phí thật thì xoá `ai_assessments.kind = "creator_answer"` và `llm_cache` trước.
- Phân tích video (`video_analysis`) dùng chung cache với S4 nên không tính thêm tiền nếu KOC đã
  từng được phân tích.
- Bộ test tạo các cuộc trò chuyện `test-*` trong `creator_chats`; xoá bằng cách lọc theo tiền tố đó.
