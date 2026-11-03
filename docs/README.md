# Mục lục tài liệu

Cập nhật 2026-11-03. Chia làm hai nhóm vì phần lớn file ở đây là **nhật ký xây dựng** — giữ để tra
"vì sao làm thế", nhưng không phải mô tả hệ thống hiện tại.

## Đang đúng với hệ thống hiện tại

| File | Nội dung |
|---|---|
| [13-tola.md](13-tola.md) | **Trợ lý Tola — cách vận hành**, có sơ đồ: 4 loại câu hỏi, một lượt hỏi đi qua đâu, bộ công cụ & phạm vi, chống bịa, lịch sử hội thoại |
| [12-tim-koc.md](12-tim-koc.md) | Câu hỏi "tìm KOC" được giải quyết thế nào, từng bước, thang điểm, ngưỡng, **chỗ dễ vỡ khi kiểm thử** |
| [11-campaign-flow.md](11-campaign-flow.md) | Pipeline S2→S5 (chấm điểm, đọc nội dung, xem video, chọn & chia tiền) + `allocate_budget` |
| [10-koc-agent.md](10-koc-agent.md) | Nền móng agent: công cụ đọc DB, MCP server, evidence theo phiên. §P7 (giao diện chat chiến dịch) đã lỗi thời, có đánh dấu |
| [04-data-model.md](04-data-model.md) | Collection MongoDB |
| [03-kalodata.md](03-kalodata.md), [07-kalodata-web.md](07-kalodata-web.md) | Nguồn dữ liệu Kalodata, cách crawl |
| [06-server-setup.md](06-server-setup.md) | Máy chủ, Mongo, tunnel |
| [02-architecture.md](02-architecture.md) | Toàn cảnh kiến trúc + bảng thành phần (đã cập nhật phần Tola) |
| [HANDOFF-tola.md](HANDOFF-tola.md) | Trạng thái & việc tiếp theo của nhánh `feat/tola-assistant-ui` |

## Nhật ký — giữ để tra lịch sử

| File | Lưu ý |
|---|---|
| [00-problem-statement.md](00-problem-statement.md) | Bài toán ban đầu |
| [01-plan.md](01-plan.md) | Checklist từng bước; phần chat chiến dịch (`chat.ts`, `handleTurn`, `RERUN_FROM`) đã bị thay |
| [05-benchmark.md](05-benchmark.md) | Đo chi phí/thời gian bản tháng 11-2026 |
| [07-test-plan.md](07-test-plan.md), [08-test-koc-chat.md](08-test-koc-chat.md) | Bộ test của **luồng khối cũ** ở chat hồ sơ KOC (`npm run test:koc`) |
| [09-handover.md](09-handover.md) | Bàn giao luồng khối cũ; vấn đề mở trong đó thuộc luồng cũ |

## Sơ đồ (`diagrams/`)

| Còn hiệu lực | Nội dung |
|---|---|
| `03-pipeline` | Pipeline S2→S5, lease, cache, resumable |
| `07-tola` | Tola: 4 loại câu hỏi → công cụ → kiểm đầu ra |
| `08-tola-luot-hoi` | Sequence một lượt hỏi: client → route NDJSON → pipeline → agent → verify → lưu |
| `09-tola-cong-cu` | Bộ công cụ MCP, phạm vi theo biến môi trường, 3 công cụ GHI |

| Chỉ còn giá trị lịch sử | Vì sao |
|---|---|
| `01-vong-doi`, `02-tao-campaign` | Vòng đời + modal 2 bước của trang `/campaigns` đã bỏ |
| `04-luot-chat`, `06-vong-khep-kin` | Chat trên trang chiến dịch (`handleTurn`, `RERUN_FROM`) đã bỏ |
| `05-agent-ngan-sach` | Vẫn đúng phần `allocate_budget`, nhưng bối cảnh là trang chiến dịch cũ |

Render lại sơ đồ sau khi sửa `.mmd`:

```bash
npx -y @mermaid-js/mermaid-cli@11 -i docs/diagrams/<ten>.mmd -o docs/diagrams/<ten>.png -c docs/diagrams/theme.json -b white -s 2
```
