import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";
import { compact, pct, vnd } from "../format";
import { analyseVideo, runS4 } from "../pipeline/s4-video";
import { runS5 } from "../pipeline/s5-recommend";
import { DEEPEN_MAX_KOCS, EXCLUDE_MAX_KOCS } from "../chat-rules";
import { topBrand } from "../evidence/creator";
import { categoryBreakdown, channelTotals, denominator, productFacts, UNCATEGORISED, type CategoryLevel } from "./facts";
import { EXCLUDE_LABELS, focusPattern } from "../scoring/rules";
import { scopeName } from "../industries";

/**
 * Bộ công cụ cho agent hỏi đáp về KOC (docs/02-tola-ai.md). Mỗi hàm **chỉ đọc DB**, trả
 * `{ summary, rows, numbers }` và ghi kết quả thành một bản ghi `evidence` của phiên chat — câu trả
 * lời cuối chỉ được trích các `evidence_id` này, và mọi con số trong câu phải có trong `numbers` của
 * một bằng chứng trong phiên (validator ở P5).
 *
 * Id bằng chứng tất định theo (phiên, công cụ, tham số): agent gọi lại cùng công cụ thì ra cùng id,
 * không đẻ bản ghi trùng.
 */
export const KOC_TOOLS_VERSION = "koc-tools-v1";

export interface ToolResult {
  evidence_id: string;
  tool: string;
  /** Câu tóm tắt tiếng Việt, số đã định dạng sẵn — agent đọc cái này. */
  summary: string;
  rows: Record<string, unknown>[];
  /** Số thô có tên — nguồn duy nhất mà `calc` và validator chấp nhận. */
  numbers: Record<string, number>;
}

export interface ToolCtx {
  creatorId: string;
  sessionId: string;
  /** Chat chiến dịch: agent được đọc ngữ cảnh chiến dịch này (`campaign_context`). */
  campaignId?: string;
}

