# 01 · Khởi động dự án

DETOLA — AI KOC Discovery: tìm, chấm điểm và đề xuất KOC TikTok (mỹ phẩm, thị trường VN) từ dữ liệu
Kalodata, có trợ lý AI **Tola** trả lời mọi câu hỏi bằng dữ liệu thật trong DB.

| Tài liệu | Nội dung |
|---|---|
| `01-getting-started.md` | (file này) cài đặt, chạy local, lệnh hay dùng |
| [`02-tola-ai.md`](02-tola-ai.md) | Tola vận hành thế nào: luồng xử lý, code vs LLM, model, cache |
| [`03-database.md`](03-database.md) | Các collection trong MongoDB, quan hệ, cách setup DB |
| [`04-crawl.md`](04-crawl.md) | Thu thập dữ liệu từ Kalodata |

---

## 1. Yêu cầu

| Thành phần | Ghi chú |
|---|---|
| Node.js 20+ | đang dùng v20.20 |
| Claude Code CLI (`claude`) | **toàn bộ LLM chạy qua CLI** (`claude -p`), không dùng API key. Cài và đăng nhập trước: `claude` → login. Đường dẫn khác thì đặt `CLAUDE_CLI_PATH`. |
| SSH tới server DB | MongoDB nằm trên server `66.42.50.32`, truy cập qua SSH tunnel (cần SSH key của `root`) |
| Playwright Chromium | chỉ cần khi crawl: `npx playwright install chromium` |

## 2. Cài đặt

```bash
npm install
cp .env.example .env.local    # rồi điền giá trị thật
```

Biến môi trường trong `.env.local` (không commit file này):

| Biến | Ý nghĩa |
|---|---|
| `MONGODB_URI` | `mongodb://detola:<password>@127.0.0.1:27117/detola?authSource=detola` — cổng **27117** là đầu tunnel |
| `MONGODB_DB` | `detola` |
| `CLAUDE_CLI_PATH` | mặc định `claude` |
| `KALODATA_WEB_USERNAME` / `KALODATA_WEB_PASSWORD` | tài khoản Kalodata riêng cho crawler (không dùng chung tài khoản đang mở trên trình duyệt) |
| `KALODATA_WEB_SESSION` | file lưu phiên đăng nhập, mặc định `.auth/kalodata-crawler.json` |
| `KALODATA_WEB_INTERVAL_MS`, `KALODATA_WEB_MAX_PER_HOUR`, `KALODATA_WEB_MAX_PER_DAY` | nhịp và trần request của crawler — xem [04-crawl.md](04-crawl.md) |
| `KALODATA_API_ENABLED` | **giữ `0`**. Open API tốn credit, đã tắt theo quyết định 2026-11-01 |
| `KALODATA_API_KEY`, `KALODATA_BASE_URL` | chỉ dùng cho Open API (đang tắt) |

## 3. Chạy local

```bash
# Terminal 1 — mở tunnel tới MongoDB (giữ nguyên terminal này)
npm run db:tunnel

# Terminal 2
npm run db:ping     # kiểm tra kết nối: "MongoDB ok=1 db=detola collections=N"
npm run dev         # http://localhost:3000
```

