# 10 — Hỏi AI về KOC theo kiểu agent (Claude CLI + công cụ đọc DB)

> Mục tiêu: câu "Chủ yếu bán danh mục và sản phẩm nào?" cho @phuongsena phải ra được chất lượng như
> Kalopilot (xem ảnh so sánh ngày 2026-11-02): bảng top 10 kèm danh mục, cơ cấu L1/L2/L3 theo % doanh
> thu kênh, kênh bán live/video, định vị giá, đối chuẩn — **mọi con số có nguồn**.

## 1. Vì sao luồng hiện tại kém (chẩn đoán 2026-11-02)

| # | Vấn đề | Chỗ trong code |
|---|---|---|
| 1 | Model chỉ thấy ~20 câu tóm tắt dựng sẵn, top 3 sản phẩm, tên cắt 55 ký tự | `evidence/creator.ts` → `products` |
| 2 | Mẫu số sai/lẫn: 3 con số doanh thu (30,3 tỉ scope mỹ phẩm / 32,7 tỉ tổng sản phẩm / 34,5 tỉ kênh) và 2 số đơn (19,9k / 23k); tỉ trọng danh mục chia cho tổng sản phẩm, không có L1 | `creatorEvidence`, `creatorReport` |
| 3 | Validator xoá mọi số không nằm nguyên văn trong claim → model không thể tính "top 10 chiếm 53,7%", "gấp 5,7 lần" → văn chung chung | `sanitizeBlocks` + `validateReasons` |
| 4 | Planner chọn trong 5 bước cố định; hỏi danh mục chỉ chạy `read_data` | `planAnalysis` |
| 5 | Haiku, 1 lần gọi, `--tools ""` — không đọc thêm được khi thiếu | `llm/claude.ts` |

Kalopilot là **agent có công cụ**: tự lập kế hoạch → gọi product rank/detail → thấy thiếu thì gọi tiếp → tự tính cơ cấu → viết báo cáo.

## 2. Kiến trúc mới

```
Câu hỏi ─► chat-creator (agent mode)
             │ spawn: claude -p --model sonnet --mcp-config <tmp> --allowedTools mcp__koc__*
             │        --output-format stream-json   (env KOC_SESSION=<id>, KOC_CREATOR=<id>)
             ▼
        MCP server "koc" (scripts/koc-mcp.ts, stdio, chỉ đọc DB)
             ├ get_overview        tổng kênh: doanh thu, đơn, AOV, live/video/shop, follower, khán giả (ước tính)
             ├ list_products       top N đầy đủ tên, L1/L2/L3, giá, đơn, doanh thu, % doanh thu kênh
             ├ category_breakdown  gộp theo L1 | L2 | L3, % trên doanh thu kênh + độ phủ dữ liệu
             ├ list_videos         sort view|revenue: view, like, doanh thu, QC, ROAS, sản phẩm gắn
             ├ get_daily           doanh thu/đơn theo ngày, live vs video, ngày đỉnh
             ├ get_peers           nhóm cùng tầm + xếp hạng doanh thu / tương tác / GPM live
             ├ analyze_videos      AI xem 4 khung hình/video (cache S4), demo/hình/độ tự nhiên/ghi chú từng khung (P5b)
             └ calc                share | ratio | diff | sum — input PHẢI là số đã có trong kết quả công cụ của phiên
        + công cụ có sẵn của CLI: WebSearch / WebFetch — chỉ cho câu NGOÀI dữ liệu Kalodata (P5c);
          ý trích web phải có web_urls nằm trong kết quả tìm/đọc của phiên, số phải có trong chữ đã đọc
             │  mỗi kết quả → 1 bản ghi `evidence` (session_id, id `ev_s_<session>_<n>`), số đã định dạng sẵn
             ▼
        stream-json: tool_use / tool_result ─► sự kiện step_start / step_done ─► thẻ trên giao diện
             ▼
        câu trả lời cuối = JSON blocks (như hiện tại) + khối mới {"type":"table","source":"<evidence_id>"}
             ▼
        validator: mọi số trong para/bullets phải có trong evidence của phiên (kể cả calc); bảng do code dựng từ rows
```