type Args = Record<string, unknown>;
type Out = Omit<ToolResult, "evidence_id" | "tool"> & {
  type: "metric" | "product" | "video" | "audience";
  source: { collection: string; ref: string };
  /** Tiền LLM đã tiêu trong công cụ (chỉ `analyze_videos`) — cộng vào chi phí của lượt hỏi. */
  cost_usd?: number;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const int = (v: unknown, def: number, max: number) => Math.max(1, Math.min(max, Math.floor(Number(v) || def)));
/** Tỉ lệ làm tròn 1 chữ số thập phân, giống cách Kalopilot viết "95,8%". */
const p1 = (v: number) => `${(Math.round(v * 1000) / 10).toLocaleString("vi-VN")}%`;
const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  if (!v.length) return 0;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

// ── get_overview ──────────────────────────────────────────────────────────────
async function getOverview({ creatorId }: ToolCtx): Promise<Out> {
  const db = await getDb();
  const [creator, t, products] = await Promise.all([db.collection(C.creators).findOne({ _id: creatorId as never }), channelTotals(creatorId), productFacts(creatorId)]);
  if (!creator) throw new Error(`Không có KOC ${creatorId}`);
  const followers = num(creator.followers);
  const audience = creator.audience as { gender_majority?: string; age_majority?: string } | undefined;
  const numbers: Record<string, number> = { followers };
  const parts = [`${String(creator.nickname ?? "")} (${String(creator.handle ?? "")}), ${compact(followers)} follower`];
  parts.push(creator.status === "INDEPENDENT" ? "nhà sáng tạo độc lập" : `gắn với shop ${String(creator.shop_name ?? "không rõ")}`);
  if (creator.mcn) parts.push(`MCN ${String(creator.mcn)}`);
  // Ngành của KOC (creators.industry / category_mix, do build-categories tính từ doanh thu theo danh mục)
  const ind = creator.industry as { l1?: { name: string }; l2?: { name: string; share: number } } | undefined;
  const mix = ((creator.category_mix as { name: string; level: number; share: number }[]) ?? []).filter((m) => m.level === 3).slice(0, 3);
  if (ind?.l1 && ind.l2)
    parts.push(
      `ngành chính ${ind.l1.name} › ${ind.l2.name} (${p1(ind.l2.share)} doanh thu sản phẩm đã phân loại)${mix.length ? `; loại bán nhiều nhất: ${mix.map((m) => `${m.name} ${p1(m.share)}`).join(", ")}` : ""}`,
    );
  if (t?.revenue) {
    Object.assign(numbers, {
      revenue: t.revenue,
      orders: t.orders,
      aov: t.aov,
      live_revenue: t.live_revenue,
      video_revenue: t.video_revenue,
      shop_revenue: t.shop_revenue,
      live_share: t.live_revenue / t.revenue,
      video_share: t.video_revenue / t.revenue,
      shop_share: t.shop_revenue / t.revenue,
      live_views: t.live_views,
      video_views: t.video_views,
    });
    // "30 ngày" viết bằng chữ số: model hay viết "doanh thu 30 ngày…", thiếu số 30 trong claim thì validator xoá oan cả câu
    parts.push(`doanh thu cả kênh 30 ngày (${t.date_range}) ${vnd(t.revenue)}, ${compact(t.orders)} đơn, đơn giá bình quân ${vnd(t.aov)}`);
    parts.push(
      `livestream ${vnd(t.live_revenue)} (${p1(t.live_revenue / t.revenue)}), video ${vnd(t.video_revenue)} (${p1(t.video_revenue / t.revenue)}), thẻ sản phẩm/shop ${vnd(
        t.shop_revenue,
      )} (${p1(t.shop_revenue / t.revenue)})`,
    );
    if (t.live_number) (numbers.live_number = t.live_number), parts.push(`${t.live_number} phiên live`);
    // Dữ liệu crawl web không có sẵn live_gpm (chỉ Open API có) → tính từ doanh thu live / lượt xem live
    const liveGpm = t.live_gpm || (t.live_views ? (t.live_revenue / t.live_views) * 1000 : 0);
    if (liveGpm) (numbers.live_gpm = liveGpm), parts.push(`doanh thu trên 1.000 lượt xem live ${vnd(liveGpm)}`);
    if (t.video_views) {
      numbers.video_gpm = (t.video_revenue / t.video_views) * 1000;
      parts.push(`video ${compact(t.video_views)} lượt xem, doanh thu trên 1.000 lượt xem video ${vnd(numbers.video_gpm)}`);
    }
    if (t.orders && t.live_views) (numbers.live_conversion = t.orders / t.live_views), parts.push(`tỉ lệ chốt đơn trên lượt xem live ${pct(t.orders / t.live_views)}`);
    if (t.product_number) (numbers.product_number = t.product_number), parts.push(`bán ${t.product_number} sản phẩm khác nhau`);
  } else parts.push("chưa có số liệu tổng kênh (trang chi tiết KOC chưa được thu thập)");
  // Thương hiệu bán nhiều nhất — đủ để agent dùng làm từ khoá tìm web mà không phải gọi list_products
  const brand = topBrand(products);
  if (brand) parts.push(`thương hiệu xuất hiện nhiều nhất trong sản phẩm đã bán: ${brand.name} (${brand.count}/${products.length} sản phẩm)`);
  if (audience?.gender_majority || audience?.age_majority)
    parts.push(
      `khán giả đa số ${audience.gender_majority === "female" ? "nữ" : audience.gender_majority === "male" ? "nam" : "không rõ giới tính"}${
        audience.age_majority ? `, tuổi ${audience.age_majority}` : ""
      } (ước tính từ Kalodata)`,
    );
  return {
    type: "metric",
    summary: parts.join("; "),
    rows: [],
    numbers,
    source: { collection: C.creatorMetrics, ref: t?.refs[0] ?? creatorId },
  };
}

// ── list_products ─────────────────────────────────────────────────────────────
async function listProducts({ creatorId }: ToolCtx, args: Args): Promise<Out> {
  const db = await getDb();
  const limit = int(args.limit, 10, 50);
  const [t, products] = await Promise.all([channelTotals(creatorId), productFacts(creatorId)]);
  const { revenue: denom, coverage } = denominator(t, products);
  const base = coverage === null ? "tổng sản phẩm đã thu thập" : "doanh thu kênh";

  /**
   * Lọc theo loại sản phẩm. Không có tham số này thì công cụ luôn trả TOP THEO DOANH THU của cả
   * kênh — hỏi về kem chống nắng mà bảng toàn cushion, phấn mắt, son, trông như lỗi. Dùng chung
   * `focusPattern` với S2 nên cùng bảng đồng nghĩa.
   */
  const want = String(args.product ?? "").trim();
  const re = want ? focusPattern(COSMETICS_SCOPE, want) : null;
  const matched = re ? products.filter((p) => re.test(p.name ?? "")) : products;
  const top = matched.slice(0, limit);
  if (re && !top.length)
    return {
      type: "product",
      summary: `KOC này không có sản phẩm nào thuộc nhóm '${want}' trong ${products.length} sản phẩm đã thu thập. Doanh thu của họ đến từ nhóm khác — gọi lại không kèm product để xem họ bán gì.`,
      rows: [],
      numbers: { matched: 0, products_total: products.length },
      source: { collection: C.creatorProducts, ref: creatorId },
    };
  // Video đã gắn từng sản phẩm — bằng chứng "bán qua nội dung nào", như danh sách video của Kalopilot
  const vids = await db
    .collection(C.videos)
    .find({ creator_id: creatorId, product_ids: { $in: top.map((p) => p.product_id) } }, { projection: { product_ids: 1, revenue: 1 } })
    .toArray();
  const vidBy = new Map<string, { n: number; revenue: number }>();
  for (const v of vids)
    for (const id of (v.product_ids as string[]) ?? []) {
      const e = vidBy.get(id) ?? { n: 0, revenue: 0 };
      e.n++;
      e.revenue += num(v.revenue);
      vidBy.set(id, e);
    }
  const sumTop = top.reduce((a, p) => a + p.revenue, 0);
  const rows = top.map((p, i) => ({
    rank: i + 1,
    product_id: p.product_id,
    name: p.name,
    cat1: p.cat1 || UNCATEGORISED,
    cat2: p.cat2,
    cat3: p.cat3,
    price: p.unit_price,
    orders: p.sales_volume,
    revenue: p.revenue,
    share: denom ? p.revenue / denom : 0,
    videos: vidBy.get(p.product_id)?.n ?? 0,
    video_revenue: vidBy.get(p.product_id)?.revenue ?? 0,
  }));
  const numbers: Record<string, number> = { products_crawled: products.length, top_revenue: sumTop, top_share: denom ? sumTop / denom : 0, channel_revenue: denom };
  if (coverage !== null) numbers.coverage = coverage;
  rows.forEach((r) => {
    numbers[`p${r.rank}_revenue`] = r.revenue;
    numbers[`p${r.rank}_share`] = r.share;
    numbers[`p${r.rank}_orders`] = r.orders;
    numbers[`p${r.rank}_price`] = r.price;
  });
  const prices = products.map((p) => p.unit_price).filter((v) => v > 0).sort((a, b) => a - b);
  if (prices.length) Object.assign(numbers, { price_median: median(prices), price_min: prices[0], price_max: prices[prices.length - 1] });
  return {
    type: "product",
    summary:
      `Top ${rows.length}/${products.length} sản phẩm đã thu thập chiếm ${p1(numbers.top_share)} ${base}` +
      (coverage !== null ? `; toàn bộ ${products.length} sản phẩm thu thập = ${p1(coverage)} doanh thu kênh` : "") +
      (prices.length ? `; giá trung vị ${vnd(numbers.price_median)}, dải ${vnd(numbers.price_min)}–${vnd(numbers.price_max)}` : "") +
      `. ` +
      rows
        .map(
          (r) =>
            `#${r.rank} '${r.name.slice(0, 80)}' [${[r.cat1, r.cat2, r.cat3].filter(Boolean).join(" › ")}] ${vnd(r.revenue)} (${p1(r.share)}), ${compact(r.orders)} đơn, giá ${vnd(
              r.price,
            )}${r.videos ? `, ${r.videos} video gắn sản phẩm` : ""}`,
        )
        .join("; "),
    rows,
    numbers,
    source: { collection: C.creatorProducts, ref: creatorId },
  };
}

// ── category_breakdown ────────────────────────────────────────────────────────
async function categoryBreakdownTool({ creatorId }: ToolCtx, args: Args): Promise<Out> {
  const level = ([1, 2, 3].includes(Number(args.level)) ? Number(args.level) : 2) as CategoryLevel;
  const [t, products] = await Promise.all([channelTotals(creatorId), productFacts(creatorId)]);
  const { revenue: denom, coverage } = denominator(t, products);
  const cats = categoryBreakdown(products, level, denom);
  const rows = cats.map((c, i) => ({ rank: i + 1, name: c.name, revenue: c.revenue, share: c.share, products: c.products, sub: c.sub }));
  const numbers: Record<string, number> = { channel_revenue: denom };
  if (coverage !== null) numbers.coverage = coverage;
  rows.forEach((r) => {
    numbers[`c${r.rank}_revenue`] = r.revenue;
    numbers[`c${r.rank}_share`] = r.share;
    numbers[`c${r.rank}_products`] = r.products;
  });
  const unc = cats.find((c) => c.name === UNCATEGORISED);
  if (unc) numbers.uncategorised_share = unc.share;
  const label = level === 1 ? "ngành hàng cấp 1" : level === 2 ? "danh mục cấp 2" : "nhóm sản phẩm cấp 3";
  return {
    type: "product",
    summary:
      `Doanh thu theo ${label} (tỉ trọng trên ${coverage === null ? "tổng sản phẩm đã thu thập" : "doanh thu kênh"}): ` +
      rows.map((r) => `${r.name} ${vnd(r.revenue)} (${p1(r.share)}, ${r.products} sản phẩm${r.sub.length ? `; chính: ${r.sub.join(", ")}` : ""})`).join("; ") +
      (coverage !== null ? `. Dữ liệu sản phẩm phủ ${p1(coverage)} doanh thu kênh` : "") +
      (unc ? `; ${p1(unc.share)} thuộc sản phẩm chưa có danh mục trong dữ liệu` : ""),
    rows,
    numbers,
    source: { collection: C.creatorProducts, ref: creatorId },
  };
}

// ── list_videos ───────────────────────────────────────────────────────────────
async function listVideos({ creatorId }: ToolCtx, args: Args): Promise<Out> {
  const db = await getDb();
  const sort = args.sort === "revenue" ? "revenue" : "views";
  const limit = int(args.limit, 10, 30);
  const filter: Record<string, unknown> = { creator_id: creatorId };
  if (args.product_id) filter.product_ids = String(args.product_id);
  const [all, list] = await Promise.all([
    db.collection(C.videos).find({ creator_id: creatorId }, { projection: { views: 1, likes: 1, revenue: 1, sales: 1, is_ad: 1, ad_revenue_ratio: 1 } }).toArray(),
    db.collection(C.videos).find(filter).sort({ [sort]: -1 }).limit(limit).toArray(),
  ]);
  const pids = [...new Set(list.flatMap((v) => (v.product_ids as string[]) ?? []))];
  const names = new Map((await db.collection(C.products).find({ _id: { $in: pids as never[] } }, { projection: { name: 1 } }).toArray()).map((p) => [String(p._id), String(p.name ?? "")]));
  const rows = list.map((v, i) => ({
    rank: i + 1,
    video_id: String(v._id),
    title: String(v.title ?? ""),
    publish_date: String(v.publish_date ?? ""),
    duration_sec: num(v.duration_sec),
    views: num(v.views),
    likes: num(v.likes),
    comments: num(v.comments),
    shares: num(v.shares),
    revenue: num(v.revenue),
    orders: num(v.sales),
    is_ad: Boolean(v.is_ad),
    ad_cost: num(v.ad_cost),
    ad_roas: num(v.ad_roas),
    products: ((v.product_ids as string[]) ?? []).map((id) => ({ product_id: id, name: names.get(id) ?? "" })),
  }));
  const totViews = all.reduce((a, v) => a + num(v.views), 0);
  const totRev = all.reduce((a, v) => a + num(v.revenue), 0);
  /**
   * Thống kê TOÀN BỘ video đã thu thập (không chỉ top N): bao nhiêu video không ra đơn, doanh thu video
   * đến từ quảng cáo trả phí bao nhiêu (theo tỉ lệ doanh thu QC Kalodata ghi cho từng video). Đây là
   * phần trả lời "nội dung có tự bán được không" mà xem vài video không nói được.
   */
  const selling = all.filter((v) => num(v.revenue) > 0 || num(v.sales) > 0).length;
  const adRev = all.reduce((a, v) => a + (v.is_ad ? num(v.revenue) * num(v.ad_revenue_ratio) : 0), 0);
  const adVideoRev = all.filter((v) => v.is_ad).reduce((a, v) => a + num(v.revenue), 0);
  const numbers: Record<string, number> = {
    videos_total: all.length,
    videos_views: totViews,
    videos_revenue: totRev,
    videos_ads: all.filter((v) => v.is_ad).length,
    videos_avg_views: all.length ? totViews / all.length : 0,
    videos_selling: selling,
    videos_no_sale: all.length - selling,
    ad_video_revenue_share: totRev ? adVideoRev / totRev : 0,
    paid_revenue_share: totRev ? adRev / totRev : 0,
  };
  rows.forEach((r) => {
    numbers[`v${r.rank}_views`] = r.views;
    numbers[`v${r.rank}_likes`] = r.likes;
    numbers[`v${r.rank}_revenue`] = r.revenue;
    numbers[`v${r.rank}_orders`] = r.orders;
    if (r.is_ad) (numbers[`v${r.rank}_ad_cost`] = r.ad_cost), (numbers[`v${r.rank}_ad_roas`] = r.ad_roas);
  });
  return {
    type: "video",
    summary:
      `${all.length} video đã thu thập (30 ngày), tổng ${compact(totViews)} lượt xem (trung bình ${compact(numbers.videos_avg_views)}/video), ${vnd(totRev)} doanh thu từ video. ` +
      `${selling}/${all.length} video có ra đơn, ${numbers.videos_no_sale} video không ra đơn nào. ` +
      `${numbers.videos_ads}/${all.length} video chạy quảng cáo; video có chạy QC mang về ${p1(numbers.ad_video_revenue_share)} doanh thu video, trong đó phần do chính quảng cáo trả phí tạo ra ≈ ${p1(
        numbers.paid_revenue_share,
      )} doanh thu video (theo tỉ lệ doanh thu QC Kalodata ghi cho từng video). ` +
      `${rows.length} video ${args.product_id ? "gắn sản phẩm này " : ""}theo ${sort === "revenue" ? "doanh thu" : "lượt xem"}: ` +
      rows
        .map(
          (r) =>
            `#${r.rank} '${r.title.slice(0, 70)}' ${r.publish_date.slice(0, 10)}: ${compact(r.views)} view, ${compact(r.likes)} like, ${vnd(r.revenue)} (${compact(r.orders)} đơn)${
              r.is_ad ? `, quảng cáo ${vnd(r.ad_cost)} ROAS ${r.ad_roas.toLocaleString("vi-VN")}` : ""
            }${r.products[0]?.name ? `, gắn '${r.products[0].name.slice(0, 50)}'` : r.products.length ? ", gắn 1 sản phẩm chưa có tên trong dữ liệu" : ""}`,
        )
        .join("; "),
    rows,
    numbers,
    source: { collection: C.videos, ref: rows[0]?.video_id ?? creatorId },
  };
}

// ── analyze_videos ────────────────────────────────────────────────────────────
/**
 * AI **xem** video (4 khung hình + tiêu đề, không có âm thanh) — dùng lại `analyseVideo` của S4 nên
 * cache theo video: video đã xem ở chiến dịch hay lần hỏi trước thì 0 token. Đây là công cụ duy nhất
 * tốn tiền; tối đa ANALYZE_MAX (5) video mỗi lần — 5 cho câu hỏi về chất lượng nội dung, đủ thấy khuôn review. Điểm số là nhận định của AI, không phải số đo.
 */
const ANALYZE_MAX = 5;

async function analyzeVideos({ creatorId }: ToolCtx, args: Args): Promise<Out> {
  const db = await getDb();
  const all = await db.collection(C.videos).find({ creator_id: creatorId }, { projection: { title: 1, views: 1, revenue: 1, sales: 1, is_ad: 1, product_ids: 1 } }).toArray();
  const asked = (Array.isArray(args.video_ids) ? args.video_ids : []).map(String);
  let picks = asked.length ? all.filter((v) => asked.includes(String(v._id))) : [];
  if (asked.length && !picks.length) throw new Error("Không có video nào trong video_ids thuộc KOC này — lấy id từ list_videos");
  if (!picks.length) {
    // Mặc định: 2 video doanh thu cao nhất + 1 video nhiều view nhất
    const byRev = [...all].sort((a, b) => num(b.revenue) - num(a.revenue));
    const byViews = [...all].sort((a, b) => num(b.views) - num(a.views));
    for (const v of [byRev[0], byRev[1], byViews[0], ...byViews]) if (v && !picks.some((p) => p._id === v._id) && picks.length < 3) picks.push(v); // mặc định vẫn 3 cho câu hỏi chung
  }
  picks = picks.slice(0, ANALYZE_MAX);
  const pids = [...new Set(picks.flatMap((v) => (v.product_ids as string[]) ?? []))];
  const names = new Map((await db.collection(C.products).find({ _id: { $in: pids as never[] } }, { projection: { name: 1 } }).toArray()).map((p) => [String(p._id), String(p.name ?? "")]));
  let cost = 0;
  const rows: Record<string, unknown>[] = [];
  const failed: string[] = [];
  await Promise.all(
    picks.map(async (v) => {
      const title = String(v.title ?? "").slice(0, 150);
      try {
        const out = await analyseVideo(String(v._id), title);
        cost += out.cost_usd;
        const a = out.assessment.result;
        rows.push({
          video_id: String(v._id),
          title,
          views: num(v.views),
          revenue: num(v.revenue),
          orders: num(v.sales),
          is_ad: Boolean(v.is_ad),
          product: names.get(((v.product_ids as string[]) ?? [])[0] ?? "") ?? "",
          times: out.times,
          product_demo: a.product_demo,
          demo_score: a.demo_score,
          production_quality: a.production_quality,
          authenticity: a.authenticity,
          products_seen: a.products_seen,
          presenter: a.presenter,
          frames: a.frames,
          risks: a.risks,
          summary: a.summary,
          cached: out.cached,
        });
      } catch (e) {
        failed.push(`${String(v._id)} (${(e as Error).message.slice(0, 60)})`);
      }
    }),
  );
  rows.sort((a, b) => num(b.revenue) - num(a.revenue));
  rows.forEach((r, i) => (r.rank = i + 1));
  const numbers: Record<string, number> = { videos_analyzed: rows.length };
  rows.forEach((r) => {
    numbers[`a${r.rank}_demo_score`] = num(r.demo_score);
    numbers[`a${r.rank}_production`] = num(r.production_quality);
    numbers[`a${r.rank}_authenticity`] = num(r.authenticity);
    numbers[`a${r.rank}_views`] = num(r.views);
    numbers[`a${r.rank}_revenue`] = num(r.revenue);
  });
  if (!rows.length) throw new Error(`Không xem được video nào: ${failed.join("; ") || "chưa có khung hình"}`);
  return {
    type: "video",
    summary:
      `AI đã xem ${rows.length} video (mỗi video 4 khung hình, KHÔNG có âm thanh; điểm 0-100 là nhận định của AI). ` +
      rows
        .map(
          (r) =>
            `#${r.rank} '${String(r.title).slice(0, 60)}' (${compact(num(r.views))} view, ${vnd(num(r.revenue))}${r.product ? `, gắn '${String(r.product).slice(0, 45)}'` : ""}): demo sản phẩm ${r.product_demo} ${r.demo_score}/100, hình ảnh ${r.production_quality}/100, độ tự nhiên ${r.authenticity}/100${
              (r.products_seen as string[]).length ? `, thấy ${(r.products_seen as string[]).join(", ")}` : ""
            }; khung hình: ${(r.frames as { i: number; note: string }[]).map((f) => `[${f.i}] ${f.note}`).join(" ")}${(r.risks as string[]).length ? `; lưu ý: ${(r.risks as string[]).join(", ")}` : ""} — ${r.summary}`,
        )
        .join("; ") +
      (failed.length ? `. Không xem được: ${failed.join(", ")}` : ""),
    rows,
    numbers,
    cost_usd: cost,
    source: { collection: C.videos, ref: String(rows[0].video_id) },
  };
}

// ── get_daily ─────────────────────────────────────────────────────────────────
async function getDaily({ creatorId }: ToolCtx): Promise<Out> {
  const t = await channelTotals(creatorId);
  const daily = t?.daily ?? [];
  if (!daily.length) return { type: "metric", summary: "Chưa có số liệu theo ngày cho KOC này", rows: [], numbers: {}, source: { collection: C.creatorMetrics, ref: creatorId } };
  const sum = daily.reduce((a, d) => a + d.revenue, 0);
  const peak = daily.reduce((a, d) => (d.revenue > a.revenue ? d : a), daily[0]);
  const active = daily.filter((d) => d.revenue > 0).length;
  const half = Math.floor(daily.length / 2);
  const first = daily.slice(0, half).reduce((a, d) => a + d.revenue, 0);
  const second = daily.slice(half).reduce((a, d) => a + d.revenue, 0);
  const numbers = { days: daily.length, active_days: active, peak_revenue: peak.revenue, peak_share: sum ? peak.revenue / sum : 0, daily_avg: sum / daily.length, first_half: first, second_half: second };
  return {
    type: "metric",
    summary: `${t!.date_range}: có doanh thu ${active}/${daily.length} ngày, trung bình ${vnd(numbers.daily_avg)}/ngày; ngày cao nhất ${peak.day} ${vnd(peak.revenue)} (${p1(
      numbers.peak_share,
    )} tổng); nửa đầu kỳ ${vnd(first)} vs nửa sau ${vnd(second)}`,
    rows: daily,
    numbers,
    source: { collection: C.creatorMetrics, ref: t!.refs[0] ?? creatorId },
  };
}

// ── list_shops ────────────────────────────────────────────────────────────────
/**
 * Tab "Cửa hàng" của KOC (Kalodata searchCooperativeShops → `creator_shops`): các shop KOC hợp tác bán,
 * doanh thu / đơn / số sản phẩm mỗi shop, tách live/video. Chỉ kỳ mới nhất — gộp các kỳ sẽ cộng trùng.
 */
async function listShops({ creatorId }: ToolCtx, args: Args): Promise<Out> {
  const db = await getDb();
  const last = await db.collection(C.creatorShops).findOne({ creator_id: creatorId }, { sort: { date_range: -1 }, projection: { date_range: 1 } });
  const src = { collection: C.creatorShops, ref: creatorId };
  if (!last) return { type: "metric", summary: "Chưa thu thập dữ liệu cửa hàng (tab Cửa hàng) cho KOC này", rows: [], numbers: {}, source: src };
  const all = await db.collection(C.creatorShops).find({ creator_id: creatorId, date_range: last.date_range }).sort({ revenue: -1 }).toArray();
  const total = all.reduce((a, s) => a + num(s.revenue), 0);
  const q = typeof args.shop === "string" ? args.shop.trim().toLowerCase() : "";
  const picked = q ? all.filter((s) => String(s.shop_name ?? "").toLowerCase().includes(q)) : all;
  const limit = int(args.limit, 10, 50);
  const rows = picked.slice(0, limit).map((s, i) => ({
    rank: all.indexOf(s) + 1,
    shop: String(s.shop_name ?? `người bán ${s.seller_id}`),
    seller_id: String(s.seller_id),
    type: s.seller_type === "BRAND" ? "thương hiệu" : s.seller_type === "RETAILER" ? "nhà bán lẻ" : "—",
    revenue: num(s.revenue),
    share: total ? num(s.revenue) / total : 0,
    live_revenue: num(s.live_revenue),
    video_revenue: num(s.video_revenue),
    orders: num(s.sales),
    products: num(s.product_count),
    _i: i,
  }));
  const top = all[0];
  const numbers: Record<string, number> = { shops: all.length, total_revenue: total, top_share: total ? num(top?.revenue) / total : 0 };
  rows.forEach((r) => {
    numbers[`shop${r.rank}_revenue`] = r.revenue;
    numbers[`shop${r.rank}_share`] = r.share;
    numbers[`shop${r.rank}_orders`] = r.orders;
    numbers[`shop${r.rank}_products`] = r.products;
  });
  const head = q
    ? `${picked.length ? `${picked.length} cửa hàng khớp '${q}'` : `KHÔNG có cửa hàng nào khớp '${q}'`} trong ${all.length} cửa hàng KOC hợp tác (${last.date_range}).`
    : `${last.date_range}: KOC hợp tác bán cho ${all.length} cửa hàng, tổng ${vnd(total)}; cửa hàng lớn nhất chiếm ${p1(numbers.top_share)}.`;
  return {
    type: "metric",
    summary:
      head +
      " " +
      rows
        .map((r) => `#${r.rank} ${r.shop} (${r.type}) ${vnd(r.revenue)} (${p1(r.share)}), live ${vnd(r.live_revenue)}, video ${vnd(r.video_revenue)}, ${compact(r.orders)} đơn, ${compact(r.products)} sản phẩm`)
        .join("; "),
    rows: rows.map(({ _i, ...r }) => r), // eslint-disable-line @typescript-eslint/no-unused-vars
    numbers,
    source: src,
  };
}

// ── search_products ───────────────────────────────────────────────────────────
const VI_CLASS: Record<string, string> = {
  a: "aàáảãạăằắẳẵặâầấẩẫậ",
  e: "eèéẻẽẹêềếểễệ",
  i: "iìíỉĩị",
  o: "oòóỏõọôồốổỗộơờớởỡợ",
  u: "uùúủũụưừứửữự",
  y: "yỳýỷỹỵ",
  d: "dđ",
};
/** Từ khoá → regex KHÔNG phân biệt dấu ("duong am" khớp "Dưỡng Ẩm"); người bán hay gõ không dấu. */
function viFuzzy(term: string): string {
  const base = term
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
  return [...base].map((ch) => (VI_CLASS[ch] ? `[${VI_CLASS[ch]}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("").replace(/\s+/g, "\\s+");
}

// ── list_categories ───────────────────────────────────────────────────────────
interface CatNode {
  id: string;
  name: string;
  level: number;
  path: string[];
}
/** Danh mục theo id hoặc TÊN (không phân biệt dấu, khớp một phần); tên trùng nhiều nút → ưu tiên cấp cao, doanh thu lớn. */
async function resolveCategory(q: string): Promise<CatNode | null> {
  const db = await getDb();
  const byId = await db.collection(C.categories).findOne({ _id: q as never });
  const doc =
    byId ??
    (await db
      .collection(C.categories)
      .find({ name: new RegExp(viFuzzy(q), "i") })
      .sort({ level: 1, "stats.revenue": -1 })
      .limit(1)
      .next());
  return doc ? { id: String(doc._id), name: String(doc.name), level: Number(doc.level), path: (doc.path as string[]) ?? [String(doc.name)] } : null;
}

/**
 * Cây danh mục ĐA NGÀNH (cấp 1 ngành → 2 nhóm → 3 loại) kèm số sản phẩm / KOC / doanh thu mỗi nút —
 * để agent biết dữ liệu có ngành gì, nhóm nào lớn, rồi lọc search_products theo đúng danh mục.
 * Không truyền `parent` → các ngành cấp 1; truyền tên/id → các nút con của nó.
 */
async function listCategories(_ctx: ToolCtx, args: Args): Promise<Out> {
  const db = await getDb();
  const parent = typeof args.parent === "string" && args.parent.trim() ? await resolveCategory(args.parent.trim()) : null;
  if (args.parent && !parent) throw new Error(`Không có danh mục '${String(args.parent)}'`);
  const limit = int(args.limit, 15, 50);
  const docs = await db
    .collection(C.categories)
    .find(parent ? { parent_id: parent.id } : { level: 1 })
    .sort({ "stats.revenue": -1, "stats.products": -1 })
    .limit(limit)
    .toArray();
  const src = { collection: C.categories, ref: parent?.id ?? "root" };
  if (!docs.length)
    return { type: "metric", summary: parent ? `'${parent.path.join(" › ")}' không có danh mục con trong dữ liệu` : "Chưa dựng cây danh mục (chạy npm run build:categories)", rows: [], numbers: {}, source: src };
  const total = docs.reduce((a, d) => a + num(d.stats?.revenue), 0);
  const rows = docs.map((d, i) => ({
    rank: i + 1,
    category_id: String(d._id),
    name: String(d.name),
    level: Number(d.level),
    path: ((d.path as string[]) ?? []).join(" › "),
    products: num(d.stats?.products),
    kocs: num(d.stats?.kocs),
    revenue: num(d.stats?.revenue),
    orders: num(d.stats?.orders),
    share: total ? num(d.stats?.revenue) / total : 0,
  }));
  const numbers: Record<string, number> = { nodes: rows.length };
  rows.forEach((r) => Object.assign(numbers, { [`c${r.rank}_revenue`]: r.revenue, [`c${r.rank}_products`]: r.products, [`c${r.rank}_kocs`]: r.kocs, [`c${r.rank}_share`]: r.share }));
  return {
    type: "metric",
    summary:
      `${parent ? `Danh mục con của '${parent.path.join(" › ")}'` : "Các ngành (cấp 1) trong dữ liệu"} — ${rows.length} nút, xếp theo doanh thu ghi nhận qua KOC (kỳ 30 ngày gần nhất; danh mục của một phần sản phẩm được suy ra từ tên): ` +
      rows.map((r) => `#${r.rank} ${r.name} [id ${r.category_id}] ${vnd(r.revenue)} (${p1(r.share)}), ${compact(r.products)} sản phẩm, ${compact(r.kocs)} KOC`).join("; "),
    rows,
    numbers,
    source: src,
  };
}

/**
 * Sản phẩm trong DB theo TỪ KHOÁ tên (hoặc nhiều từ khoá — OR), xếp theo doanh thu / số đơn / số KOC
 * bán. Doanh thu là phần ghi nhận QUA CÁC KOC đã thu thập (kỳ mới nhất của từng KOC), không phải toàn bộ
 * doanh thu sản phẩm trên TikTok Shop — summary nói rõ để agent không nói quá.
 * Trả lời câu "loại X nào tốt / hot / bán chạy nhất" bằng dữ liệu bán hàng thay vì từ chối.
 */
async function searchProducts(_ctx: ToolCtx, args: Args): Promise<Out> {
  const db = await getDb();
  const terms = (Array.isArray(args.keywords) ? args.keywords : [args.keywords]).map((t) => String(t ?? "").trim()).filter((t) => t.length >= 2).slice(0, 6);
  // Lọc theo DANH MỤC (id hoặc tên, cấp nào cũng được) — chính xác hơn lọc chữ trong tên ("son dưỡng ẩm" ≠ kem dưỡng ẩm)
  const cat = typeof args.category === "string" && args.category.trim() ? await resolveCategory(args.category.trim()) : null;
  if (args.category && !cat) throw new Error(`Không có danh mục '${String(args.category)}' — gọi list_categories để xem tên/id đúng`);
  if (!terms.length && !cat) throw new Error("Cần keywords (từ khoá tên sản phẩm) hoặc category (danh mục từ list_categories)");
  const limit = int(args.limit, 10, 30);
  const sort = args.sort === "orders" ? "orders" : args.sort === "kocs" ? "kocs" : "revenue";
  const filter: Record<string, unknown> = {};
  if (terms.length) filter.name = new RegExp(terms.map(viFuzzy).join("|"), "i");
  if (cat) filter[`category.l${cat.level}.id`] = cat.id;
  // Loại nhóm trùng chữ nhưng khác loại — vẫn hữu ích khi sản phẩm chưa xếp được danh mục
  const ex = (Array.isArray(args.exclude) ? args.exclude : []).map((t) => String(t ?? "").trim()).filter((t) => t.length >= 2).slice(0, 8);
  const exRe = ex.length ? new RegExp(ex.map(viFuzzy).join("|"), "i") : null;
  const prods = (await db.collection(C.products).find(filter, { projection: { name: 1, seller_id: 1, seller_name: 1, category: 1 } }).toArray()).filter(
    (p) => !exRe || !exRe.test(String(p.name ?? "")),
  );
  const what = [cat ? `danh mục '${cat.path.join(" › ")}'` : "", terms.length ? `tên khớp ${terms.map((t) => `'${t}'`).join(" / ")}` : ""].filter(Boolean).join(", ");
  const src = { collection: C.creatorProducts, ref: `products:${cat?.id ?? ""}:${terms.join(",")}` };
  if (!prods.length) return { type: "product", summary: `Không có sản phẩm nào trong dữ liệu thuộc ${what}`, rows: [], numbers: { matched: 0 }, source: src };
  const meta = new Map(prods.map((p) => [String(p._id), p]));

  // Mỗi cặp KOC × sản phẩm lấy kỳ MỚI NHẤT (cùng một KOC có thể có 2 kỳ 30 ngày → không cộng trùng)
  const agg = await db
    .collection(C.creatorProducts)
    .aggregate<{ _id: string; revenue: number; orders: number; kocs: number; price: number; top: { creator_id: string; revenue: number } }>([
      { $match: { product_id: { $in: [...meta.keys()] } } },
      { $sort: { updated_at: -1 } },
      { $group: { _id: { p: "$product_id", c: "$creator_id" }, revenue: { $first: "$revenue" }, orders: { $first: "$sales_volume" }, price: { $first: "$unit_price" } } },
      { $sort: { revenue: -1 } },
      {
        $group: {
          _id: "$_id.p",
          revenue: { $sum: "$revenue" },
          orders: { $sum: "$orders" },
          kocs: { $sum: 1 },
          price: { $avg: "$price" },
          top: { $first: { creator_id: "$_id.c", revenue: "$revenue" } },
        },
      },
      { $sort: { [sort]: -1, revenue: -1 } },
      { $limit: limit },
    ])
    .toArray();
  const tops = await db.collection(C.creators).find({ _id: { $in: agg.map((a) => a.top.creator_id) as never[] } }, { projection: { nickname: 1, handle: 1 } }).toArray();
  const who = new Map(tops.map((c) => [String(c._id), c]));
  const rows = agg.map((a, i) => {
    const p = meta.get(String(a._id));
    const k = who.get(a.top.creator_id);
    return {
      rank: i + 1,
      product_id: String(a._id),
      name: String(p?.name ?? ""),
      shop: p?.seller_name ? String(p.seller_name) : "",
      seller_id: p?.seller_id ? String(p.seller_id) : "",
      price: num(a.price),
      revenue: num(a.revenue),
      orders: num(a.orders),
      kocs: num(a.kocs),
      top_koc: k ? String(k.nickname || k.handle) : "",
      top_koc_handle: k ? String(k.handle ?? "").replace(/^@/, "") : "",
      top_koc_revenue: num(a.top.revenue),
    };
  });
  const numbers: Record<string, number> = { matched: prods.length, shown: rows.length };
  rows.forEach((r) => {
    numbers[`p${r.rank}_revenue`] = r.revenue;
    numbers[`p${r.rank}_orders`] = r.orders;
    numbers[`p${r.rank}_kocs`] = r.kocs;
    numbers[`p${r.rank}_price`] = r.price;
    numbers[`p${r.rank}_top_koc_revenue`] = r.top_koc_revenue;
  });
  return {
    type: "product",
    summary:
      `${prods.length} sản phẩm trong dữ liệu thuộc ${what}${ex.length ? ` (đã loại tên có ${ex.map((t) => `'${t}'`).join("/")})` : ""}; top ${rows.length} theo ${sort === "orders" ? "số đơn" : sort === "kocs" ? "số KOC bán" : "doanh thu"} ` +
      `(doanh thu/đơn ghi nhận QUA CÁC KOC đã thu thập, kỳ 30 ngày gần nhất — không phải toàn bộ doanh thu sản phẩm trên TikTok Shop): ` +
      rows
        .map(
          (r) =>
            `#${r.rank} '${r.name.slice(0, 80)}'${r.shop ? ` [${r.shop}]` : ""} giá ~${vnd(r.price)}, ${vnd(r.revenue)}, ${compact(r.orders)} đơn, ${r.kocs} KOC bán${
              r.top_koc ? `, bán nhiều nhất: ${r.top_koc} (@${r.top_koc_handle}) ${vnd(r.top_koc_revenue)}` : ""
            }`,
        )
        .join("; "),
    rows,
    numbers,
    source: src,
  };
}

// ── get_peers ─────────────────────────────────────────────────────────────────
const COSMETICS = "848776,848648";

/**
 * Nhóm đối chuẩn, cùng quy tắc với `creatorEvidence` (evidence/creator.ts): follower 0,5×–2×, trùng
 * nhóm sản phẩm cấp 3, doanh thu ≥ 10% KOC đang xem, lấy 10 người gần nhất về follower. Doanh thu so
 * sánh là **doanh thu mỹ phẩm** (`queryList`, scope 848776,848648) vì chỉ số này có cho cả pool.
 */
async function getPeers({ creatorId }: ToolCtx): Promise<Out> {
  const db = await getDb();
  const creator = await db.collection(C.creators).findOne({ _id: creatorId as never });
  const followers = num(creator?.followers);
  const empty = (why: string): Out => ({ type: "metric", summary: why, rows: [], numbers: {}, source: { collection: C.creatorMetrics, ref: creatorId } });
  if (!followers) return empty("Không có số follower để chọn nhóm đối chuẩn");
  const pool = await db
    .collection(C.creatorMetrics)
    .find({ source: "web:creator/queryList", category_scope: COSMETICS }, { projection: { creator_id: 1, revenue: 1, video_engagement_rate: 1 } })
    .toArray();
  const mine = pool.find((r) => String(r.creator_id) === creatorId);
  const myRev = num(mine?.revenue);
  const myEng = num(mine?.video_engagement_rate);
  const band = { lo: Math.round(followers / 2), hi: Math.round(followers * 2) };
  const myTer = new Set((creator?.top_ter_categories as string[]) ?? []);
  const inBand = await db.collection(C.creators).find({ followers: { $gte: band.lo, $lte: band.hi } }, { projection: { handle: 1, nickname: 1, followers: 1, top_ter_categories: 1 } }).toArray();
  const meta = new Map(
    inBand.map((c) => [
      String(c._id),
      {
        name: String(c.nickname || c.handle || c._id),
        handle: String(c.handle ?? ""),
        followers: num(c.followers),
        same: myTer.size === 0 || ((c.top_ter_categories as string[]) ?? []).some((t) => myTer.has(t)),
      },
    ]),
  );
  const peers = pool
    .filter((r) => {
      const m = meta.get(String(r.creator_id));
      return m && String(r.creator_id) !== creatorId && m.same && num(r.revenue) >= myRev * 0.1;
    })
    .sort((a, b) => Math.abs(meta.get(String(a.creator_id))!.followers - followers) - Math.abs(meta.get(String(b.creator_id))!.followers - followers))
    .slice(0, 10);
  if (peers.length < 3) return empty(`Chỉ tìm được ${peers.length} KOC cùng tầm (${compact(band.lo)}–${compact(band.hi)} follower, cùng nhóm sản phẩm) — chưa đủ để đối chuẩn`);

  const details = await db
    .collection(C.creatorMetrics)
    .find({ creator_id: { $in: [creatorId, ...peers.map((p) => String(p.creator_id))] }, source: "creator/detail", category_scope: "all" }, { projection: { creator_id: 1, live_gpm: 1, updated_at: 1 } })
    .sort({ updated_at: -1 })
    .toArray();
  const gpm = new Map<string, number>();
  for (const d of details) if (!gpm.has(String(d.creator_id))) gpm.set(String(d.creator_id), num(d.live_gpm));
  /**
   * Số tổng kênh từ crawl web (`detail/total`): doanh thu/1.000 lượt xem live khi Open API không có
   * `live_gpm`, và tổng lượt xem video 30 ngày — để so "nội dung video có kéo người xem không" với nhóm.
   * KOC chưa crawl chi tiết thì không có → bỏ khỏi phép so đó (không coi là 0).
   */
  const webTotals = await db
    .collection(C.creatorMetrics)
    .find({ creator_id: { $in: [creatorId, ...peers.map((p) => String(p.creator_id))] }, source: "web:creator/detail/total", category_scope: "all" }, { projection: { creator_id: 1, live_revenue: 1, live_views: 1, video_views: 1, updated_at: 1 } })
    .sort({ updated_at: -1 })
    .toArray();
  const videoViews = new Map<string, number>();
  for (const w of webTotals) {
    const id = String(w.creator_id);
    if (!videoViews.has(id) && num(w.video_views) > 0) videoViews.set(id, num(w.video_views));
    if (!gpm.get(id) && num(w.live_views) > 0) gpm.set(id, (num(w.live_revenue) / num(w.live_views)) * 1000);
  }

  const all = [
    { creator_id: creatorId, name: String(creator?.nickname ?? ""), handle: String(creator?.handle ?? ""), followers, revenue: myRev, engagement: myEng, live_gpm: gpm.get(creatorId) ?? 0, video_views: videoViews.get(creatorId) ?? 0, self: true },
    ...peers.map((r) => {
      const m = meta.get(String(r.creator_id))!;
      return { creator_id: String(r.creator_id), name: m.name, handle: m.handle, followers: m.followers, revenue: num(r.revenue), engagement: num(r.video_engagement_rate), live_gpm: gpm.get(String(r.creator_id)) ?? 0, video_views: videoViews.get(String(r.creator_id)) ?? 0, self: false };
    }),
  ].sort((a, b) => b.revenue - a.revenue);
  const rows = all.map((r, i) => ({ rank: i + 1, ...r }));
  const others = all.filter((r) => !r.self);
  const gpms = others.map((r) => r.live_gpm).filter((g) => g > 0);
  const myGpm = gpm.get(creatorId) ?? 0;
  const numbers: Record<string, number> = {
    peers: peers.length,
    band_lo: band.lo,
    band_hi: band.hi,
    my_revenue: myRev,
    median_revenue: median(others.map((r) => r.revenue)),
    mean_revenue: others.reduce((a, r) => a + r.revenue, 0) / others.length,
    revenue_rank: rows.find((r) => r.self)!.rank,
    my_engagement: myEng,
    median_engagement: median(others.map((r) => r.engagement)),
  };
  const sorted = [...others].sort((a, b) => b.revenue - a.revenue);
  if (sorted[0]) numbers.second_revenue = sorted[0].revenue;
  if (myGpm > 0 && gpms.length >= 3)
    Object.assign(numbers, { my_live_gpm: myGpm, median_live_gpm: median(gpms), live_gpm_rank: 1 + gpms.filter((g) => g > myGpm).length, live_gpm_peers: gpms.length });
  // Lượt xem video 30 ngày so với nhóm (chỉ những KOC đã có số này)
  const vvs = others.map((r) => r.video_views).filter((v) => v > 0);
  const myVv = videoViews.get(creatorId) ?? 0;
  if (myVv > 0 && vvs.length >= 3) {
    const meanVv = vvs.reduce((a, v) => a + v, 0) / vvs.length;
    Object.assign(numbers, { my_video_views: myVv, median_video_views: median(vvs), mean_video_views: meanVv, video_views_vs_mean: myVv / meanVv, video_views_rank: 1 + vvs.filter((v) => v > myVv).length, video_views_peers: vvs.length });
  }
  return {
    type: "metric",
    summary:
      `Nhóm đối chuẩn ${peers.length} KOC cùng nhóm sản phẩm, ${compact(band.lo)}–${compact(band.hi)} follower, có bán hàng thật. Doanh thu mỹ phẩm 30 ngày: KOC này ${vnd(myRev)}, xếp ${
        numbers.revenue_rank
      }/${rows.length}; trung vị nhóm ${vnd(numbers.median_revenue)}, trung bình nhóm ${vnd(numbers.mean_revenue)}. Tương tác video ${pct(myEng)} vs trung vị ${pct(numbers.median_engagement)}` +
      (numbers.my_live_gpm
        ? `. Doanh thu/1.000 lượt xem live ${vnd(myGpm)} vs trung vị ${vnd(numbers.median_live_gpm)}, xếp ${numbers.live_gpm_rank}/${gpms.length + 1}`
        : "") +
      (numbers.my_video_views
        ? `. Lượt xem video 30 ngày ${compact(myVv)} vs trung bình nhóm ${compact(numbers.mean_video_views)} (bằng ${p1(numbers.video_views_vs_mean)}), xếp ${numbers.video_views_rank}/${numbers.video_views_peers + 1}`
        : "") +
      `. Danh sách: ` +
      rows.map((r) => `#${r.rank} ${r.name}${r.self ? " (KOC này)" : ""} ${vnd(r.revenue)}, ${compact(r.followers)} follower${r.video_views ? `, ${compact(r.video_views)} lượt xem video` : ""}`).join("; "),
    rows,
    numbers,
    source: { collection: C.creatorMetrics, ref: `peers:${peers.length}` },
  };
}

// ── search_creators ───────────────────────────────────────────────────────────
/**
 * Tìm KOC trong toàn bộ dữ liệu đã thu thập — **công cụ mở khoá trợ lý Tola**.
 *
 * Trước đây agent chỉ đọc được đúng danh sách do trang phát xuống (`KOC_CREATOR` /
 * `KOC_CREATORS`), nên không trả lời nổi những câu cơ bản nhất: "tìm KOC bán serum doanh thu
 * trên 1 tỉ", hay "so KOC này với Châu Lười Makeup" khi người đó không nằm trong shortlist.
 *
 * Không tái dùng `data/queries.ts: searchKocs` được: file đó gọi `connection()` của `next/server`,
 * mà công cụ này chạy trong tiến trình MCP riêng, không có request context của Next.
 */
const SORT_FIELD: Record<string, string> = {
  revenue: "m.revenue",
  engagement: "m.video_engagement_rate",
  views: "m.views",
  followers: "followers",
  growth: "m.revenue_growth_rate",
};

/** Phạm vi dữ liệu mới nhất đã crawl (danh mục + kỳ) — mọi số liệu đều gắn với một kỳ. */
async function latestScope(db: Db): Promise<{ category_id: string; date_range: string } | null> {
  const run =
    (await db.collection(C.crawlRuns).findOne({ source: "kalodata_web", "config.category_id": COSMETICS_SCOPE }, { sort: { started_at: -1 }, projection: { config: 1 } })) ??
    (await db.collection(C.crawlRuns).findOne({ source: "kalodata_web" }, { sort: { started_at: -1 }, projection: { config: 1 } }));
  if (!run) return null;
  const cfg = run.config as Record<string, string>;
  return { category_id: cfg.category_id, date_range: `${cfg.start_date}~${cfg.end_date}` };
}

const COSMETICS_SCOPE = "848776,848648";

async function searchCreators(_ctx: ToolCtx, args: Args): Promise<Out> {
  const db = await getDb();
  const scope = await latestScope(db);
  if (!scope) throw new Error("Chưa có dữ liệu crawl nào");

  const q = String(args.q ?? "").trim();
  const limit = int(args.limit, 10, 30);
  const sort = SORT_FIELD[String(args.sort ?? "revenue")] ?? SORT_FIELD.revenue;

  const match: Record<string, unknown> = {};
  if (q) match.$or = [{ handle: { $regex: q, $options: "i" } }, { nickname: { $regex: q, $options: "i" } }];

  /**
   * Lọc theo SẢN PHẨM đã bán — tra tên sản phẩm thật trong `creator_products`, không phải tên kênh.
   * Thiếu bộ lọc này agent phải gọi `list_products` cho từng KOC để tự dò (đã đo: 25 lần gọi cho
   * một câu "tìm KOC bán kem chống nắng"). Dùng chung `focusPattern` với S2 nên cùng bảng đồng
   * nghĩa: "phấn nền" ra cả phấn nước/cushion, và không ăn nhầm phấn má.
   */
  let focusRevenue: Map<string, number> | null = null;
  const product = String(args.product ?? "").trim();
  if (product) {
    const re = focusPattern(scope.category_id, product);
    const pids = (await db.collection(C.products).find({ name: { $regex: re.source, $options: "i" } }, { projection: { _id: 1 } }).toArray()).map((p) => p._id);
    if (!pids.length)
      return {
        type: "metric",
        summary: `Không có sản phẩm nào khớp '${product}' trong dữ liệu đã thu thập. Thử từ khoá rộng hơn, hoặc bỏ bộ lọc sản phẩm rồi tự xem list_products của vài KOC đầu bảng.`,
        rows: [],
        numbers: { found: 0 },
        source: { collection: C.products, ref: product },
      };
    const agg = await db
      .collection(C.creatorProducts)
      .aggregate<{ _id: string; revenue: number }>([
        { $match: { product_id: { $in: pids as never[] } } },
        // Gộp theo (KOC, sản phẩm) trước: crawl 2 lần sẽ cộng đôi doanh thu nếu không gộp
        { $group: { _id: { c: "$creator_id", p: "$product_id" }, revenue: { $max: "$revenue" } } },
        { $group: { _id: "$_id.c", revenue: { $sum: "$revenue" } } },
      ])
      .toArray();
    focusRevenue = new Map(agg.map((a) => [String(a._id), num(a.revenue)]));
    if (!focusRevenue.size)
      return {
        type: "metric",
        summary: `Có ${pids.length} sản phẩm khớp '${product}' nhưng chưa KOC nào trong dữ liệu bán chúng.`,
        rows: [],
        numbers: { found: 0, products_matched: pids.length },
        source: { collection: C.creatorProducts, ref: product },
      };
    match._id = { $in: [...focusRevenue.keys()] };
  }

  /**
   * Lọc theo DANH MỤC (ngành / nhóm / loại, tên hoặc id) — dùng `creator_products.cat` đã gắn sẵn nên
   * không phải quét tên sản phẩm. Thứ hạng theo doanh thu CỦA KOC TRONG danh mục đó.
   */
  const catArg = typeof args.category === "string" ? args.category.trim() : "";
  let catNode: CatNode | null = null;
  if (catArg) {
    catNode = await resolveCategory(catArg);
    if (!catNode) throw new Error(`Không có danh mục '${catArg}' — gọi list_categories để xem tên/id đúng`);
    const agg = await db
      .collection(C.creatorProducts)
      .aggregate<{ _id: string; revenue: number }>([
        { $match: { [`cat.l${catNode.level}`]: catNode.id, ...(focusRevenue ? { creator_id: { $in: [...focusRevenue.keys()] } } : {}) } },
        { $sort: { updated_at: -1 } },
        { $group: { _id: { c: "$creator_id", p: "$product_id" }, revenue: { $first: "$revenue" } } },
        { $group: { _id: "$_id.c", revenue: { $sum: "$revenue" } } },
      ])
      .toArray();
    focusRevenue = new Map(agg.filter((a) => num(a.revenue) > 0).map((a) => [String(a._id), num(a.revenue)]));
    if (!focusRevenue.size)
      return {
        type: "metric",
        summary: `Chưa có KOC nào trong dữ liệu có doanh thu ở danh mục '${catNode.path.join(" › ")}'.`,
        rows: [],
        numbers: { found: 0 },
        source: { collection: C.creatorProducts, ref: catNode.id },
      };
    match._id = { $in: [...focusRevenue.keys()] };
  }

  if (args.age) match["audience.age_buckets_matched"] = String(args.age);
  const minF = num(args.min_followers);
  const maxF = num(args.max_followers);
  if (minF || maxF) match.followers = { ...(minF ? { $gte: minF } : {}), ...(maxF ? { $lte: maxF } : {}) };
  if (args.mcn === "yes") match.mcn = { $nin: [null, ""] };
  if (args.mcn === "no") match.mcn = { $in: [null, ""] };
  // Mặc định bỏ kênh do nhà bán tự vận hành — không phải đối tượng đi hợp tác quảng bá
  if (args.include_seller_accounts !== true) match.status = { $ne: "BELONGED_TO_SELLER" };
  const minRev = num(args.min_revenue);
  if (minRev) match["m.revenue"] = { $gte: minRev };

  const docs = await db
    .collection(C.creatorMetrics)
    .aggregate<Record<string, any>>([ // eslint-disable-line @typescript-eslint/no-explicit-any
      /**
       * Không lọc danh mục → giữ phạm vi của lượt crawl danh sách gần nhất (như trước). CÓ lọc danh mục
       * → mọi phạm vi ngành (KOC ngành khác nằm ở category_scope khác), lấy số liệu mới nhất mỗi KOC.
       */
      ...(catNode
        ? [
            { $match: { source: "web:creator/queryList", creator_id: { $in: [...(focusRevenue?.keys() ?? [])] } } },
            { $sort: { updated_at: -1 } },
            { $group: { _id: "$creator_id", m: { $first: "$$ROOT" } } },
            { $project: { _id: 0, m: 1 } },
          ]
        : [{ $match: { category_scope: scope.category_id, date_range: scope.date_range, source: "web:creator/queryList" } }, { $project: { _id: 0, m: "$$ROOT" } }]),
      { $lookup: { from: C.creators, localField: "m.creator_id", foreignField: "_id", as: "c" } },
      { $unwind: "$c" },
      { $replaceRoot: { newRoot: { $mergeObjects: ["$c", { m: "$m" }] } } },
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      { $sort: { [sort]: -1 } },
      { $limit: limit },
    ])
    .toArray();

  const rows = docs.map((d, i) => ({
    rank: i + 1,
    creator_id: String(d._id),
    name: String(d.nickname || d.handle || d._id),
    handle: String(d.handle ?? "").replace(/^@/, ""),
    followers: num(d.followers),
    revenue: num(d.m?.revenue),
    sales: num(d.m?.sales_volume),
    engagement: num(d.m?.video_engagement_rate),
    growth_rate: typeof d.m?.revenue_growth_rate === "number" ? d.m.revenue_growth_rate : null,
    mcn: d.mcn ? String(d.mcn) : null,
    has_detail: Boolean(d.detail_updated_at),
    scope: String(d.m?.category_scope ?? ""),
    industry: d.industry?.l2?.name ? `${d.industry.l1?.name ?? ""} › ${d.industry.l2.name}` : "",
    ...(focusRevenue ? { focus_revenue: focusRevenue.get(String(d._id)) ?? 0 } : {}),
  }));
  // Lọc theo sản phẩm thì thứ hạng phải theo doanh thu CHÍNH sản phẩm đó, không phải cả kênh
  if (focusRevenue && !args.sort) {
    rows.sort((a, b) => ((b as { focus_revenue?: number }).focus_revenue ?? 0) - ((a as { focus_revenue?: number }).focus_revenue ?? 0));
    rows.forEach((r, i) => (r.rank = i + 1));
  }

  const numbers: Record<string, number> = { found: rows.length };
  rows.forEach((r, i) => {
    numbers[`k${i + 1}_revenue`] = r.revenue;
    numbers[`k${i + 1}_followers`] = r.followers;
    numbers[`k${i + 1}_engagement`] = r.engagement;
    if (r.growth_rate !== null) numbers[`k${i + 1}_growth_rate`] = r.growth_rate;
    const fr = (r as { focus_revenue?: number }).focus_revenue;
    if (fr !== undefined) numbers[`k${i + 1}_focus_revenue`] = fr;
  });

  const filterText = [
    q ? `tên chứa '${q}'` : null,
    catNode ? `danh mục '${catNode.path.join(" › ")}'` : null,
    product ? `có bán '${product}'` : null,
    args.age ? `tuổi ${String(args.age)}` : null,
    minF || maxF ? `follower ${minF ? compact(minF) : "0"}–${maxF ? compact(maxF) : "∞"}` : null,
    minRev ? `doanh thu ≥ ${vnd(minRev)}` : null,
    args.mcn === "no" ? "chưa ký MCN" : args.mcn === "yes" ? "đã ký MCN" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    type: "metric",
    summary:
      `Tìm trong dữ liệu TikTok Việt Nam (${catNode ? "mọi ngành" : scopeName(scope.category_id)}) kỳ ${scope.date_range.replace("~", " → ")}${filterText ? ` (${filterText})` : ""}: ${rows.length} KOC, xếp theo ${String(args.sort ?? "revenue")}. ` +
      (rows.length
        ? rows
            .map(
              (r) =>
                `#${r.rank} ${r.name} (id ${r.creator_id}, handle @${r.handle}): ${
                  focusRevenue ? `doanh thu '${catNode ? catNode.name : product}' ${vnd((r as { focus_revenue?: number }).focus_revenue ?? 0)}, ` : ""
                }doanh thu ${scopeName(r.scope)} ${vnd(r.revenue)}, ${compact(r.followers)} follower, tương tác ${pct(r.engagement)}` +
                `${r.growth_rate === null ? "" : `, doanh thu ${r.growth_rate >= 0 ? "+" : ""}${p1(r.growth_rate)} so kỳ trước`}` +
                `${r.mcn ? `, MCN ${r.mcn}` : ", chưa ký MCN"}${r.has_detail ? "" : " — CHƯA có dữ liệu chi tiết, không gọi được các công cụ đọc sâu"}`,
            )
            .join(" || ")
        : "Không có KOC nào khớp — thử nới bộ lọc."),
    rows,
    numbers,
    source: { collection: C.creatorMetrics, ref: scope.date_range },
  };
}

// ── list_campaigns ────────────────────────────────────────────────────────────
/** Các chiến dịch đã tạo — để trợ lý trả lời "chiến dịch kem chống nắng tuần trước ra sao?". */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- chữ ký chung của ToolSpec.run
async function listCampaignsTool(_ctx: ToolCtx, _args: Args): Promise<Out> {
  const db = await getDb();
  const docs = await db
    .collection(C.campaigns)
    .find({}, { projection: { prompt: 1, category_name: 1, koc_count: 1, budget_total: 1, created_at: 1, scoring: 1, s5: 1, pipeline: 1 } })
    .sort({ created_at: -1 })
    .limit(20)
    .toArray();

  const rows = docs.map((c) => ({
    campaign_id: String(c._id),
    prompt: String(c.prompt ?? "").slice(0, 120),
    category: String(c.category_name ?? ""),
    koc_count: num(c.koc_count),
    budget_total: num(c.budget_total),
    picked: num(c.s5?.picks?.length),
    stage: String(c.pipeline?.stage ?? "—"),
    created_at: c.created_at instanceof Date ? c.created_at.toISOString().slice(0, 10) : "",
  }));

  return {
    type: "metric",
    summary:
      `${rows.length} chiến dịch gần nhất. ` +
      rows
        .map(
          (r) =>
            `${r.campaign_id} (${r.created_at}, ${r.category}): '${r.prompt}' — ${r.koc_count || "?"} KOC${r.budget_total ? `, ngân sách ${vnd(r.budget_total)}` : ", chưa có ngân sách"}, ${
              r.stage === "done" ? (r.picked ? `đã chọn ${r.picked} KOC` : "đã chạy xong") : `đang ở bước ${r.stage}`
            }`,
        )
        .join(" || "),
    rows,
    numbers: { campaigns: rows.length },
    source: { collection: C.campaigns, ref: "list" },
  };
}

// ── campaign_context ──────────────────────────────────────────────────────────
const SCORE_LABEL: Record<string, string> = {
  performance: "hiệu suất",
  content_fit: "hợp sản phẩm",
  engagement: "tương tác",
  growth: "tăng trưởng",
  cost_fit: "hợp ngân sách",
  consistency: "ổn định",
  audience_fit: "hợp khán giả",
};

/**
 * Ngữ cảnh chiến dịch cho agent ở chat chiến dịch: tiêu chí, tiến độ, danh sách KOC được chọn và dự
 * phòng kèm điểm từng thành phần, ngân sách đã chia, và các bằng chứng S2 (do code viết) của từng KOC
 * — đủ để trả lời "vì sao chọn A mà không chọn B". Điểm/ngân sách là kết quả pipeline, agent không
 * được tính lại hay sửa.
 */
interface CampaignRow extends Record<string, unknown> {
  rank: number;
  creator_id: string;
  name: string;
  handle: string;
  followers: number;
  picked: boolean;
  budget: number;
  total: number;
  scores: Record<string, number>;
  revenue: number;
  /** Tỉ lệ thô so với kỳ trước (0,847 = +84,7%); null nếu chiến dịch chấm bằng bản scoring trước s2-v5. */
  growth_rate: number | null;
  breakout_rate: number | null;
  cost_min: number;
  cost_max: number;
  evidence: string[];
  /** Video AI đã xem (4 khung hình/video, không có tiếng) — bằng chứng cho chất lượng review. */
  videos: {
    video_id: string;
    title: string;
    product_match: boolean;
    /** Khớp sản phẩm theo đâu — sản phẩm gắn trong video là bằng chứng mạnh nhất, tiêu đề yếu nhất. */
    match_by: string | null;
    sold_product: string | null;
    product_demo: string;
    demo_score: number;
    production_quality: number;
    authenticity: number;
    video_score: number;
    summary: string;
  }[];
}

/** Shortlist của chiến dịch kèm điểm, chi phí ước tính và bằng chứng — dùng chung cho `campaign_context` và `allocate_budget`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function campaignRows(campaignId: string): Promise<{ camp: Record<string, any>; rows: CampaignRow[]; picks: { creator_id: string; budget?: number }[] }> {
  const db = await getDb();
  const camp = await db.collection(C.campaigns).findOne({ _id: campaignId as never });
  if (!camp) throw new Error("Không tìm thấy chiến dịch");
  const picks = ((camp.s5?.picks ?? []) as { creator_id: string; budget?: number }[]).filter((p) => !((camp.excluded_creator_ids as string[]) ?? []).includes(p.creator_id));
  const budgetOf = new Map(picks.map((p) => [p.creator_id, num(p.budget)]));
  const scores = await db.collection(C.campaignScores).find({ campaign_id: campaignId, shortlisted: true }).sort({ rank: 1 }).limit(15).toArray();
  const ids = scores.map((s) => String(s.creator_id));
  const creators = new Map(
    (await db.collection(C.creators).find({ _id: { $in: ids as never[] } }, { projection: { nickname: 1, handle: 1, followers: 1 } }).toArray()).map((c) => [String(c._id), c]),
  );
  const evIds = scores.flatMap((s) => (s.evidence_ids as string[]) ?? []);
  const claims = new Map((await db.collection(C.evidence).find({ _id: { $in: evIds as never[] } }, { projection: { claim: 1 } }).toArray()).map((e) => [String(e._id), String(e.claim)]));

  const rows: CampaignRow[] = scores.map((s) => {
    const id = String(s.creator_id);
    const c = creators.get(id);
    const total = num(s.s4_total ?? s.s3_total ?? s.total);
    return {
      rank: num(s.s4_rank ?? s.s3_rank ?? s.rank),
      creator_id: id,
      name: String(c?.nickname || c?.handle || id),
      // `creators.handle` lưu kèm "@" — bỏ đi để mọi chỗ ghép được thành tiktok.com/@<handle>
      handle: String(c?.handle ?? "").replace(/^@/, ""),
      followers: num(c?.followers),
      picked: budgetOf.has(id),
      budget: budgetOf.get(id) ?? 0,
      total: Math.round(total * 10) / 10,
      scores: (s.scores as Record<string, number>) ?? {},
      revenue: num(s.revenue),
      // Tỉ lệ thô so với kỳ trước (0,847 = +84,7%); null khi chiến dịch chấm bằng bản scoring cũ
      growth_rate: typeof s.growth_rate === "number" ? s.growth_rate : null,
      breakout_rate: typeof s.breakout_rate === "number" ? s.breakout_rate : null,
      cost_min: num((s.cost_estimate as { min?: number })?.min),
      cost_max: num((s.cost_estimate as { max?: number })?.max),
      // Cắt bớt: `rows` được gửi NGUYÊN cho model qua MCP, dài quá thì Claude CLI đổ kết quả ra
      // file và agent không đọc được gì (đã gặp: campaign_context trả về "Format: Plain text").
      evidence: (((s.evidence_ids as string[]) ?? []).map((e) => claims.get(e)).filter(Boolean) as string[]).slice(0, 5).map((c) => (c.length > 180 ? `${c.slice(0, 177)}…` : c)),
      videos: ((s.s4?.videos ?? []) as Record<string, unknown>[]).slice(0, 3).map((v) => ({
        video_id: String(v.video_id),
        title: String(v.title ?? ""),
        product_match: Boolean(v.product_match),
        match_by: (v.match_by as string) ?? null,
        sold_product: (v.sold_product as string) ?? null,
        product_demo: String(v.product_demo ?? "không rõ"),
        demo_score: num(v.demo_score),
        production_quality: num(v.production_quality),
        authenticity: num(v.authenticity),
        video_score: num(v.video_score),
        summary: String(v.summary ?? "").slice(0, 140),
      })),
    };
  });
  rows.sort((a, b) => Number(b.picked) - Number(a.picked) || a.rank - b.rank);
  return { camp, rows, picks };
}

/**
 * Mọi video AI đã xem trong một chiến dịch, kèm tên + handle của KOC. Đây là **bằng chứng gốc** cho
 * câu "KOC này review sản phẩm thế nào": tiêu đề video, có thấy đúng sản phẩm hay không, điểm demo /
 * hình ảnh / độ tự nhiên, ghi chú từng khung hình và mốc giây — giao diện vẽ cùng tấm 4 khung hình
 * mà AI đã nhìn (`/api/frames/<video_id>`).
 *
 * Trước đây dữ liệu này chỉ nằm ở trang chiến dịch (đã bỏ); không đưa ra thì bước xem video chạy
 * xong mà người bán không thấy gì — đúng như phản hồi "đọc xong không lấy dẫn chứng gì về video".
 */
export async function campaignVideoRows(campaignId: string, opts: { pickedOnly?: boolean } = {}): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  const camp = await db.collection(C.campaigns).findOne({ _id: campaignId as never }, { projection: { s5: 1, excluded_creator_ids: 1 } });
  const picked = new Set(((camp?.s5?.picks ?? []) as { creator_id: string }[]).map((p) => p.creator_id));
  const scores = await db
    .collection(C.campaignScores)
    .find({ campaign_id: campaignId, "s4.videos.0": { $exists: true } })
    .sort({ s4_rank: 1 })
    .toArray();
  const ids = scores.map((s) => String(s.creator_id));
  const creators = new Map(
    (await db.collection(C.creators).find({ _id: { $in: ids as never[] } }, { projection: { nickname: 1, handle: 1 } }).toArray()).map((c) => [String(c._id), c]),
  );
  const rows: Record<string, unknown>[] = [];
  for (const s of scores) {
    const id = String(s.creator_id);
    if (opts.pickedOnly && picked.size && !picked.has(id)) continue;
    const c = creators.get(id);
    for (const v of (s.s4.videos ?? []) as Record<string, unknown>[]) {
      rows.push({
        creator_id: id,
        creator_name: String(c?.nickname || c?.handle || id),
        handle: String(c?.handle ?? "").replace(/^@/, ""),
        ...(picked.size ? { picked: picked.has(id) } : {}),
        video_id: String(v.video_id),
        title: String(v.title ?? ""),
        times: (v.times as number[]) ?? [],
        product_match: Boolean(v.product_match),
        /** Khớp theo đâu: sản phẩm gắn trong video / khung hình / tiêu đề. `null` = không khớp. */
        match_by: (v.match_by as string) ?? null,
        sold_product: (v.sold_product as string) ?? null,
        product_demo: String(v.product_demo ?? "không rõ"),
        demo_score: num(v.demo_score),
        production_quality: num(v.production_quality),
        authenticity: num(v.authenticity),
        video_score: num(v.video_score),
        products_seen: (v.products_seen as string[]) ?? [],
        frames: (v.frames as { i: number; note: string }[]) ?? [],
        risks: (v.risks as string[]) ?? [],
        summary: String(v.summary ?? ""),
      });
    }
  }
  return rows;
}

async function campaignContext({ campaignId }: ToolCtx): Promise<Out> {
  if (!campaignId) throw new Error("Công cụ này chỉ dùng trong chat chiến dịch");
  const { camp, rows, picks } = await campaignRows(campaignId);
  // Ai bị loại và vì sao — người bán cần biết mình không bỏ sót ai. Con số này nằm sẵn trong
  // `campaigns.scoring` từ lâu nhưng chưa bao giờ được đưa ra cho agent nói.
  const byReason = (camp.scoring?.excluded_by_reason ?? {}) as Record<string, number>;
  const excludedText = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} người ${EXCLUDE_LABELS[k] ?? k}`)
    .join(", ");

  const numbers: Record<string, number> = { shortlisted: rows.length, picked: picks.length };
  for (const [k, v] of Object.entries(byReason)) numbers[`excluded_${k}`] = v;
  if (num(camp.scoring?.excluded)) numbers.excluded_total = num(camp.scoring?.excluded);
  const crit = (camp.criteria ?? {}) as Record<string, unknown>;
  if (num(crit.budget_total)) numbers.budget_total = num(crit.budget_total);
  if (num(camp.s5?.allocated)) numbers.allocated = num(camp.s5?.allocated);
  if (camp.scoring) Object.assign(numbers, { pool: num(camp.scoring.pool), eligible: num(camp.scoring.eligible) });
  rows.forEach((r, i) => {
    numbers[`k${i + 1}_total`] = r.total;
    numbers[`k${i + 1}_followers`] = r.followers;
    numbers[`k${i + 1}_revenue`] = r.revenue;
    if (r.growth_rate !== null) numbers[`k${i + 1}_growth_rate`] = r.growth_rate;
    const fr = (r as { focus_revenue?: number }).focus_revenue;
    if (fr !== undefined) numbers[`k${i + 1}_focus_revenue`] = fr;
    if (r.breakout_rate !== null) numbers[`k${i + 1}_breakout_rate`] = r.breakout_rate;
    if (r.budget) numbers[`k${i + 1}_budget`] = r.budget;
    // Khoảng chi phí/video: agent trích suốt ("₫1,2-3,6 tr/video") nên phải có nguồn, không thì bị
    // đánh dấu là số không đối chiếu được
    numbers[`k${i + 1}_cost_min`] = r.cost_min;
    numbers[`k${i + 1}_cost_max`] = r.cost_max;
    for (const [k, v] of Object.entries(r.scores)) numbers[`k${i + 1}_${k}`] = num(v);
    // Số của phần xem video cũng phải vào `numbers`, nếu không câu "demo 85/100" sẽ bị đánh là bịa
    r.videos.forEach((v, j) => {
      numbers[`k${i + 1}_v${j + 1}_demo_score`] = v.demo_score;
      numbers[`k${i + 1}_v${j + 1}_production_quality`] = v.production_quality;
      numbers[`k${i + 1}_v${j + 1}_authenticity`] = v.authenticity;
      numbers[`k${i + 1}_v${j + 1}_video_score`] = v.video_score;
    });
  });
  const analysed = rows.filter((r) => r.videos.length);
  numbers.videos_analysed = analysed.reduce((a, r) => a + r.videos.length, 0);
  /**
   * Hai mức chi tiết. Tóm tắt này đi NGUYÊN qua MCP vào ngữ cảnh của model, dài quá thì Claude CLI
   * đổ ra file và agent mất sạch dữ liệu — nên người ĐƯỢC CHỌN mới được tả kỹ (gồm bằng chứng video),
   * còn dự phòng chỉ một dòng số đủ để so sánh và gọi tên khi cần thay người.
   */
  const videoText = (r: CampaignRow) =>
    r.videos.length
      ? `AI ĐÃ XEM ${r.videos.length} video: ${r.videos
          .slice(0, 2)
          .map(
            (v) =>
              `“${v.title.slice(0, 50)}” — ${
                v.product_match ? `KHỚP sản phẩm chiến dịch (căn cứ: ${v.match_by}${v.sold_product ? ` — “${v.sold_product.slice(0, 50)}”` : ""})` : "KHÔNG khớp sản phẩm chiến dịch"
              }, demo ${v.demo_score}/100, hình ${v.production_quality}/100, tự nhiên ${v.authenticity}/100: ${v.summary.slice(0, 110)}`,
          )
          .join(" ; ")}. `
      : "CHƯA xem video của người này (không được đoán nội dung video). ";
  const head = (r: CampaignRow, i: number) =>
    `#${i + 1} ${r.name} (id ${r.creator_id}${r.handle ? `, handle @${r.handle}` : ""}, ${r.picked ? `ĐƯỢC CHỌN, ngân sách ${vnd(r.budget)}` : "dự phòng"}): điểm ${r.total}; ${compact(r.followers)} follower; doanh thu mỹ phẩm ${vnd(r.revenue)}`;
  const full = (r: CampaignRow, i: number) =>
    `${head(r, i)}; ${Object.entries(r.scores)
      .map(([k, v]) => `${SCORE_LABEL[k] ?? k} ${v}`)
      .join(", ")}; ${r.growth_rate === null ? "chưa có số tăng trưởng" : `doanh thu ${r.growth_rate >= 0 ? "+" : ""}${p1(r.growth_rate)} so với kỳ trước`}; chi phí ước tính ${vnd(
      r.cost_min,
    )}–${vnd(r.cost_max)}/video. ${videoText(r)}Bằng chứng: ${r.evidence.slice(0, 4).join(" | ")}`;
  const brief = (r: CampaignRow, i: number) =>
    `${head(r, i)}; chi phí ước tính ${vnd(r.cost_min)}–${vnd(r.cost_max)}/video. ${r.videos.length ? `AI đã xem ${r.videos.length} video, ${r.videos.some((v) => v.product_match) ? "CÓ" : "KHÔNG"} thấy sản phẩm của chiến dịch` : "chưa xem video"}. Gọi deepen_koc nếu người bán muốn xem kỹ người này.`;

  const critText = Object.entries(crit)
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("/") : typeof v === "number" && v >= 1e5 ? vnd(v) : String(v)}`)
    .join(", ");
  return {
    type: "metric",
    summary:
      `Chiến dịch ${String(camp.category_name ?? "")}${camp.prompt ? ` — yêu cầu gốc: '${String(camp.prompt).slice(0, 160)}'` : ""}. Tiêu chí: ${critText || "chưa đặt"}. ` +
      (camp.scoring ? `Đã lọc ${camp.scoring.pool} KOC → ${camp.scoring.eligible} đạt tiêu chí. ` : "") +
      (excludedText ? `Đã LOẠI ${camp.scoring.excluded} KOC: ${excludedText}. ` : "") +
      `Mọi KOC trong danh sách dưới đây đều được Kalodata đánh dấu là nhà sáng tạo ĐỘC LẬP (tài khoản do chính nhà bán vận hành đã bị loại). ` +
      (camp.s5 ? `Đã chọn ${picks.length} KOC, chia ${vnd(num(camp.s5.allocated))}. ` : "Chưa chọn KOC/chia ngân sách. ") +
      `Điểm phù hợp 0-100 do code chấm (trọng số theo tiêu chí), KHÔNG được tính lại. ` +
      (analysed.length
        ? `AI đã XEM ${numbers.videos_analysed} video của ${analysed.length} KOC (mỗi video 4 khung hình, KHÔNG có âm thanh) — phần "AI ĐÃ XEM" của từng người dưới đây là bằng chứng về cách họ review sản phẩm, PHẢI dùng trong câu trả lời. `
        : "") +
      rows.map((r, i) => (r.picked || !picks.length ? full(r, i) : brief(r, i))).join(" || "),
    rows,
    numbers,
    source: { collection: C.campaigns, ref: campaignId },
  };
}

// ── allocate_budget ───────────────────────────────────────────────────────────
/**
 * Phương án chia một khoản ngân sách cho các KOC trong chiến dịch — **code tính, agent chỉ giải
 * thích**, đúng nguyên tắc "con số thuộc về code" của S5. Khác S5 ở chỗ đây là phương án *tham khảo*
 * ngay trong lúc chat (chiến dịch có thể chưa có ngân sách, chưa chạy bước đề xuất), nên nó không
 * ghi gì vào chiến dịch.
 *
 * Cách chia: tỉ lệ thuận với `basis` (điểm phù hợp / doanh thu mỹ phẩm 30 ngày / chi phí ước tính),
 * làm tròn tới 100k, phần dư dồn vào KOC đầu bảng để tổng khớp tuyệt đối. Sau đó mỗi dòng được đối
 * chiếu với **chi phí ước tính/video** của chính KOC đó: phần ngân sách không đủ cho 1 video được
 * đánh dấu `đủ 0 video` — đây là điều bảng phân bổ chia theo tỉ trọng suông không nói được.
 */
const BASIS_LABEL: Record<string, string> = { fit: "điểm phù hợp", revenue: "doanh thu mỹ phẩm 30 ngày", cost: "chi phí ước tính" };

async function allocateBudget({ campaignId }: ToolCtx, args: Args): Promise<Out> {
  if (!campaignId) throw new Error("Công cụ này chỉ dùng trong chat chiến dịch");
  const total = Number(args.total);
  if (!Number.isFinite(total) || total <= 0) throw new Error("total phải là tổng ngân sách VND > 0 (lấy đúng con số người bán vừa nói)");
  const basis = ["fit", "revenue", "cost"].includes(String(args.basis)) ? String(args.basis) : "fit";

  const { camp, rows: all } = await campaignRows(campaignId);
  const wanted = Array.isArray(args.creator_ids) ? args.creator_ids.map(String) : [];
  const byId = new Map(all.map((r) => [r.creator_id, r]));
  const bad = wanted.filter((id) => !byId.has(id));
  if (bad.length) throw new Error(`creator_id ${bad.join(", ")} không có trong shortlist — lấy id từ campaign_context`);
  const n = int(args.koc_count, num(camp.koc_count) || 5, 15);
  const rows = wanted.length ? wanted.map((id) => byId.get(id)!) : all.slice(0, n);
  if (!rows.length) throw new Error("Chiến dịch chưa có KOC nào trong shortlist");

  const weightOf = (r: CampaignRow) => (basis === "revenue" ? r.revenue : basis === "cost" ? (r.cost_min + r.cost_max) / 2 : r.total);
  const sum = rows.reduce((a, r) => a + Math.max(0, weightOf(r)), 0);
  // Không có căn cứ nào khác 0 (vd chọn basis=revenue mà cả nhóm chưa có doanh thu) → chia đều
  const even = sum <= 0;
  const STEP = 100_000;
  const raw = rows.map((r) => (even ? total / rows.length : (total * Math.max(0, weightOf(r))) / sum));
  const budgets = raw.map((v) => Math.round(v / STEP) * STEP);
  budgets[0] += total - budgets.reduce((a, b) => a + b, 0); // dồn phần dư làm tròn vào KOC đầu bảng

  const out = rows.map((r, i) => {
    const budget = budgets[i];
    const mid = (r.cost_min + r.cost_max) / 2;
    return {
      rank: i + 1,
      creator_id: r.creator_id,
      name: r.name,
      followers: r.followers,
      total: r.total,
      revenue: r.revenue,
      budget,
      share: total ? budget / total : 0,
      cost_min: r.cost_min,
      cost_max: r.cost_max,
      // Số video mua được nếu trả theo mức thấp nhất của khoảng ước tính — 0 nghĩa là không đủ 1 video
      videos_min_cost: r.cost_min ? Math.floor(budget / r.cost_min) : 0,
      videos_mid_cost: mid ? Math.floor(budget / mid) : 0,
      affordable: r.cost_min > 0 && budget >= r.cost_min,
    };
  });

  const floorSum = out.reduce((a, r) => a + r.cost_min, 0);
  const short = out.filter((r) => !r.affordable);
  const numbers: Record<string, number> = { total, koc_count: out.length, cost_floor_sum: floorSum, not_affordable: short.length };
  out.forEach((r, i) => {
    numbers[`k${i + 1}_budget`] = r.budget;
    numbers[`k${i + 1}_share`] = r.share;
    numbers[`k${i + 1}_cost_min`] = r.cost_min;
    numbers[`k${i + 1}_cost_max`] = r.cost_max;
    numbers[`k${i + 1}_videos_min_cost`] = r.videos_min_cost;
  });

  // Chia theo điểm phù hợp hay cho ra tỉ lệ gần như phẳng (điểm các KOC sít nhau) và có thể để một
  // vài người không đủ tiền cho nổi 1 video. Chia theo chi phí ước tính thì ngân sách bám giá thật
  // nên ai cũng đủ — nói thẳng cho agent biết thay vì để nó trình bày một bảng phẳng như một phát hiện.
  const shares = out.map((r) => r.share);
  const flat = Math.max(...shares) - Math.min(...shares) < 0.05;
  const hint =
    basis !== "cost" && short.length
      ? ` BẮT BUỘC: ${short.length}/${out.length} KOC không đủ 1 video với cách chia này — gọi NGAY allocate_budget lần nữa với basis='cost' (ngân sách bám chi phí ước tính từng người) rồi trình bày phương án đó. Đừng hỏi người bán có muốn thử không, hãy tự so hai cách và khuyến nghị.`
      : flat && basis === "fit"
        ? " LƯU Ý: điểm phù hợp của nhóm này sít nhau nên tỉ lệ chia gần như bằng nhau — đừng trình bày chênh lệch vài phần trăm như một khác biệt đáng kể."
        : "";

  const summary =
    `Phương án chia ${vnd(total)} cho ${out.length} KOC theo ${BASIS_LABEL[basis]}${even ? " (căn cứ bằng 0 nên chia đều)" : ""} — ĐỀ XUẤT THAM KHẢO, chưa ghi vào chiến dịch. ` +
    out
      .map(
        (r) =>
          `#${r.rank} ${r.name} (id ${r.creator_id}): ${vnd(r.budget)} = ${p1(r.share)} ngân sách; chi phí ước tính ${vnd(r.cost_min)}–${vnd(r.cost_max)}/video → ${
            r.affordable ? `đủ ${r.videos_min_cost} video ở mức thấp nhất của khoảng` : "KHÔNG đủ 1 video ngay cả ở mức thấp nhất"
          }`,
      )
      .join(" || ") +
    ` || Tổng chi phí tối thiểu để mỗi KOC làm 1 video là ${vnd(floorSum)} trên ngân sách ${vnd(total)}` +
    (floorSum > total ? ` — THIẾU ${vnd(floorSum - total)}, nhóm này quá đắt so với ngân sách.` : `, còn dư ${vnd(total - floorSum)}.`) +
    " Chi phí/video là ƯỚC TÍNH theo quy mô follower, không phải giá chào thật của KOC." +
    hint;

  return { type: "metric", summary, rows: out, numbers, source: { collection: C.campaigns, ref: campaignId } };
}

// ── Công cụ GHI: sửa chiến dịch ngay trong hội thoại ──────────────────────────
/**
 * Ba công cụ dưới đây là những công cụ DUY NHẤT được ghi vào DB. Chúng tồn tại vì sau khi Tola đưa
 * ra danh sách, người bán thường muốn chỉnh ngay trong câu tiếp theo ("bỏ Ánh Ốc, gợi ý người khác",
 * "tôi chỉ có 60 triệu", "xem kỹ video của Phương Sena hơn") — trước đây phải tạo lại chiến dịch.
 *
 * Nguyên tắc giữ nguyên như pipeline: **code quyết định con số**, agent chỉ giải thích. Mỗi công cụ
 * chạy lại đúng bước cần chạy rồi trả về danh sách MỚI để agent báo cáo:
 *   exclude_koc / update_criteria → S5 (chọn + chia tiền + lý do; 1 lần gọi Haiku, có cache)
 *   deepen_koc                    → S4 (xem video, cache theo video nên chỉ tốn tiền cho video mới) → S5
 *
 * Không có công cụ nào chạy lại S2: chấm điểm lại sẽ xoá kết quả S3/S4 (xem `scoreCampaign`), tức
 * là mất toàn bộ phần đọc nội dung và xem video. Muốn đổi sản phẩm/ngành thì hỏi một câu mới —
 * route sẽ nhận ra đó là brief và chạy phân tích sâu từ đầu.
 */

/** Danh sách sau khi chỉnh — mọi công cụ ghi đều trả về cùng một dạng để agent báo cáo nhất quán. */
async function lineupOut(campaignId: string, head: string, extra: Record<string, number> = {}): Promise<Out> {
  const { camp, rows, picks } = await campaignRows(campaignId);
  const wanted = num(camp.koc_count) || picks.length;
  const chosen = rows.filter((r) => r.picked);
  const numbers: Record<string, number> = { picked: picks.length, wanted, shortlisted: rows.length, ...extra };
  if (num(camp.s5?.allocated)) numbers.allocated = num(camp.s5.allocated);
  if (num(camp.budget_total)) numbers.budget_total = num(camp.budget_total);
  chosen.forEach((r, i) => {
    numbers[`k${i + 1}_total`] = r.total;
    numbers[`k${i + 1}_followers`] = r.followers;
    numbers[`k${i + 1}_revenue`] = r.revenue;
    if (r.budget) numbers[`k${i + 1}_budget`] = r.budget;
  });
  return {
    type: "metric",
    summary:
      `${head} Danh sách MỚI: ${chosen.length}/${wanted} KOC` +
      (num(camp.s5?.allocated) ? `, chia ${vnd(num(camp.s5.allocated))}` : "") +
      (chosen.length < wanted ? ` — KHÔNG đủ ${wanted} người: shortlist chỉ còn ${rows.length} người đạt tiêu chí, hãy nói thẳng điều này.` : ".") +
      " " +
      chosen
        .map((r) => `#${chosen.indexOf(r) + 1} ${r.name} (id ${r.creator_id}): điểm ${r.total}; ${compact(r.followers)} follower; ngân sách ${vnd(r.budget)}`)
        .join(" || ") +
      ` || Dự phòng: ${rows.filter((r) => !r.picked).slice(0, 5).map((r) => `${r.name} (điểm ${r.total})`).join(", ") || "không còn ai"}`,
    rows,
    numbers,
    source: { collection: C.campaigns, ref: campaignId },
  };
}

