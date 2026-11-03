import "server-only";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";

/**
 * **Một nguồn sự thật** cho số liệu kênh của một KOC — mọi chỗ (bằng chứng chat, bảng báo cáo,
 * công cụ của agent) đều đọc qua đây để các con số luôn khớp nhau.
 *
 * Lỗi đã gặp (2026-11-02, @phuongsena): cùng một câu trả lời có 3 con số doanh thu — 30,3 tỉ (scope
 * mỹ phẩm của `queryList`), 32,7 tỉ (cộng 55 sản phẩm đã crawl), 34,5 tỉ (cả kênh) — và 2 số đơn
 * (19,9k / 23k). Tỉ trọng danh mục chia cho tổng sản phẩm thay vì doanh thu kênh, nên "Chăm sóc da
 * 72%" trong khi Kalopilot nói đúng là ~92% thuộc nhóm Chăm sóc sắc đẹp.
 *
 * Quy ước: **mẫu số của mọi tỉ trọng là doanh thu kênh** (`ChannelTotals.revenue`, scope `all`).
 */

export interface ChannelTotals {
  revenue: number;
  orders: number;
  /** Đơn giá bình quân do Kalodata tính. */
  aov: number;
  live_revenue: number;
  video_revenue: number;
  /** Doanh thu qua thẻ sản phẩm/shop, không qua live hay video. */
  shop_revenue: number;
  live_views: number;
  video_views: number;
  live_number: number | null;
  video_number: number | null;
  /** Doanh thu trên 1.000 lượt xem live. */
  live_gpm: number | null;
  /** Số sản phẩm KOC đã bán trong kỳ (theo Kalodata), có thể nhiều hơn số đã crawl. */
  product_number: number | null;
  daily: { day: string; revenue: number; sales: number; live_revenue: number; video_revenue: number }[];
  date_range: string;
  /** `_id` các bản ghi `creator_metrics` đã dùng — làm nguồn cho evidence. */
  refs: string[];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Ưu tiên `creator/detail` (số chính xác tới đồng, có GPM/số phiên live); thiếu thì dùng
 * `web:creator/detail/total` (số đã làm tròn từ chuỗi "₫34,51tỉ" nhưng có chuỗi theo ngày). Cả hai
 * đều phải là scope `all` — scope theo danh mục chỉ là một phần doanh thu.
 */
export async function channelTotals(creatorId: string): Promise<ChannelTotals | null> {
  const db = await getDb();
  const [detail, web] = await Promise.all([
    db.collection(C.creatorMetrics).findOne({ creator_id: creatorId, source: "creator/detail", category_scope: "all" }, { sort: { updated_at: -1 } }),
    db.collection(C.creatorMetrics).findOne({ creator_id: creatorId, source: "web:creator/detail/total", category_scope: "all" }, { sort: { updated_at: -1 } }),
  ]);
  const main = detail ?? web;
  if (!main) return null;
  const pick = (k: string) => (detail && typeof detail[k] === "number" ? (detail[k] as number) : num(web?.[k]));
  const daily = ((web?.daily as Record<string, unknown>[]) ?? []).map((d) => ({
    day: String(d.day),
    revenue: num(d.revenue),
    sales: num(d.sales),
    live_revenue: num(d.live_revenue),
    video_revenue: num(d.video_revenue),
  }));
  return {
    revenue: pick("revenue"),
    orders: pick("sales_volume"),
    aov: pick("unit_price"),
    live_revenue: pick("live_revenue"),
    video_revenue: pick("video_revenue"),
    shop_revenue: num(web?.shop_revenue),
    live_views: pick("live_views"),
    video_views: pick("video_views"),
    live_number: numOrNull(detail?.live_number),
    video_number: numOrNull(detail?.video_number),
    live_gpm: numOrNull(detail?.live_gpm),
    product_number: numOrNull(detail?.product_number),
    daily,
    date_range: String(web?.date_range ?? main.date_range ?? ""),
    refs: [detail, web].filter(Boolean).map((r) => String(r!._id)),
  };
}

export interface ProductFact {
  product_id: string;
  name: string;
  revenue: number;
  sales_volume: number;
  unit_price: number;
  cat1: string;
  cat2: string;
  cat3: string;
  seller_name: string;
}

/**
 * Sản phẩm KOC đã bán, **gộp theo `product_id`** (`creator_products` có một dòng cho mỗi
 * `(product_id, date_range)` nên KOC crawl 2 lần sẽ bị cộng trùng nếu không gộp), sắp theo doanh thu.
 */
export async function productFacts(creatorId: string): Promise<ProductFact[]> {
  const db = await getDb();
  const rows = await db
    .collection(C.creatorProducts)
    .aggregate<Record<string, unknown>>([
      { $match: { creator_id: creatorId } },
      { $group: { _id: "$product_id", revenue: { $max: "$revenue" }, sales_volume: { $max: "$sales_volume" }, unit_price: { $max: "$unit_price" } } },
      { $sort: { revenue: -1 } },
      { $lookup: { from: C.products, localField: "_id", foreignField: "_id", as: "p" } },
      {
        $project: {
          revenue: 1,
          sales_volume: 1,
          unit_price: 1,
          name: { $first: "$p.name" },
          seller_name: { $first: "$p.seller_name" },
          cat1: { $first: "$p.category_l1.category_name" },
          cat2: { $first: "$p.category_l2.category_name" },
          cat3: { $first: "$p.category_l3.category_name" },
        },
      },
    ])
    .toArray();
  const s = (v: unknown) => String(v ?? "").trim();
  return rows.map((r) => ({
    product_id: String(r._id),
    name: s(r.name) || "Sản phẩm không rõ tên",
    revenue: num(r.revenue),
    sales_volume: num(r.sales_volume),
    unit_price: num(r.unit_price),
    cat1: s(r.cat1),
    cat2: s(r.cat2),
    cat3: s(r.cat3),
    seller_name: s(r.seller_name),
  }));
}

export type CategoryLevel = 1 | 2 | 3;
export const UNCATEGORISED = "Chưa phân loại";

export interface CategoryShare {
  name: string;
  revenue: number;
  /** Tỉ trọng trên **doanh thu kênh**. */
  share: number;
  products: number;
  /** Nhóm con bán chạy nhất (chỉ có khi level < 3). */
  sub: string[];
}

/** Gộp doanh thu sản phẩm theo danh mục cấp `level`; tỉ trọng chia cho doanh thu kênh. */
export function categoryBreakdown(products: ProductFact[], level: CategoryLevel, channelRevenue: number): CategoryShare[] {
  const key = (p: ProductFact) => (level === 1 ? p.cat1 : level === 2 ? p.cat2 : p.cat3) || UNCATEGORISED;
  const subKey = (p: ProductFact) => (level === 1 ? p.cat2 : p.cat3);
  const by = new Map<string, { revenue: number; products: number; sub: Map<string, number> }>();
  for (const p of products) {
    const e = by.get(key(p)) ?? { revenue: 0, products: 0, sub: new Map() };
    e.revenue += p.revenue;
    e.products++;
    const sk = subKey(p);
    if (level < 3 && sk) e.sub.set(sk, (e.sub.get(sk) ?? 0) + p.revenue);
    by.set(key(p), e);
  }
  return [...by.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([name, e]) => ({
      name,
      revenue: e.revenue,
      share: channelRevenue ? e.revenue / channelRevenue : 0,
      products: e.products,
      sub: [...e.sub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n),
    }));
}

/**
 * Tỉ trọng trên doanh thu kênh. Không có tổng kênh (KOC chưa crawl trang chi tiết) thì đành chia cho
 * tổng sản phẩm — `coverage` khi đó là null để nơi dùng nói rõ mẫu số.
 */
export function denominator(totals: ChannelTotals | null, products: ProductFact[]): { revenue: number; coverage: number | null } {
  const sum = products.reduce((a, p) => a + p.revenue, 0);
  if (totals?.revenue) return { revenue: totals.revenue, coverage: Math.min(1, sum / totals.revenue) };
  return { revenue: sum, coverage: null };
}
