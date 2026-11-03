import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";
import { compact, pct, vnd } from "../format";
import { analyseVideo } from "../pipeline/s4-video";
import { topBrand } from "../evidence/creator";
import { categoryBreakdown, channelTotals, denominator, productFacts, UNCATEGORISED, type CategoryLevel } from "./facts";

/**
 * Bộ công cụ cho agent hỏi đáp về KOC (docs/10-koc-agent.md, P2). Mỗi hàm **chỉ đọc DB**, trả
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
    if (t.live_gpm) (numbers.live_gpm = t.live_gpm), parts.push(`doanh thu trên 1.000 lượt xem live ${vnd(t.live_gpm)}`);
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
  const top = products.slice(0, limit);
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
    db.collection(C.videos).find({ creator_id: creatorId }, { projection: { views: 1, likes: 1, revenue: 1, is_ad: 1 } }).toArray(),
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
  const numbers: Record<string, number> = {
    videos_total: all.length,
    videos_views: totViews,
    videos_revenue: totRev,
    videos_ads: all.filter((v) => v.is_ad).length,
    videos_avg_views: all.length ? totViews / all.length : 0,
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
      `${all.length} video đã thu thập (30 ngày), tổng ${compact(totViews)} lượt xem, ${vnd(totRev)} doanh thu từ video, ${numbers.videos_ads} video chạy quảng cáo. ` +
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
 * tốn tiền; tối đa 3 video mỗi lần. Điểm số là nhận định của AI, không phải số đo.
 */
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
    for (const v of [byRev[0], byRev[1], byViews[0], ...byViews]) if (v && !picks.some((p) => p._id === v._id) && picks.length < 3) picks.push(v);
  }
  picks = picks.slice(0, 3);
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

  const all = [
    { creator_id: creatorId, name: String(creator?.nickname ?? ""), handle: String(creator?.handle ?? ""), followers, revenue: myRev, engagement: myEng, live_gpm: gpm.get(creatorId) ?? 0, self: true },
    ...peers.map((r) => {
      const m = meta.get(String(r.creator_id))!;
      return { creator_id: String(r.creator_id), name: m.name, handle: m.handle, followers: m.followers, revenue: num(r.revenue), engagement: num(r.video_engagement_rate), live_gpm: gpm.get(String(r.creator_id)) ?? 0, self: false };
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
  return {
    type: "metric",
    summary:
      `Nhóm đối chuẩn ${peers.length} KOC cùng nhóm sản phẩm, ${compact(band.lo)}–${compact(band.hi)} follower, có bán hàng thật. Doanh thu mỹ phẩm 30 ngày: KOC này ${vnd(myRev)}, xếp ${
        numbers.revenue_rank
      }/${rows.length}; trung vị nhóm ${vnd(numbers.median_revenue)}, trung bình nhóm ${vnd(numbers.mean_revenue)}. Tương tác video ${pct(myEng)} vs trung vị ${pct(numbers.median_engagement)}` +
      (numbers.my_live_gpm
        ? `. Doanh thu/1.000 lượt xem live ${vnd(myGpm)} vs trung vị ${vnd(numbers.median_live_gpm)}, xếp ${numbers.live_gpm_rank}/${gpms.length + 1}`
        : "") +
      `. Danh sách: ` +
      rows.map((r) => `#${r.rank} ${r.name}${r.self ? " (KOC này)" : ""} ${vnd(r.revenue)}, ${compact(r.followers)} follower`).join("; "),
    rows,
    numbers,
    source: { collection: C.creatorMetrics, ref: `peers:${peers.length}` },
  };
}

// ── campaign_context ──────────────────────────────────────────────────────────
const SCORE_LABEL: Record<string, string> = {
  performance: "hiệu suất",
  content_fit: "hợp sản phẩm",
  engagement: "tương tác",
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
async function campaignContext({ campaignId }: ToolCtx): Promise<Out> {
  if (!campaignId) throw new Error("Công cụ này chỉ dùng trong chat chiến dịch");
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

  const rows = scores.map((s) => {
    const id = String(s.creator_id);
    const c = creators.get(id);
    const total = num(s.s4_total ?? s.s3_total ?? s.total);
    return {
      rank: num(s.s4_rank ?? s.s3_rank ?? s.rank),
      creator_id: id,
      name: String(c?.nickname || c?.handle || id),
      handle: String(c?.handle ?? ""),
      followers: num(c?.followers),
      picked: budgetOf.has(id),
      budget: budgetOf.get(id) ?? 0,
      total: Math.round(total * 10) / 10,
      scores: (s.scores as Record<string, number>) ?? {},
      revenue: num(s.revenue),
      cost_min: num((s.cost_estimate as { min?: number })?.min),
      cost_max: num((s.cost_estimate as { max?: number })?.max),
      evidence: ((s.evidence_ids as string[]) ?? []).map((e) => claims.get(e)).filter(Boolean) as string[],
    };
  });
  rows.sort((a, b) => Number(b.picked) - Number(a.picked) || a.rank - b.rank);
  const numbers: Record<string, number> = { shortlisted: rows.length, picked: picks.length };
  const crit = (camp.criteria ?? {}) as Record<string, unknown>;
  if (num(crit.budget_total)) numbers.budget_total = num(crit.budget_total);
  if (num(camp.s5?.allocated)) numbers.allocated = num(camp.s5?.allocated);
  if (camp.scoring) Object.assign(numbers, { pool: num(camp.scoring.pool), eligible: num(camp.scoring.eligible) });
  rows.forEach((r, i) => {
    numbers[`k${i + 1}_total`] = r.total;
    numbers[`k${i + 1}_followers`] = r.followers;
    numbers[`k${i + 1}_revenue`] = r.revenue;
    if (r.budget) numbers[`k${i + 1}_budget`] = r.budget;
    for (const [k, v] of Object.entries(r.scores)) numbers[`k${i + 1}_${k}`] = num(v);
  });
  const critText = Object.entries(crit)
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("/") : typeof v === "number" && v >= 1e5 ? vnd(v) : String(v)}`)
    .join(", ");
  return {
    type: "metric",
    summary:
      `Chiến dịch ${String(camp.category_name ?? "")}${camp.prompt ? ` — yêu cầu gốc: '${String(camp.prompt).slice(0, 160)}'` : ""}. Tiêu chí: ${critText || "chưa đặt"}. ` +
      (camp.scoring ? `Đã lọc ${camp.scoring.pool} KOC → ${camp.scoring.eligible} đạt tiêu chí. ` : "") +
      (camp.s5 ? `Đã chọn ${picks.length} KOC, chia ${vnd(num(camp.s5.allocated))}. ` : "Chưa chọn KOC/chia ngân sách. ") +
      `Điểm phù hợp 0-100 do code chấm (trọng số theo tiêu chí), KHÔNG được tính lại. ` +
      rows
        .map(
          (r, i) =>
            `#${i + 1} ${r.name} (id ${r.creator_id}, ${r.picked ? `ĐƯỢC CHỌN, ngân sách ${vnd(r.budget)}` : "dự phòng"}): điểm ${r.total}; ${Object.entries(r.scores)
              .map(([k, v]) => `${SCORE_LABEL[k] ?? k} ${v}`)
              .join(", ")}; ${compact(r.followers)} follower; chi phí ước tính ${vnd(r.cost_min)}–${vnd(r.cost_max)}/video. Bằng chứng: ${r.evidence.join(" | ")}`,
        )
        .join(" || "),
    rows,
    numbers,
    source: { collection: C.campaigns, ref: campaignId },
  };
}

// ── calc ──────────────────────────────────────────────────────────────────────
/** Sai số cho phép khi đối chiếu input của `calc` với số đã có (số tóm tắt bị làm tròn khi agent chép lại). */
const TOLERANCE = 0.005;

async function sessionNumbers(sessionId: string): Promise<number[]> {
  const db = await getDb();
  const docs = await db.collection(C.evidence).find({ session_id: sessionId }, { projection: { numbers: 1 } }).toArray();
  return docs.flatMap((d) => Object.values((d.numbers as Record<string, number>) ?? {}));
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
    description: "Top sản phẩm theo doanh thu: tên đầy đủ, danh mục cấp 1/2/3, giá, số đơn, doanh thu, % doanh thu kênh, số video gắn sản phẩm; kèm độ phủ dữ liệu và tầm giá.",
    input_schema: obj({ limit: { type: "integer", minimum: 1, maximum: 50, default: 10 } }),
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
      "AI XEM video (4 khung hình + tiêu đề, không có âm thanh): có demo sản phẩm không, thấy sản phẩm gì, chất lượng hình, độ tự nhiên, ghi chú từng khung. Truyền video_ids (tối đa 3, lấy từ list_videos); bỏ trống = 2 video doanh thu cao nhất + 1 video nhiều view nhất. Tốn tiền nếu video chưa từng được xem.",
    input_schema: obj({ video_ids: { type: "array", items: { type: "string" }, maxItems: 3 } }),
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
    name: "campaign_context",
    description:
      "CHỈ trong chat chiến dịch: tiêu chí, tiến độ, danh sách KOC được chọn + dự phòng (id, tên, điểm phù hợp từng thành phần, ngân sách đã chia, chi phí ước tính) và bằng chứng chấm điểm của từng KOC. Gọi đầu tiên khi hỏi về chiến dịch.",
    input_schema: obj(),
    run: campaignContext,
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