async function excludeKoc({ campaignId }: ToolCtx, args: Args): Promise<Out> {
  if (!campaignId) throw new Error("Chưa có chiến dịch nào trong hội thoại này — chỉ dùng được sau khi đã chạy phân tích tìm KOC");
  const ids = (Array.isArray(args.creator_ids) ? args.creator_ids : []).map(String).filter(Boolean);
  if (!ids.length) throw new Error("creator_ids rỗng — lấy đúng id từ campaign_context, đừng truyền tên");
  if (ids.length > EXCLUDE_MAX_KOCS)
    throw new Error(`Mỗi lần chỉ bỏ tối đa ${EXCLUDE_MAX_KOCS} KOC để đề xuất không bị xáo trộn quá nhiều — hỏi lại người bán xem cụ thể muốn bỏ ai`);

  const { rows } = await campaignRows(campaignId);
  const byId = new Map(rows.map((r) => [r.creator_id, r]));
  const bad = ids.filter((id) => !byId.has(id));
  if (bad.length) throw new Error(`creator_id ${bad.join(", ")} không có trong danh sách của chiến dịch — lấy id từ campaign_context`);

  const db = await getDb();
  // `undo` để đưa người đã bỏ quay lại — người bán đổi ý là chuyện thường, không có đường về thì
  // hội thoại bị kẹt và cách duy nhất là chạy lại cả phân tích.
  const undo = args.undo === true;
  await db
    .collection(C.campaigns)
    .updateOne({ _id: campaignId as never }, (undo ? { $pull: { excluded_creator_ids: { $in: ids } } } : { $addToSet: { excluded_creator_ids: { $each: ids } } }) as never);
  await runS5(campaignId); // chọn lại trong shortlist còn lại, chia lại tiền, viết lại lý do
  const names = ids.map((id) => byId.get(id)!.name).join(", ");
  return lineupOut(
    campaignId,
    undo
      ? `Đã ĐƯA ${names} trở lại danh sách xét chọn và chọn lại (họ chỉ vào danh sách nếu điểm đủ cao).`
      : `Đã BỎ ${names} khỏi chiến dịch${args.reason ? ` (lý do người bán nêu: ${String(args.reason).slice(0, 120)})` : ""} và chọn người thay thế từ danh sách dự phòng.`,
    { [undo ? "restored" : "excluded"]: ids.length },
  );
}