Trên Windows có thể cài tunnel tự chạy lại khi rớt (scheduled task `DETOLA-db-tunnel`, log ở `.cache/db-tunnel.log`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-tunnel.ps1 -Install
```

DB mới tinh: chạy `npm run db:init` một lần để tạo index — chi tiết ở [03-database.md](03-database.md).

## 4. Các trang

| Đường dẫn | Nội dung |
|---|---|
| `/kocs` | Danh sách nhà sáng tạo (lọc, sắp xếp, yêu thích) |
| `/kocs/[id]` | Hồ sơ một KOC: chỉ số, sản phẩm, video; thanh hỏi Tola ở đáy trang (tự gắn `@handle` của KOC) |
| `/tola`, `/tola/[id]` | Trợ lý Tola: hội thoại mới / mở lại hội thoại cũ. Lịch sử dùng chung với popup ở trang KOC |

## 5. Lệnh hay dùng

| Lệnh | Việc | Tốn tiền? |
|---|---|---|
| `npm run dev` / `build` / `start` | chạy web | — |
| `npm run db:tunnel` / `db:ping` / `db:init` | tunnel, kiểm tra, tạo index | — |
| `npm run db:inspect` / `db:audit` | xem nhanh dữ liệu / kiểm tra độ đầy đủ | — |
| `npm run crawl:worker` | bật **worker crawl chạy liên tục** dưới pm2 (máy local, tự bật lại khi đăng nhập Windows) — xem [04-crawl.md](04-crawl.md) | không, có rủi ro khóa tài khoản |
| `npm run crawl:web` | crawl qua phiên web Kalodata | không, nhưng có rủi ro khóa tài khoản — đọc [04-crawl.md](04-crawl.md) trước |
| `npm run crawl:shops` | điền tên shop | như trên |
| `npm run kalo:login` / `kalo:discover` / `kalo:call` | đăng nhập, dò endpoint, gọi thử một endpoint web | như trên |
| `npm run reset:test -- --yes` | xóa dữ liệu test: chiến dịch, điểm, evidence, `llm_cache`, `ai_assessments`, chat | — |
| `npm run koc:tool` / `koc:agent` / `koc:chat` | thử công cụ agent / agent / hỏi đáp KOC từ terminal | token Claude |
| `npm run bench`, `npm run s5` | benchmark chiến dịch, chạy riêng bước đề xuất | token Claude |
| `npm run crawl`, `npm run avatars`, `npm run probe` | **Open API — tốn credit, đang tắt**. Không chạy khi chưa được duyệt | **có** |

## 6. Quy tắc bắt buộc

- **Mọi con số do code tính từ DB**, LLM không được tự sinh số.
- Lý do LLM viết chỉ được trích `evidence_id` có thật; validator loại lý do thiếu/sai bằng chứng.
- Độ tuổi/giới tính khán giả và chi phí luôn ghi "ước tính" kèm `confidence` và evidence gốc.
- Không bật `KALODATA_API_ENABLED`, không chạy script Open API khi chưa có đồng ý rõ ràng (nêu endpoint, số lần gọi, credit ước tính, số dư hiện tại).

## 7. Deploy (https://bananacinema.com)

Web chạy **cùng server với MongoDB** (`66.42.50.32`, Ubuntu 24.04).

```
Internet ─▶ Cloudflare (DNS) ─▶ nginx :80/:443 ─▶ pm2 "detola-web" (next start, 127.0.0.1:3000)
                                                      ├─▶ MongoDB 127.0.0.1:27017
                                                      └─▶ claude CLI (user detola) ─▶ Anthropic
```

**Deploy bản mới** (từ máy dev, gốc repo — đẩy cả thay đổi chưa commit):
```bash
bash scripts/deploy.sh      # đóng gói → /srv/detola → npm ci → next build → pm2 reload
```

| Thành phần | Ở đâu |
|---|---|
| Code | `/srv/detola` (chủ sở hữu `detola`) |
| Biến môi trường | `/srv/detola/.env.local` — bản **riêng** của server (Mongo `127.0.0.1:27017`, không có tài khoản crawler). `deploy.sh` không ghi đè |
| Tiến trình | pm2 của user `detola`, cấu hình `ecosystem.config.cjs`; tự chạy khi khởi động máy (`systemctl status pm2-detola`) |
| Log | `su - detola -c "pm2 logs detola-web"` |
| nginx | `/etc/nginx/sites-available/detola` — `proxy_buffering off` + timeout 900s cho luồng NDJSON của Tola |
| SSL | certbot (`certbot --nginx -d bananacinema.com -d www.bananacinema.com`), tự gia hạn |
| Tường lửa | ufw: 22, 80/443 (`Nginx Full`), 27017 |
| Phụ thuộc hệ thống | Node 20, nginx, certbot, pm2, ffmpeg (S4 cắt khung hình), Claude CLI |

**Claude CLI trên server** phải đăng nhập bằng user `detola` (Tola gọi `claude` dưới user này):
```bash
ssh root@66.42.50.32
su - detola
claude          # làm theo hướng dẫn đăng nhập, xong gõ /exit
```

> **Giữ Claude CLI trên server cùng đời với máy dev.** Bản cũ (2.1.197) với `--tools ""` tắt luôn cả công cụ MCP → lượt "chỉ DB" của Tola không gọi được công cụ nào, trả lời rỗng (đã gặp 2026-11-04). Cập nhật: `ssh root@66.42.50.32 "npm i -g @anthropic-ai/claude-code@latest && claude --version"`.

> Lỗi chỉ hiện khi build (dev không báo): dữ liệu theo request (`params`, `searchParams`, Mongo) đọc
> ngoài `<Suspense>` → `next build` dừng với "uncached data during prerendering". Chạy `npm run build`
> trước khi deploy nếu sửa trang.

## 8. Cấu trúc thư mục

```
src/app/            trang + route API (Next.js 16 App Router, cacheComponents bật)
  api/tola/ask/     route hỏi Tola (stream NDJSON)
src/components/     UI (tola-chat, tola-history, ask-bar = popup ở trang KOC)
src/lib/
  chat-creator-agent.ts  agent Tola (askTola)
  tola-deep.ts           phân loại câu hỏi + phân tích sâu S2→S5
  pipeline/ scoring/     các bước chọn KOC, chấm điểm
  koc-data/tools.ts      công cụ đọc DB cho agent
  llm/claude.ts          gọi Claude CLI + cache
  evidence/              chống bịa: kiểm tra evidence id
  db/                    kết nối Mongo + tên collection
  kalodata/              client web + Open API
scripts/            crawler, công cụ DB, test agent, MCP server "koc"
docs/kalodata/openapi.json   đặc tả Open API của Kalodata (tham chiếu cho types)
```

> Lưu ý Next.js 16: API khác bản cũ — đọc `node_modules/next/dist/docs/` trước khi viết code. Dữ liệu
> đọc theo request (Mongo) phải nằm trong `<Suspense>`, nếu không sẽ gặp lỗi "Blocking Route".
