import type { Db } from "mongodb";
import { C } from "../db/collections";
import type { KalodataWebClient } from "../kalodata/web-client";
import { parseVnNumber as n } from "../kalodata/parse";

/**
 * Sản phẩm KOC đã bán (`/creator/detail/searchProducts`, 50/trang, theo doanh thu) → `products` +
 * `creator_products`. Dùng chung cho `crawl-web.ts` và `crawl-video-products.ts`.
 *
 * Vì sao cần nhiều trang: KOC lớn bán hàng trăm sản phẩm (Phương Sena 184) mà trang 1 chỉ có top 50.
 * Video gắn sản phẩm nằm ngoài top 50 thì DB chỉ có MÃ sản phẩm — thẻ hover ở bảng video không có tên/giá.
 */
export const PRODUCTS_PAGE_SIZE = 50;
/** Trần số trang mỗi KOC (≈ 200 sản phẩm) — đủ phủ sản phẩm gắn video mà không đốt hạn mức. */
export const PRODUCTS_MAX_PAGES = 4;

export async function saveCreatorProducts(db: Db, creatorId: string, dateRange: string, rows: Record<string, string>[]): Promise<void> {
  if (!rows.length) return;
  const now = new Date();
  await db.collection(C.products).bulkWrite(
    rows.map((p) => ({
      updateOne: { filter: { _id: String(p.id) as never }, update: { $set: { name: p.product_title, seller_id: p.seller_id, updated_at: now } }, upsert: true },
    })),
  );
  await db.collection(C.creatorProducts).bulkWrite(
    rows.map((p) => ({
      updateOne: {
        filter: { creator_id: creatorId, product_id: String(p.id), date_range: dateRange },
        update: { $set: { source: "web", revenue: n(p.revenue), sales_volume: n(p.sale), unit_price: n(p.unit_price), updated_at: now } },
        upsert: true,
      },
    })),
  );
  // Sản phẩm mới mà shop của nó đã có tên trong danh bạ `shops` → điền luôn tên shop
  const sellerIds = [...new Set(rows.map((p) => String(p.seller_id ?? "")).filter(Boolean))];
  const shops = await db.collection(C.shops).find({ _id: { $in: sellerIds as never[] }, name: { $nin: [null, ""] } }, { projection: { name: 1 } }).toArray();
  if (shops.length)
    await db.collection(C.products).bulkWrite(
      shops.map((s) => ({
        updateMany: {
          filter: { seller_id: String(s._id), $or: [{ seller_name: { $exists: false } }, { seller_name: null }, { seller_name: "" }] },
          update: { $set: { seller_name: s.name } },
        },
      })),
    );
}

/** Mã sản phẩm gắn trong video của KOC mà `products` chưa có. */
export async function missingVideoProducts(db: Db, creatorId: string): Promise<string[]> {
  const vids = await db.collection(C.videos).find({ creator_id: creatorId }, { projection: { product_ids: 1 } }).toArray();
  const ids = [...new Set(vids.flatMap((v) => (v.product_ids as string[]) ?? []))];
  if (!ids.length) return [];
  const have = new Set((await db.collection(C.products).find({ _id: { $in: ids as never[] } }, { projection: { _id: 1 } }).toArray()).map((p) => String(p._id)));
  return ids.filter((id) => !have.has(id));
}

/**
 * Lấy THÊM trang sản phẩm (từ `fromPage`) cho tới khi mọi sản phẩm gắn video đã có trong DB, hết
 * sản phẩm, hoặc chạm `PRODUCTS_MAX_PAGES`. Trả về số request đã gửi — chỉ tốn khi thật sự thiếu.
 */
export async function fillVideoProducts(
  web: KalodataWebClient,
  db: Db,
  creatorId: string,
  range: { startDate: string; endDate: string },
  fromPage = 2,
): Promise<{ pages: number; stillMissing: number }> {
  const dateRange = `${range.startDate}~${range.endDate}`;
  let pages = 0;
  for (let page = fromPage; page <= PRODUCTS_MAX_PAGES; page++) {
    if (!(await missingVideoProducts(db, creatorId)).length) break;
    const rows = await web.post<Record<string, string>[]>("/creator/detail/searchProducts", {
      id: creatorId,
      cateIds: [],
      ...range,
      sellerId: "",
      authority: true,
      pageNo: page,
      pageSize: PRODUCTS_PAGE_SIZE,
      sort: [{ field: "revenue", type: "DESC" }],
    });
    pages++;
    const list = Array.isArray(rows) ? rows : [];
    await saveCreatorProducts(db, creatorId, dateRange, list);
    if (list.length < PRODUCTS_PAGE_SIZE) break; // hết sản phẩm
  }
  return { pages, stillMissing: (await missingVideoProducts(db, creatorId)).length };
}