/** Các tiêu chí sửa được mà KHÔNG phải chấm điểm lại — chỉ ảnh hưởng bước chọn và chia tiền. */
const EDITABLE = ["koc_count", "budget_total", "budget_min_per_koc", "budget_max_per_koc"] as const;

async function updateCriteria({ campaignId }: ToolCtx, args: Args): Promise<Out> {
  if (!campaignId) throw new Error("Chưa có chiến dịch nào trong hội thoại này — chỉ dùng được sau khi đã chạy phân tích tìm KOC");
  const patch: Record<string, number> = {};
  for (const k of EDITABLE) {
    const v = Number(args[k]);
    if (args[k] === undefined || args[k] === null) continue;
    if (!Number.isFinite(v) || v <= 0) throw new Error(`${k} phải là số > 0 (ngân sách tính bằng VND, vd 60 triệu → 60000000)`);
    patch[k] = k === "koc_count" ? int(v, 5, 15) : Math.round(v);
  }
  if (!Object.keys(patch).length) throw new Error(`Không có gì để sửa — chỉ sửa được: ${EDITABLE.join(", ")}. Đổi sản phẩm/ngành thì phải chạy phân tích mới.`);

  const db = await getDb();
  const before = await db.collection(C.campaigns).findOne({ _id: campaignId as never }, { projection: { koc_count: 1, budget_total: 1, budget_max_per_koc: 1, budget_min_per_koc: 1 } });
  if (!before) throw new Error("Không tìm thấy chiến dịch");
  // Ghi cả ở cấp ngoài (S5 đọc chỗ này) và trong `criteria` (nguồn hiển thị của campaign_context)
  const set: Record<string, unknown> = { ...patch };
  for (const [k, v] of Object.entries(patch)) set[`criteria.${k}`] = v;
  await db.collection(C.campaigns).updateOne({ _id: campaignId as never }, { $set: set });
  await runS5(campaignId);

  const changes = Object.entries(patch)
    .map(([k, v]) => `${k}: ${num(before[k]) ? (k === "koc_count" ? String(num(before[k])) : vnd(num(before[k]))) : "chưa đặt"} → ${k === "koc_count" ? String(v) : vnd(v)}`)
    .join("; ");
  // Trần chi phí mỗi KOC còn là một bộ lọc cứng ở bước chấm điểm (S2): nới trần ở đây không gọi
  // những người đã bị loại quay lại được, phải nói rõ kẻo người bán tưởng đã xét lại cả pool.
  const capWarn =
    patch.budget_max_per_koc && patch.budget_max_per_koc > num(before.budget_max_per_koc)
      ? " LƯU Ý phải nói với người bán: nới trần chi phí/KOC chỉ áp lại ở bước chọn trong danh sách hiện có; những KOC từng bị loại vì vượt trần cũ muốn được xét lại thì cần chạy phân tích mới."
      : "";
  return lineupOut(campaignId, `Đã sửa tiêu chí (${changes}) và chọn lại.${capWarn}`, patch);
}

