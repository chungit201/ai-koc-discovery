# DETOLA — AI KOC Discovery · Project Overview

## 1. Mục tiêu dự án

Xây dựng hệ thống **AI KOC Discovery** giúp thương hiệu tìm và đề xuất KOC TikTok phù hợp cho chiến dịch, nghiên cứu được số lượng lớn KOC với chi phí AI tối ưu.

## 2. Use case chính

Một thương hiệu mỹ phẩm Việt Nam cần tìm **5 KOC TikTok** để quảng bá **kem chống nắng**:

- Khách hàng mục tiêu: Nữ, 18–30 tuổi.
- Ngân sách chiến dịch: 30 triệu VNĐ.
- Đánh giá KOC dựa trên dữ liệu hiệu suất, nội dung và hình ảnh/video.
- Mỗi đề xuất phải kèm lý do và bằng chứng cụ thể.

## 3. Yêu cầu hệ thống

| Hạng mục | Yêu cầu |
|---|---|
| **Chất lượng** | Đề xuất KOC phù hợp dựa trên bằng chứng, có phân tích video bằng AI. |
| **Token efficiency** | Tối ưu token, số lần gọi model và chi phí mà không giảm chất lượng. |
| **Scalability** | Nghiên cứu **50–500 KOC có đầy đủ thông tin** (audience, doanh thu theo ngày, sản phẩm, video) mỗi chiến dịch — không cần crawl toàn ngành; bản demo đề xuất 5 KOC. |
| **Reliability** | Lưu tiến độ, tự tiếp tục khi quá trình bị gián đoạn. |

## 4. Nguồn dữ liệu

- **Kalodata** — dữ liệu creator, video, hiệu suất TikTok Shop (thông tin truy cập đặt trong `.env.local`, không commit).

## 5. Chỉ số đánh giá

Chất lượng đề xuất · Chi phí AI · Thời gian xử lý · Khả năng phục hồi.

## 6. Sản phẩm đầu ra

1. **Source code** trên GitHub.
2. **Working prototype** — quy trình nghiên cứu và đề xuất KOC end-to-end.
3. **Architecture** — sơ đồ + giải thích quyết định chính (`docs/02-architecture.md`).
4. **Benchmark** — kết quả 5 KOC, bằng chứng, token/cost, thời gian xử lý (`docs/05-benchmark.md`).
5. **README** — hướng dẫn chạy, giới hạn hiện tại, hướng mở rộng.
