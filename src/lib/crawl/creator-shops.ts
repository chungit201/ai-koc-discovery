import type { Db } from "mongodb";
import { C } from "../db/collections";
import type { KalodataWebClient } from "../kalodata/web-client";
import { parseVnNumber as n } from "../kalodata/parse";

/**
 * Tab "Cửa hàng" của một KOC trên Kalodata: các shop KOC hợp tác bán hàng trong khoảng ngày, kèm
 * doanh thu / đơn / số sản phẩm. Một request, cần tài khoản hội viên (premium).
 * Dùng chung cho `crawl-web.ts` (bước thứ 7 mỗi KOC) và `crawl-creator-shops.ts` (chạy bổ sung).
 *
 * Số trả về là chuỗi đã định dạng ("₫7,72tỉ", "4,52k") → đổi sang số khi lưu; bản gốc nằm ở raw_responses.
 */
export const COOP_SHOPS_PAGE_SIZE = 50;

export async function crawlCreatorShops(
  web: KalodataWebClient,
  db: Db,
  creatorId: string,
  range: { startDate: string; endDate: string },
): Promise<number> {
  const rows = await web.post<Record<string, string>[]>("/creator/detail/searchCooperativeShops", {
    id: creatorId,
    ...range,
    cateIds: [],
    sellerId: "",
    pageNo: 1,
    pageSize: COOP_SHOPS_PAGE_SIZE,
    sort: [{ field: "revenue", type: "DESC" }],
  });
  const list = Array.isArray(rows) ? rows : [];
  const dateRange = `${range.startDate}~${range.endDate}`;
  const now = new Date();

  // Ghi cả khi rỗng: một dòng đánh dấu "đã crawl, không có shop" để chạy bổ sung không hỏi lại
  await db.collection(C.creators).updateOne({ _id: creatorId as never }, { $set: { shops_updated_at: now, shops_date_range: dateRange } });
  if (!list.length) return 0;

  await db.collection(C.creatorShops).bulkWrite(
    list.map((s, i) => ({
      updateOne: {
        filter: { creator_id: creatorId, seller_id: String(s.seller_id), date_range: dateRange },
        update: {
          $set: {
            shop_name: s.shop_name ?? null,
            seller_type: s.seller_type ?? null,
            rank: i + 1,
            revenue: n(s.revenue),
            sales: n(s.sale),
            live_revenue: n(s.live_revenue),
            video_revenue: n(s.video_revenue),
            product_count: n(s.product_count),
            source: "web:creator/detail/searchCooperativeShops",
            updated_at: now,
          },
        },
        upsert: true,
      },
    })),
  );

  // Tên shop đi kèm → bổ sung danh bạ `shops` + tên shop trên sản phẩm (trước đây chỉ có khi shop lọt top ngành)
  const named = list.filter((s) => s.seller_id && s.shop_name);
  if (named.length) {
    await db.collection(C.shops).bulkWrite(
      named.map((s) => ({
        updateOne: {
          filter: { _id: String(s.seller_id) as never },
          update: { $set: { name: s.shop_name, seller_type: s.seller_type ?? null, updated_at: now } },
          upsert: true,
        },
      })),
    );
    await db.collection(C.products).bulkWrite(
      named.map((s) => ({
        updateMany: {
          filter: { seller_id: String(s.seller_id), $or: [{ seller_name: { $exists: false } }, { seller_name: null }, { seller_name: "" }] },
          update: { $set: { seller_name: s.shop_name } },
        },
      })),
    );
  }
  return list.length;
}