async function deepenKoc({ campaignId }: ToolCtx, args: Args): Promise<Out> {
  if (!campaignId) throw new Error("Chưa có chiến dịch nào trong hội thoại này — chỉ dùng được sau khi đã chạy phân tích tìm KOC");
  const ids = (Array.isArray(args.creator_ids) ? args.creator_ids : args.creator_id ? [args.creator_id] : []).map(String).filter(Boolean);
  if (!ids.length) throw new Error("Chưa biết xem video của ai — truyền creator_id lấy từ campaign_context");
  if (ids.length > DEEPEN_MAX_KOCS)
    throw new Error("Xem video là bước tốn thời gian và tiền nhất nên mỗi lần chỉ xem cho 1 KOC — hỏi người bán xem họ muốn xem kỹ ai trước");
  const id = ids[0];

  const { rows } = await campaignRows(campaignId);
  const row = rows.find((r) => r.creator_id === id);
  if (!row) throw new Error(`creator_id ${id} không có trong danh sách của chiến dịch — lấy id từ campaign_context`);

  const db = await getDb();
  // `pickVideos` của S4 luôn xem KOC nằm trong `deep_creator_ids`, kể cả khi họ ngoài top hoặc
  // vượt trần chi phí: đây là yêu cầu đích danh của người bán, không phải thứ hạng.
  await db.collection(C.campaigns).updateOne({ _id: campaignId as never }, { $addToSet: { deep_creator_ids: id } as never });
  const s4 = await runS4(campaignId); // cache theo video → chỉ video chưa từng xem mới tốn tiền
  await runS5(campaignId); // điểm đổi thì danh sách chọn có thể đổi theo

  const score = await db.collection(C.campaignScores).findOne({ campaign_id: campaignId, creator_id: id }, { projection: { s4: 1, s4_total: 1, s4_rank: 1 } });
  const videos = ((score?.s4?.videos ?? []) as Record<string, unknown>[]).map((v) => ({
    video_id: String(v.video_id),
    title: String(v.title ?? ""),
    product_match: Boolean(v.product_match),
    video_score: num(v.video_score),
    demo_score: num(v.demo_score),
    production_quality: num(v.production_quality),
    authenticity: num(v.authenticity),
    summary: String(v.summary ?? ""),
  }));
  const numbers: Record<string, number> = { videos: videos.length, s4_total: num(score?.s4_total), s4_rank: num(score?.s4_rank), video_score: num(score?.s4?.score) };
  videos.forEach((v, i) => {
    numbers[`v${i + 1}_video_score`] = v.video_score;
    numbers[`v${i + 1}_demo_score`] = v.demo_score;
    numbers[`v${i + 1}_production_quality`] = v.production_quality;
    numbers[`v${i + 1}_authenticity`] = v.authenticity;
  });

  const head = videos.length
    ? `Đã XEM video của ${row.name} (AI đọc 4 khung hình/video, KHÔNG có âm thanh): ` +
      videos
        .map(
          (v) =>
            `“${v.title.slice(0, 60)}” — ${v.product_match ? "CÓ" : "KHÔNG"} thấy sản phẩm của chiến dịch; điểm video ${v.video_score}/100 (demo ${v.demo_score}, hình ${v.production_quality}, tự nhiên ${v.authenticity}); ${v.summary}`,
        )
        .join(" || ") +
      ` || Điểm tổng sau khi xem video: ${num(score?.s4_total)} (hạng ${num(score?.s4_rank)} trong danh sách).`
    : `Không xem được video nào của ${row.name} — KOC này chưa có video nào tải được khung hình. Nói thẳng, đừng suy đoán nội dung.`;
  // KOC đã bị bỏ vẫn xem video được (người bán có thể muốn xét lại), nhưng điểm mới KHÔNG tự đưa họ
  // về danh sách — nói rõ kẻo agent hứa sai.
  const camp = await db.collection(C.campaigns).findOne({ _id: campaignId as never }, { projection: { excluded_creator_ids: 1 } });
  const stillOut = ((camp?.excluded_creator_ids as string[]) ?? []).includes(id)
    ? ` LƯU Ý: ${row.name} đang nằm trong danh sách người bán đã BỎ nên dù điểm thay đổi vẫn không được chọn lại — muốn đưa họ về thì gọi exclude_koc với undo=true.`
    : "";
  const out = await lineupOut(campaignId, head + stillOut, numbers);
  return { ...out, type: "video", cost_usd: s4?.cost_usd ?? 0 };
}