Nguyên tắc chống bịa giữ nguyên (`docs/04-data-model.md` §3.1): số do code tính; AI chỉ trích `evidence_id`; số AI muốn tự tính phải đi qua `calc` (server kiểm tra input có thật).

## 3. Các phần — làm lần lượt

- [x] **P1. Một nguồn sự thật cho số liệu kênh** (`src/lib/koc-data/facts.ts`) — xong 2026-11-02
  - Kết quả @phuongsena: một doanh thu duy nhất 34,5 tỉ, một số đơn 23k, live 95,8% (đúng như Kalopilot), top 10 = 56% (Kalopilot 53,7%), 55 sản phẩm crawl = 95% doanh thu kênh. `koc-ev-v2`.
  - **Còn hở dữ liệu:** 5/55 sản phẩm (12% doanh thu, vd #8 kem chống nắng SN2057) chưa có danh mục trong `products` → L1 "Chăm sóc sắc đẹp" ra 77% thay vì ~92%. Cần crawl bổ sung danh mục cho sản phẩm thiếu (web, không tốn credit).
  - Doanh thu/đơn/AOV/live/video lấy từ `web:creator/detail/total` scope `all` (fallback `creator/detail` all).
  - Sản phẩm gộp theo `product_id` một lần, kèm L1/L2/L3; tỉ trọng = / doanh thu kênh; ghi rõ độ phủ (N sản phẩm crawl = X% doanh thu kênh).
  - `creatorEvidence` + `creatorReport` dùng chung module này → hết mâu thuẫn số; thêm claim `category_l1_mix`.
- [x] **P2. Thư viện công cụ** (`src/lib/koc-data/tools.ts`) — xong 2026-11-03
  - 7 công cụ trong `KOC_TOOLS` (kèm JSON Schema cho P3), chạy qua `runKocTool(name, {creatorId, sessionId}, args)` → `{ evidence_id, summary, rows, numbers }`.
  - Bằng chứng ghi vào `evidence` với `session_id`, id tất định `ev_s_<session>_<tool>_<sha1(args)>` (gọi lại cùng tham số không đẻ bản ghi trùng). `numbers` = số thô có tên — nguồn duy nhất cho `calc` và validator P5.
  - `calc` từ chối mọi input không có trong `numbers` của phiên (sai số 0,5%) — đã thử với số bịa → lỗi.
  - `list_products` đếm video gắn từng sản phẩm; `list_videos` có `product_id` để lấy video bán một sản phẩm, kèm quảng cáo/ROAS.
  - Thử: `npm run koc:tool -- all @phuongsena [--rows]`, `npm run koc:tool -- calc @phuongsena '{"op":"ratio","a":…,"b":…}'`. Mỗi công cụ 100–500 ms.
  - Kết quả @phuongsena: 34,5 tỉ / 23k đơn / live 95,8% / video 0,2% / GPM live 13,2 tr / chốt 0,92% — khớp Kalopilot. Top 10 = 56,1% (Kalopilot 53,7% trên 18,5 tỉ — họ dùng doanh thu 30 ngày theo sản phẩm, mình dùng kỳ crawl).
  - **Hở còn lại:** (a) 5 sản phẩm chưa có danh mục (12,4% doanh thu); (b) video bán chủ yếu SKU lẻ (SN2008, SN1759…) không có trong `products` → tên trống; (c) đối chuẩn chỉ 6 KOC và so **doanh thu mỹ phẩm** 30,3 tỉ (scope `queryList`, có cho cả pool) — Kalopilot so 9 KOC trên doanh thu kênh; GPM live của nhóm chưa đủ dữ liệu `creator/detail`.
- [x] **P3. MCP server** `scripts/koc-mcp.ts` — xong 2026-11-03
  - JSON-RPC stdio tự viết (initialize, ping, tools/list, tools/call; notification bỏ qua), không thêm dependency. Lỗi công cụ trả `isError` để model tự sửa tham số.
  - Phiên + KOC cố định qua env `KOC_SESSION` / `KOC_CREATOR` — agent không đọc được KOC khác.
  - Kết quả gửi model: `evidence_id` → tóm tắt → tối đa 30 hàng → `numbers` (để làm input cho `calc`).
  - Lệnh chạy (cho `--mcp-config`): `node --conditions=react-server --env-file=.env.local --import tsx scripts/koc-mcp.ts` (cwd = gốc repo). `console.log` bị chuyển sang stderr để stdout sạch.
  - Đã thử với Claude CLI thật trên Windows: `claude -p --model haiku --mcp-config <file> --strict-mcp-config --allowedTools "mcp__koc__*" --tools ""` → gọi `get_overview`, trả "34,5 tỉ, livestream 95,8%" kèm evidence_id; 2 lượt, 7 s, $0,0016. `--tools ""` tắt công cụ có sẵn nhưng vẫn giữ MCP.
- [x] **P4. Chế độ agent trong `llm/claude.ts`** — xong 2026-11-03
  - `claudeAgent({system, prompt, mcp, model, purpose, signal})` là **async generator** (khớp kiểu `yield` của `chat-creator`): phát `tool_use` / `tool_result` / `text` theo thời gian thực từ stream-json, cuối cùng `done` với `ClaudeResult + turns + tool_calls`.
  - Ghi file `--mcp-config` tạm (node đang chạy + `--import tsx`, cwd = gốc repo), xoá khi xong. Chỉ cho `mcp__<server>__*`, `--tools ""`, `--max-turns 24`, timeout 300 s, không thử lại, không cache; huỷ được qua `AbortSignal`. Log chi phí/lỗi vào `api_calls`.
  - Thử: `npm run koc:agent -- @phuongsena "Chủ yếu bán danh mục và sản phẩm nào?"` (Sonnet) → 4 lần gọi công cụ (gọi song song từng cặp), 5 lượt, **13 s, $0,061**; số đúng, mỗi câu kèm evidence_id, tự nêu SN2057 chưa phân loại.
  - Việc cho P5 thấy từ lần thử: (a) model tự cộng "15% + 10,1% ≈ 25%" không qua `calc` → validator phải bắt; (b) không tự gọi `list_videos` / `get_peers` → prompt hệ thống phải yêu cầu dẫn chứng video + đối chuẩn cho câu hỏi sản phẩm; (c) câu trả lời là markdown — P5 chuyển sang JSON blocks + khối `table`.
- [x] **P5. `chat-creator` dùng agent** — xong 2026-11-03 (`src/lib/chat-creator-agent.ts`, cờ `KOC_AGENT=1` trong `.env.local`)
  - Định tuyến (`useAgentFor`): câu hỏi số liệu bán hàng / sản phẩm / danh mục / video / đối chuẩn → agent. Liên hệ, chi phí booking, chất lượng nội dung (cần AI xem khung hình), giọng nói → luồng cũ (7 công cụ chưa có dữ liệu đó).
  - Prompt `koc-agent-v1`: câu hỏi danh mục/sản phẩm **bắt buộc** đủ bộ overview + category L1 & L2 + list_products + list_videos(revenue) + get_peers; số tự tính phải qua `calc`; chép số nguyên văn từ tóm tắt; trả JSON blocks.
  - Validator: mọi câu có số phải khớp claim của evidence **trong phiên** (`validateReasons` + `autoCite`); khối `table` chỉ trỏ `source` = evidence_id, code chép `rows` từ DB.
  - Sự kiện mới `plan{agent:true}` + `step_add` (mỗi lần gọi công cụ = 1 thẻ, có bảng trong thẻ); bước cuối "Kiểm chứng số liệu & viết câu trả lời" báo số ý có nguồn / số ý bị bỏ. Tin nhắn lưu `agent: true` + `steps[].payload`.
  - Giao diện (`ask-bar.tsx`): `ToolTableView` vẽ bảng sản phẩm (ảnh bìa, danh mục, giá, đơn), cơ cấu danh mục, video (ảnh bìa phát được, quảng cáo/ROAS, sản phẩm gắn), đối chuẩn (avatar, KOC này tô đậm).
  - Thử luồng thật @phuongsena "Chủ yếu bán danh mục và sản phẩm nào?": 7 lần gọi công cụ (song song), **22 s, $0,10**, 12 ý có nguồn, 0 ý bị bỏ; bố cục kết luận → bảng danh mục → bảng top 10 → điểm chú ý (live 95,8%, giá trung vị ₫1,6 tr, 12,4% chưa phân loại) → bảng video bán hàng (ROAS 18,07) → bảng đối chuẩn (gấp 7,7 lần qua `calc`, tương tác 0,40% vs 0,58%).
  - Next dev phải **khởi động lại** sau khi thêm `KOC_AGENT=1` (env chỉ đọc lúc start).
- [x] **P5d. Hiển thị câu trả lời kiểu ChatGPT (hết giật)** — xong 2026-11-03 (`ask-bar.tsx`)
  - Nguyên nhân giật: (1) mọi khối `animate-rise` (mờ + nhích 6px) với delay khác nhau → cả bài nhảy; (2) chỉ đoạn đầu gõ chữ, bảng/bullet hiện một lượt; (3) `scrollIntoView smooth` mỗi lần đổi state, các lần cuộn mượt chồng nhau; (4) xong lượt thì `setLive(null)` theo hẹn giờ + `router.refresh()` → bản lưu dựng lại và chạy hiệu ứng lần nữa, có lúc hiện đôi.
  - Sửa: `useReveal` (requestAnimationFrame, ≥ 120 ký tự/giây, bài dài tự nhanh để xong ~6 s) chảy chữ **liên tục qua mọi khối** theo thứ tự đọc; bullet chảy từng ý; bảng chỉ hiện (mờ dần, không nhích) khi dòng chữ tới chỗ; con trỏ ở cuối phần đang chảy; chip nguồn và "Bạn cũng có thể hỏi" chỉ hiện khi xong.
  - Cuộn: `ResizeObserver` trên khung nội dung, **bám đáy tức thì** chỉ khi người dùng đang ở cuối (cách đáy < 80px); cuộn lên đọc thì không bị kéo xuống.
  - Đổi chỗ không nháy: lúc gửi nhớ `baseCount`; bản lưu về sớm bị ẩn (`slice(0, baseCount)`); chỉ đổi sang bản lưu khi đã chảy xong **và** bản lưu đã về (tính lúc render, không dùng effect) — bản lưu hiện tĩnh, không hiệu ứng, bố cục giống hệt.
  - Agent: dòng "Đang đọc kết quả, quyết định bước tiếp…" cố định ở cuối danh sách thẻ thay vì bật/tắt ở đầu. `prefers-reduced-motion` tắt hiệu ứng.
- [x] **P5c. Câu hỏi ngoài dữ liệu → tìm web (học Kalopilot)** — xong 2026-11-03
  - Định tuyến đổi: mọi câu đi agent, trừ liên hệ / chi phí booking / vài câu nội dung kiểu cũ (`OLD_FLOW_Q`). `claudeAgent({ builtinTools: ["WebSearch","WebFetch"] })` bật công cụ web có sẵn của CLI.
  - Prompt `koc-agent-v2`: ngoài dữ liệu → (a) `get_overview` xác nhận Kalodata không có, (b) tìm web kiểu điều tra (biến thể tên/handle/thương hiệu, mode "extended" khi lệch, tìm theo nick chính, WebFetch đọc nguyên văn), (c) trả lời thẳng kèm `web_urls`, (d) ghi rõ "từ web công khai, không thuộc Kalodata", (e) nối với số liệu bán hàng, (f) đời tư chỉ điều KOC tự công khai / báo chí, không địa chỉ, SĐT, con cái, không suy đoán.
  - Kiểm chứng web: ý có `web_urls` chỉ giữ khi mọi URL nằm trong kết quả WebSearch/WebFetch của phiên (không bịa link) và mọi số có trong chữ đã đọc từ web hoặc claim được trích. Thẻ "Tìm kiếm trên web: <truy vấn>" liệt kê link; chip nguồn web màu xanh dương, khác chip dữ liệu Kalodata.
  - Thử "KOC có gia đình chưa?" @phuongsena: 3 lần tìm + 1 lần đọc trang, **35 s, $0,11** → "Có", nick chính @senabeauty, trích nguyên văn "kỷ niệm 10 năm yêu nhau của vợ chồng em" từ video chính chủ; tách rõ ý chưa xác minh (Lubylab là dự án của chồng, con cái); nối với top sản phẩm Lubylab. Lần đầu (prompt chưa dặn tìm kỹ) chỉ ra người trùng tên → agent trả "chưa rõ", không bịa.
  - Sửa sau test của người dùng (prompt `koc-agent-v3`): câu "có gia đình chưa" lại gọi "Lấy danh sách top 5 sản phẩm" — do prompt v2 dặn "gọi list_products để biết thương hiệu" + "nối với số liệu bán hàng". Nay câu ngoài dữ liệu chỉ được gọi `get_overview` (đã kèm thương hiệu bán nhiều nhất, dùng `topBrand`), không chèn bảng/mục bán hàng, trả lời gọn đúng câu hỏi. Chạy lại: get_overview + 4 lần tìm + 2 lần đọc trang, không còn bước sản phẩm, 34 s, $0,11.
  - **Kết quả tìm web dao động giữa các lần chạy**: lần v2 tìm ra video @senabeauty nói "vợ chồng em"; lần v3 cũng nhắc @senabeauty nhưng không mở video đó, trả "chưa rõ" (không bịa). Chưa cố định được — cân nhắc cache kết quả web theo KOC hoặc dặn đọc thử video chính chủ khi đã thấy nick chính.
  - Sửa kèm: tóm tắt `get_overview` ghi "30 ngày" bằng chữ số — trước đó câu "doanh thu 30 ngày…" bị validator xoá oan vì thiếu số 30.
- [x] **P5b. Agent xem video + chip nguồn** — xong 2026-11-03 (yêu cầu sau khi test: "LLM phải kiểm tra và đưa ra bằng chứng đi đến kết luận")
  - Công cụ thứ 8 `analyze_videos` (`koc-data/tools.ts`): AI xem 4 khung hình/video qua `analyseVideo` của S4 (cache theo video → video đã xem thì 0 token), tối đa 3 video, mặc định 2 video doanh thu cao nhất + 1 nhiều view nhất. Trả demo có/không + điểm, sản phẩm thấy được, chất lượng hình, độ tự nhiên, ghi chú từng khung, lưu ý. Chi phí xem video ghi vào `evidence.cost_usd` và cộng vào chi phí lượt hỏi. Không có âm thanh — prompt bắt viết "trong khung hình thấy…".
  - Prompt `koc-agent-v1` thêm: câu hỏi sản phẩm phải gọi `analyze_videos`; **tự kiểm tra** — mỗi kết luận ≥ 2 bằng chứng độc lập, mâu thuẫn thì nói rõ, thiếu thì "chưa đủ dữ liệu"; ý không có số cũng phải trích evidence; cuối bài có mục **"Căn cứ đi đến kết luận"** (mỗi ý = bằng chứng → kết luận).
  - Giao diện: mỗi câu/ý có **chip nguồn** ("4. Lấy danh sách top 10…") → bấm cuộn tới thẻ công cụ và nháy viền (`StepPayload.evidence_id` → `sourcesOf`). Bảng `analyze_videos` hiện ảnh 4 khung hình AI đã nhìn (`/api/frames/[id]`), điểm, ghi chú từng khung kèm giây.
  - Thử @phuongsena: 8 lần gọi công cụ, **26 s, $0,13**, 14 ý có nguồn, 0 ý bị bỏ. AI phát hiện: 3 video bán tốt nhất demo 50–55/100, chỉ cầm sản phẩm giới thiệu, chưa thoa thử; 2 video đầu bán SKU không nằm trong top 10 → nói "chưa đủ dữ liệu để nối". Mục căn cứ: live 95,8% + video 0,2% + demo yếu → "doanh thu đến từ live, video chủ yếu kéo người xem".
- [x] **P7. Mang logic agent sang chiến dịch** — xong 2026-11-03 (chờ người dùng test)
  - **(1) S2 chấm điểm dùng chung quy ước số liệu** (`scoring/run.ts`): sản phẩm gộp theo `(KOC, product_id)` trước khi cộng — đo trên DB: **17/292 KOC bị cộng đôi** doanh thu sản phẩm (vd 19,10 tỉ → đúng 9,55 tỉ); tỉ trọng chia cho **doanh thu kênh** (ưu tiên `creator/detail` như `channelTotals`), chưa có thì ghi rõ "doanh thu sản phẩm đã thu thập"; claim "top X%" → "cao hơn Y% KOC đủ điều kiện". Chiến dịch tạo trước 2026-11-03 vẫn giữ điểm/bằng chứng cũ cho tới khi chấm lại.
  - **(2) Câu giải thích/so sánh → agent**: `handleTurn` ý định `explain` (khi `KOC_AGENT=1`) chạy `analyseCampaignAgent` — MCP nhận `KOC_CREATORS` (danh sách được chọn + dự phòng) + `KOC_CAMPAIGN`; mọi công cụ một-KOC có thêm `creator_id` (chỉ trong danh sách); công cụ mới `campaign_context` (tiêu chí, điểm thành phần, ngân sách, chi phí ước tính, bằng chứng S2 từng KOC). Prompt: điểm/ngân sách là kết quả hệ thống, chỉ giải thích, không tự chấm lại; muốn đổi thì người dùng nhắn để `RERUN_FROM` chạy lại.
  - **(3) Ý định mới `web_info`** (hỏi thông tin ngoài dữ liệu: phốt, tiểu sử, thương hiệu…) → agent tìm web như P5c. `out_of_scope` giờ chỉ còn YÊU CẦU việc hệ thống không làm (Shopee, booking…).
  - Agent dùng chung: `runAgent()` trong `chat-creator-agent.ts` (chat KOC = `INTRO_KOC + RULES`, chiến dịch = `INTRO_CAMPAIGN + RULES`); tiêu đề thẻ ghi tên KOC đang đọc ("Lấy tổng quan kênh · Ánh Ốc").
  - Giao diện chiến dịch (`chat-thread.tsx`): tin nhắn agent hiện bằng `AgentMessage` (xuất từ `ask-bar.tsx`) — "Quá trình xử lý · N bước" thu gọn, bảng `campaign_context` (avatar, điểm, điểm thành phần, ngân sách), chip nguồn (bấm tự mở mục thu gọn), gợi ý hỏi tiếp điền vào ô nhập. Không stream (server action) — chờ ~30-40 s.
  - Thử (dryRun, chiến dịch kem chống nắng): "vì sao KOC #1 mà không phải dự phòng #1?" → 32 s, $0,19: so 4 điểm thành phần qua `calc`, đọc dữ liệu thật cả hai KOC, nêu rủi ro phụ thuộc thương hiệu ASUNMEE; "KOC đứng đầu có phốt không?" → `web_info`, 3 lần tìm + 1 đọc trang, 41 s, $0,20, trả "chưa thấy" kèm nguồn, tách vấn đề thương hiệu khỏi KOC; "chạy trên Shopee được không?" → `out_of_scope`, $0,001.

**Trạng thái: ✅ XONG 2026-11-03** — người dùng test trên giao diện và nghiệm thu (P1–P5d). Còn lại P6 là việc sau, không chặn.

- [ ] **P6. Đo & so sánh** (việc sau): chạy câu danh mục/sản phẩm cho @phuongsena, đối chiếu từng số với ảnh Kalopilot; chạy `npm run test:koc`; ghi thời gian + chi phí vào `05-benchmark.md`. Sau đó bật cache câu trả lời.

## 4. Chi phí dự kiến
Sonnet, 5–8 lần gọi công cụ: ~$0,05–0,15/câu, 40–90s. Không gọi Kalodata (chỉ đọc DB đã crawl), không tốn credit.