// ── calc ──────────────────────────────────────────────────────────────────────
/** Sai số cho phép khi đối chiếu input của `calc` với số đã có (số tóm tắt bị làm tròn khi agent chép lại). */
const TOLERANCE = 0.005;

async function sessionNumbers(sessionId: string): Promise<number[]> {
  const db = await getDb();
  const docs = await db.collection(C.evidence).find({ session_id: sessionId }, { projection: { numbers: 1, rows: 1 } }).toArray();
  /**
   * Cả số trong HÀNG bảng (doanh thu từng ngày của get_daily, từng shop, từng video…), không chỉ
   * `numbers` tổng hợp. Thiếu thì "tổng 7 ngày gần nhất" bị calc từ chối dù mọi số đều lấy từ công cụ
   * (đã gặp ở bộ test v2, câu K216) — cùng quy tắc với bộ kiểm chứng câu trả lời (answer-verify.ts).
   */
  return docs.flatMap((d) => [
    ...Object.values((d.numbers as Record<string, number>) ?? {}),
    ...((d.rows as Record<string, unknown>[]) ?? []).flatMap((r) => Object.values(r ?? {}).filter((v): v is number => typeof v === "number" && Number.isFinite(v))),
  ]);
}

const known = (v: number, pool: number[]) => pool.some((k) => (k === 0 ? v === 0 : Math.abs(v - k) / Math.abs(k) <= TOLERANCE));

/**
 * Phép tính cho agent: input **phải** là số đã xuất hiện trong kết quả công cụ của phiên (sai số
 * 0,5%), nên agent không thể đưa số tự nghĩ vào rồi "tính" ra một con số có vẻ có nguồn.
 */
async function calc({ sessionId }: ToolCtx, args: Args): Promise<Out> {
  const op = String(args.op ?? "");
  const values = (Array.isArray(args.values) ? args.values : [args.a, args.b]).map(Number).filter((v) => Number.isFinite(v));
  if (!["share", "ratio", "diff", "sum"].includes(op)) throw new Error("op phải là share | ratio | diff | sum");
  if (op !== "sum" && values.length !== 2) throw new Error(`${op} cần đúng 2 số a, b`);
  if (op === "sum" && values.length < 2) throw new Error("sum cần ít nhất 2 số trong values");
  const pool = await sessionNumbers(sessionId);
  const bad = values.filter((v) => !known(v, pool));
  if (bad.length) throw new Error(`Các số ${bad.join(", ")} không có trong kết quả công cụ của phiên — gọi công cụ lấy số trước, không tự đưa số`);
  const [a, b] = values;
  let result: number;
  let text: string;
  if (op === "share") (result = b ? a / b : 0), (text = `${compact(a)} / ${compact(b)} = ${p1(result)}`);
  else if (op === "ratio") (result = b ? a / b : 0), (text = `${compact(a)} so với ${compact(b)} = gấp ${(Math.round(result * 10) / 10).toLocaleString("vi-VN")} lần`);
  else if (op === "diff") (result = a - b), (text = `${compact(a)} − ${compact(b)} = ${compact(result)} (${b ? `${result >= 0 ? "+" : ""}${p1(result / b)}` : "–"})`);
  else (result = values.reduce((x, y) => x + y, 0)), (text = `tổng ${values.map(compact).join(" + ")} = ${compact(result)}`);
  const numbers: Record<string, number> = { result };
  if (op === "diff" && b) numbers.pct_change = result / b;
  return { type: "metric", summary: text, rows: [{ op, values, result }], numbers, source: { collection: C.evidence, ref: `calc:${sessionId}` } };
}

// ── registry ──────────────────────────────────────────────────────────────────
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema cho tham số — MCP server (P3) đưa nguyên cái này cho model. */
  input_schema: Record<string, unknown>;
  run: (ctx: ToolCtx, args: Args) => Promise<Out>;
}

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export const KOC_TOOLS: ToolSpec[] = [
  {
    name: "get_overview",
    description: "Tổng quan kênh 30 ngày: doanh thu cả kênh, số đơn, đơn giá bình quân, tách livestream/video/thẻ shop (% doanh thu kênh), GPM live, tỉ lệ chốt, follower, khán giả (ước tính). Gọi đầu tiên.",
    input_schema: obj(),
    run: getOverview,
  },
  {
    name: "list_products",
    description:
      "Top sản phẩm theo doanh thu: tên đầy đủ, danh mục cấp 1/2/3, giá, số đơn, doanh thu, % doanh thu kênh, số video gắn sản phẩm; kèm độ phủ dữ liệu và tầm giá. Truyền `product` để CHỈ lấy sản phẩm thuộc nhóm đang quan tâm (vd 'kem chống nắng') — bỏ trống sẽ trả top cả kênh, dễ lạc đề.",
    input_schema: obj({
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      product: { type: "string", description: "Lọc theo nhóm sản phẩm, vd 'kem chống nắng' / 'phấn nền' / 'serum'" },
    }),
    run: listProducts,
  },
  {
    name: "category_breakdown",
    description: "Gộp doanh thu sản phẩm theo danh mục cấp 1 (ngành), 2 (danh mục) hoặc 3 (nhóm sản phẩm); tỉ trọng trên doanh thu kênh, phần chưa phân loại, độ phủ dữ liệu.",
    input_schema: obj({ level: { type: "integer", enum: [1, 2, 3], default: 2 } }),
    run: categoryBreakdownTool,
  },
  {
    name: "list_videos",
    description: "Video của KOC sắp theo lượt xem hoặc doanh thu: tiêu đề, ngày đăng, view, like, doanh thu, đơn, quảng cáo (chi phí, ROAS), sản phẩm gắn. Truyền product_id để lấy video bán một sản phẩm cụ thể.",
    input_schema: obj({ sort: { type: "string", enum: ["views", "revenue"], default: "views" }, limit: { type: "integer", minimum: 1, maximum: 30, default: 10 }, product_id: { type: "string" } }),
    run: listVideos,
  },
  {
    name: "analyze_videos",
    description:
      "AI XEM video (4 khung hình + tiêu đề, không có âm thanh): có demo sản phẩm không, thấy sản phẩm gì, chất lượng hình, độ tự nhiên, ghi chú từng khung. Truyền video_ids (tối đa 5, lấy từ list_videos); bỏ trống = 2 video doanh thu cao nhất + 1 video nhiều view nhất. Tốn tiền nếu video chưa từng được xem.",
    input_schema: obj({ video_ids: { type: "array", items: { type: "string" }, maxItems: 5 } }),
    run: analyzeVideos,
  },
  {
    name: "get_daily",
    description: "Doanh thu theo ngày trong kỳ: số ngày có doanh thu, trung bình/ngày, ngày đỉnh và tỉ trọng, nửa đầu vs nửa sau kỳ (độ ổn định, xu hướng).",
    input_schema: obj(),
    run: getDaily,
  },
  {
    name: "get_peers",
    description: "Đối chuẩn với tối đa 10 KOC cùng nhóm sản phẩm và cùng quy mô follower: xếp hạng doanh thu, trung vị/trung bình nhóm, tương tác, doanh thu trên 1.000 lượt xem live.",
    input_schema: obj(),
    run: getPeers,
  },
  {
    name: "search_creators",
    description:
      "TÌM KOC trong toàn bộ dữ liệu đã thu thập (không giới hạn trong danh sách của một chiến dịch). Lọc theo DANH MỤC (ngành / nhóm / loại — chính xác nhất, xếp theo doanh thu KOC trong đúng danh mục đó), SẢN PHẨM ĐÃ BÁN, tên/handle, follower, doanh thu tối thiểu, độ tuổi khán giả, MCN; xếp theo doanh thu / tương tác / lượt xem / follower / tăng trưởng. Dùng khi người bán hỏi tìm KOC mới, hoặc cần so với một KOC nằm ngoài danh sách hiện có. Mặc định bỏ kênh do nhà bán tự vận hành.",
    input_schema: obj({
      q: { type: "string", description: "Tên hoặc handle KOC cần tìm (khớp gần đúng)" },
      category: { type: "string", description: "Tên hoặc id danh mục (ngành/nhóm/loại), vd 'Serum & Tinh chất', 'Chăm sóc da', 'Trang phục nữ' — lấy từ list_categories" },
      product: {
        type: "string",
        description:
          "Lọc theo SẢN PHẨM đã bán, vd 'kem chống nắng' / 'phấn nền' / 'serum'. Tra tên sản phẩm thật trong dữ liệu bán hàng, có bảng đồng nghĩa. Khi dùng, thứ hạng mặc định theo doanh thu CHÍNH sản phẩm đó. Dùng cái này thay cho việc gọi list_products từng KOC để tự dò.",
      },
      min_followers: { type: "number" },
      max_followers: { type: "number" },
      min_revenue: { type: "number", description: "Doanh thu 30 ngày tối thiểu (theo phạm vi ngành đã crawl), VND" },
      age: { type: "string", enum: ["18-24", "25-34", "35-44", "45-54", "55+"], description: "Nhóm tuổi khán giả chiếm đa số" },
      mcn: { type: "string", enum: ["yes", "no"] },
      sort: { type: "string", enum: ["revenue", "engagement", "views", "followers", "growth"], default: "revenue" },
      limit: { type: "integer", minimum: 1, maximum: 30, default: 10 },
      include_seller_accounts: { type: "boolean", default: false },
    }),
    run: searchCreators,
  },
  {
    name: "list_campaigns",
    description: "Danh sách chiến dịch đã tạo (mới nhất trước): id, yêu cầu gốc, danh mục, số KOC, ngân sách, tiến độ. Dùng khi người bán nhắc tới một chiến dịch mà chưa cho id.",
    input_schema: obj(),
    run: listCampaignsTool,
  },
  {
    name: "campaign_context",
    description:
      "CHỈ trong chat chiến dịch: tiêu chí, tiến độ, danh sách KOC được chọn + dự phòng (id, tên, điểm phù hợp từng thành phần, ngân sách đã chia, chi phí ước tính) và bằng chứng chấm điểm của từng KOC. Gọi đầu tiên khi hỏi về chiến dịch.",
    input_schema: obj(),
    run: campaignContext,
  },
  {
    name: "allocate_budget",
    description:
      "CHỈ trong chat chiến dịch: tính PHƯƠNG ÁN chia một tổng ngân sách cho các KOC (tỉ lệ theo điểm phù hợp / doanh thu / chi phí ước tính), kèm % ngân sách, chi phí ước tính/video của từng KOC và số video mua được — chỉ ra ai không đủ tiền cho nổi 1 video. Dùng khi người bán hỏi 'chia ngân sách thế nào' hoặc đưa ra một con số ngân sách. Là đề xuất tham khảo, KHÔNG ghi vào chiến dịch.",
    input_schema: obj(
      {
        total: { type: "number", description: "Tổng ngân sách VND, lấy đúng con số người bán vừa nói (vd 100 triệu → 100000000)" },
        creator_ids: { type: "array", items: { type: "string" }, description: "KOC muốn chia, lấy id từ campaign_context. Bỏ trống = nhóm dẫn đầu theo số KOC của chiến dịch." },
        koc_count: { type: "integer", minimum: 1, maximum: 15, description: "Số KOC khi không truyền creator_ids" },
        basis: { type: "string", enum: ["fit", "revenue", "cost"], default: "fit" },
      },
      ["total"],
    ),
    run: allocateBudget,
  },
  {
    name: "exclude_koc",
    description:
      "GHI: BỎ KOC khỏi chiến dịch rồi tự chọn người thay thế từ danh sách dự phòng và chia lại ngân sách. Dùng khi người bán nói không muốn hợp tác với ai đó ('bỏ Ánh Ốc đi, gợi ý người khác'). Người bán đổi ý thì gọi lại với undo=true để đưa họ về. Tối đa 3 người mỗi lần. Trả về danh sách MỚI — báo cáo đúng danh sách này.",
    input_schema: obj(
      {
        creator_ids: { type: "array", items: { type: "string" }, maxItems: EXCLUDE_MAX_KOCS, description: "id KOC cần bỏ, lấy từ campaign_context (không phải tên)" },
        reason: { type: "string", description: "Lý do người bán nêu, nếu có — chỉ để ghi lại" },
        undo: { type: "boolean", description: "true = ĐƯA những người này TRỞ LẠI danh sách xét chọn (người bán đổi ý sau khi đã bỏ)" },
      },
      ["creator_ids"],
    ),
    run: excludeKoc,
  },
  {
    name: "update_criteria",
    description:
      "GHI: sửa SỐ KOC hoặc NGÂN SÁCH của chiến dịch rồi chọn lại và chia lại tiền. Dùng khi người bán đổi ý ('tôi chỉ có 60 triệu', 'cho tôi 8 người'). Chỉ sửa được 4 tham số này; muốn đổi sản phẩm/ngành/độ tuổi thì KHÔNG dùng công cụ này, hãy nói người bán hỏi một câu tìm KOC mới. Trả về danh sách MỚI.",
    input_schema: obj({
      koc_count: { type: "integer", minimum: 1, maximum: 15 },
      budget_total: { type: "number", description: "Tổng ngân sách VND (60 triệu → 60000000)" },
      budget_min_per_koc: { type: "number", description: "Ngân sách tối thiểu mỗi KOC, VND" },
      budget_max_per_koc: { type: "number", description: "Trần ngân sách mỗi KOC, VND" },
    }),
    run: updateCriteria,
  },
  {
    name: "deepen_koc",
    description:
      "GHI: cho AI XEM VIDEO của MỘT KOC trong chiến dịch (4 khung hình/video, không có âm thanh) để kiểm chứng họ có thật sự demo sản phẩm, rồi cập nhật điểm và chọn lại. Dùng khi người bán muốn xem kỹ một người cụ thể. Chỉ 1 KOC mỗi lần vì đây là bước tốn tiền và chậm nhất — không bao giờ gọi cho cả danh sách.",
    input_schema: obj({ creator_id: { type: "string", description: "id KOC muốn xem video, lấy từ campaign_context" } }, ["creator_id"]),
    run: deepenKoc,
  },
  {
    name: "list_categories",
    description:
      "CÂY DANH MỤC đa ngành của dữ liệu (cấp 1 ngành → cấp 2 nhóm → cấp 3 loại) kèm số sản phẩm, số KOC, doanh thu mỗi nút. Không truyền parent = các ngành cấp 1; truyền tên/id một danh mục = các nhóm/loại con của nó. Dùng để biết dữ liệu có ngành/nhóm gì, nhóm nào lớn nhất, và lấy đúng tên/id danh mục trước khi lọc search_products.",
    input_schema: obj({
      parent: { type: "string", description: "Tên hoặc id danh mục cha, vd 'Chăm sóc da' / 'Trang phục nữ'. Bỏ trống = các ngành cấp 1" },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 15 },
    }),
    run: listCategories,
  },
  {
    name: "search_products",
    description:
      "Tìm SẢN PHẨM trong toàn bộ dữ liệu theo DANH MỤC (category — chính xác nhất, lấy tên/id từ list_categories) và/hoặc từ khoá tên (không phân biệt dấu), xếp theo doanh thu / số đơn / số KOC bán; kèm giá, shop, KOC bán nhiều nhất. Dùng cho câu hỏi về SẢN PHẨM: 'loại dưỡng ẩm nào tốt/hot/bán chạy nhất', 'serum nào đang bán chạy', 'giá kem chống nắng phổ biến'. Ưu tiên category (vd 'Kem dưỡng ẩm & Xịt thơm') để không lẫn nhóm trùng chữ; thêm keywords để thu hẹp (vd category 'Chăm sóc da' + keywords ['da khô']). Một phần danh mục được suy ra từ tên nên vẫn có thể sót — muốn phủ rộng thì gọi thêm một lần chỉ với keywords đồng nghĩa. Doanh thu là phần ghi nhận qua các KOC đã thu thập.",
    input_schema: obj(
      {
        category: { type: "string", description: "Tên hoặc id danh mục (cấp nào cũng được), vd 'Kem dưỡng ẩm & Xịt thơm', 'Son môi', 'Áo nữ'" },
        keywords: { type: "array", items: { type: "string" }, maxItems: 6, description: "Từ khoá trong tên sản phẩm (OR), có dấu hay không dấu đều được" },
        exclude: { type: "array", items: { type: "string" }, maxItems: 8, description: "Loại sản phẩm có tên chứa các từ này — nhóm trùng chữ nhưng khác loại, vd hỏi kem dưỡng ẩm cho DA thì loại son, môi, tóc, body" },
        sort: { type: "string", enum: ["revenue", "orders", "kocs"], default: "revenue" },
        limit: { type: "integer", minimum: 1, maximum: 30, default: 10 },
      },
      [],
    ),
    run: searchProducts,
  },
  {
    name: "list_shops",
    description:
      "Các CỬA HÀNG (shop / nhà bán / thương hiệu) mà KOC hợp tác bán hàng — tab 'Cửa hàng' của Kalodata: tên shop, thương hiệu hay nhà bán lẻ, doanh thu KOC bán cho shop đó (% tổng), tách live/video, số đơn, số sản phẩm. Dùng khi hỏi 'bán cho shop nào', 'hợp tác với thương hiệu nào', 'có bán cho X không'. Truyền `shop` để lọc theo tên.",
    input_schema: obj({
      shop: { type: "string", description: "Lọc theo tên shop/thương hiệu, vd 'Lubylab'" },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
    }),
    run: listShops,
  },
  {
    name: "start_campaign_analysis",
    description:
      "Mở PHÂN TÍCH SÂU tuyển KOC cho một chiến dịch: lọc & chấm điểm toàn bộ KOC trong ngành, AI đọc nội dung + xem khung hình video để kiểm chứng demo sản phẩm, chọn KOC trong ngân sách và chia tiền — mất vài phút. " +
      "DÙNG KHI người bán muốn TUYỂN/BOOK KOC để quảng bá một sản phẩm/ngành hàng của họ (thường kèm số KOC cần, ngân sách, khán giả mục tiêu, MCN, yêu cầu về review), vd 'tìm 5 KOC bán kem chống nắng, nữ 18-30, ngân sách 30 triệu', 'cần 10 KOC trang điểm chưa ký MCN'. " +
      "KHÔNG dùng cho câu tra cứu / xếp hạng / so sánh ('top 20 KOC doanh thu cao nhất', 'ai nhiều follower nhất', 'so A với B') — những câu đó dùng search_creators. " +
      "Gọi xong thì DỪNG NGAY, không gọi thêm công cụ, không viết câu trả lời: hệ thống tự chạy phân tích rồi giao lại kết quả cho bạn ở lượt sau.",
    input_schema: obj(
      { brief: { type: "string", description: "Yêu cầu tuyển KOC, chép NGUYÊN VĂN lời người bán (gộp cả chi tiết họ nói ở các câu trước trong hội thoại, nếu có)" } },
      ["brief"],
    ),
    run: async (_ctx, args) => ({
      type: "metric",
      summary: `Đã nhận yêu cầu tuyển KOC: '${String(args.brief ?? "").slice(0, 200)}'. Hệ thống sẽ chạy phân tích sâu ngay sau lượt này. DỪNG lại bây giờ: không gọi thêm công cụ, chỉ trả lời đúng một dòng "ok".`,
      rows: [],
      numbers: {},
      source: { collection: C.campaigns, ref: "start_campaign_analysis" },
    }),
  },
  {
    name: "calc",
    description: "Tính toán từ số ĐÃ CÓ trong kết quả công cụ của phiên (sai số 0,5%): share = a/b dạng %, ratio = a/b dạng 'gấp n lần', diff = a−b, sum = tổng values. Số không có nguồn bị từ chối.",
    input_schema: obj({ op: { type: "string", enum: ["share", "ratio", "diff", "sum"] }, a: { type: "number" }, b: { type: "number" }, values: { type: "array", items: { type: "number" } } }, ["op"]),
    run: calc,
  },
];

const evidenceId = (sessionId: string, tool: string, args: Args) =>
  `ev_s_${sessionId}_${tool}_${createHash("sha1").update(JSON.stringify(args ?? {})).digest("hex").slice(0, 8)}`;

/** Chạy một công cụ và ghi kết quả thành bằng chứng của phiên. */
export async function runKocTool(name: string, ctx: ToolCtx, args: Args = {}): Promise<ToolResult> {
  const spec = KOC_TOOLS.find((t) => t.name === name);
  if (!spec) throw new Error(`Không có công cụ ${name}; có: ${KOC_TOOLS.map((t) => t.name).join(", ")}`);
  const out = await spec.run(ctx, args);
  const _id = evidenceId(ctx.sessionId, name, args);
  const db = await getDb();
  await db.collection(C.evidence).replaceOne(
    { _id: _id as never },
    {
      campaign_id: null,
      creator_id: ctx.creatorId,
      session_id: ctx.sessionId,
      key: name,
      args,
      type: out.type,
      claim: out.summary,
      value: null,
      rows: out.rows,
      numbers: out.numbers,
      source: out.source,
      strength: name === "analyze_videos" ? "medium" : "strong",
      cost_usd: out.cost_usd ?? 0,
      version: KOC_TOOLS_VERSION,
      created_at: new Date(),
    },
    { upsert: true },
  );
  return { evidence_id: _id, tool: name, summary: out.summary, rows: out.rows, numbers: out.numbers };
}
