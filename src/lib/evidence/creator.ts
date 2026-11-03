import "server-only";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";
import type { Evidence } from "../scoring/run";
import { estimateCost, percentileOf } from "../scoring/rules";
import { compact, pct, vnd } from "../format";
import { contactItems } from "../contact";
import { categoryBreakdown, channelTotals, denominator, productFacts } from "../koc-data/facts";

/**
 * Bằng chứng về một KOC, **không gắn chiến dịch nào** (`campaign_id: null`).
 *
 * Khác với evidence của S2: ở đó percentile tính trong nhóm đủ điều kiện của riêng một chiến dịch
 * ("top 35% nhóm đủ điều kiện") nên không mang sang chỗ khác được. Ở đây percentile tính trên
 * **toàn bộ pool đã crawl**, nên claim có nghĩa ở mọi ngữ cảnh — dùng cho chat ở trang hồ sơ KOC.
 *
 * Mọi con số do code lấy từ DB; AI chỉ được trích `evidence_id` (xem `validateReasons`).
 */
export const CREATOR_EVIDENCE_VERSION = "koc-ev-v2";

const COSMETICS = "848776,848648";

/** Id ổn định: chạy lại sinh đúng id cũ nên lý do đã trích trong tin nhắn cũ vẫn trỏ được. */
const evId = (creatorId: string, key: string) => `ev_koc_${creatorId}_${key}`;

/**
 * Nhãn mức do **code** quyết định. Nếu chỉ đưa percentile trần, AI có thể diễn giải ngược
 * ("cao hơn 19% KOC" → viết thành "cao hơn hầu hết các KOC"); mà câu diễn giải không chứa con số
 * nên `validateReasons` không bắt được. Dán sẵn nhãn thì AI chỉ việc chép lại.
 */
function tier(p: number): string {
  if (p >= 0.8) return "nhóm dẫn đầu";
  if (p >= 0.6) return "trên trung bình";
  if (p >= 0.4) return "quanh mức trung bình";
  if (p >= 0.2) return "dưới trung bình";
  return "nhóm thấp";
}

/** Một KOC trong nhóm đối chuẩn, để hiển thị kèm avatar làm dẫn chứng so sánh. */
export interface PeerRef {
  creator_id: string;
  name: string;
  followers: number;
  revenue: number;
  engagement: number;
  /** Đã có sẵn phân tích AI trong cache → mở hồ sơ là có kết quả ngay, 0 token. */
  analysed?: boolean;
}

/** Kết quả đối chuẩn: nhóm cùng tầm + vị trí của KOC trong nhóm (tất cả do code tính). */
export interface PeerStats {
  count: number;
  band: { lo: number; hi: number };
  median_revenue: number;
  median_engagement: number;
  my_revenue: number;
  my_engagement: number;
  top: PeerRef[];
}

/**
 * So bội số thay vì phần trăm khi chênh lệch lớn: "cao hơn 10486%" đọc vô nghĩa, "gấp 105 lần"
 * thì hiểu ngay.
 */
export function ratioText(mine: number, median: number): string {
  if (!(median > 0)) return "nhóm chưa có số liệu để so";
  const r = mine / median;
  if (r >= 2) return `gấp ${(Math.round(r * 10) / 10).toLocaleString("vi-VN")} lần trung vị nhóm`;
  if (r >= 1) return `cao hơn trung vị nhóm ${Math.round((r - 1) * 100)}%`;
  return `thấp hơn trung vị nhóm ${Math.round((1 - r) * 100)}%`;
}

/** Sản phẩm để hiển thị kèm ảnh bìa trong câu trả lời (ảnh lấy từ CDN Kalodata theo `product_id`). */
export interface ProductRef {
  product_id: string;
  name: string;
  revenue: number;
  share: number; // tỷ trọng trên doanh thu kênh (koc-data/facts.ts)
}

/**
 * Phần "báo cáo" của câu trả lời: tiêu đề, bảng danh mục, bảng top sản phẩm — **do code dựng từ DB**,
 * AI không đụng vào. Nhờ vậy báo cáo vừa đầy đủ như một bản phân tích thật vừa không thể bịa số.
 */
export interface CreatorReport {
  period_days: number;
  revenue: number;
  products_count: number;
  videos_count: number;
  followers: number;
  /** Danh mục cấp 2 → nhóm sản phẩm cấp 3 bán chủ lực. */
  categories: { name: string; revenue: number; share: number; sub: string[] }[];
  top_products: { rank: number; product_id: string; name: string; revenue: number; share: number; sales_volume: number }[];
  /** Video nổi bật theo lượt xem — 0 token, không liên quan tới bước "AI xem video". */
  top_videos: { rank: number; video_id: string; title: string; views: number; likes: number; revenue: number; is_ad: boolean }[];
}

export async function creatorReport(creatorId: string): Promise<CreatorReport | null> {
  const db = await getDb();
  const creator = await db.collection(C.creators).findOne({ _id: creatorId as never });
  if (!creator) return null;
  const [totals, rows] = await Promise.all([channelTotals(creatorId), productFacts(creatorId)]);
  // Mẫu số chung với bằng chứng chat: doanh thu kênh (xem koc-data/facts.ts)
  const { revenue: total } = denominator(totals, rows);

  /**
   * Video nổi bật: người bán muốn thấy KOC đăng gì và video nào kéo được doanh thu. Dữ liệu này đã
   * nằm sẵn trong `videos` (views/likes/revenue/is_ad) nhưng trước giờ chỉ được tóm tắt thành một
   * câu "38 video, nhiều view nhất 49,8k" — bỏ phí gần hết.
   */
  const vidRows = await db
    .collection(C.videos)
    .find({ creator_id: creatorId }, { projection: { title: 1, views: 1, likes: 1, revenue: 1, is_ad: 1 } })
    .sort({ views: -1 })
    .limit(6)
    .toArray();

  // Sản phẩm Kalodata chưa gắn phân loại hiện là "Chưa phân loại" (5/55 với @phuongsena) — gọi là
  // "Khác" khiến bảng đọc như thể KOC có một mảng hàng khác.
  return {
    period_days: 30,
    revenue: total,
    products_count: rows.length,
    videos_count: await db.collection(C.videos).countDocuments({ creator_id: creatorId }),
    followers: (creator.followers as number) ?? 0,
    categories: categoryBreakdown(rows, 2, total).slice(0, 4).map(({ name, revenue, share, sub }) => ({ name, revenue, share, sub })),
    top_products: rows.slice(0, 10).map((r, i) => ({
      rank: i + 1,
      product_id: r.product_id,
      name: r.name,
      revenue: r.revenue,
      share: total ? r.revenue / total : 0,
      sales_volume: r.sales_volume,
    })),
    top_videos: vidRows.map((v, i) => ({
      rank: i + 1,
      video_id: String(v._id),
      title: String(v.title ?? "").slice(0, 120),
      views: (v.views as number) ?? 0,
      likes: (v.likes as number) ?? 0,
      revenue: (v.revenue as number) ?? 0,
      is_ad: Boolean(v.is_ad),
    })),
  };
}

/**
 * Đoán thương hiệu chiếm ưu thế từ tên sản phẩm. Kalodata không trả về trường brand, nên đây là
 * suy đoán: lấy token xuất hiện ở nhiều sản phẩm nhất, bỏ các từ mô tả chung. Claim nói rõ là
 * "xuất hiện nhiều nhất trong tên sản phẩm" chứ không khẳng định là thương hiệu chính thức.
 */
const BRAND_STOP = new Set(
  ("kem nuoc tong hop combo set sach chai tuyp hop goi mien mieng tinh chat duong am da mat nang chong serum mask sua rua tay trang phan mat nen " +
    "size big new live kol mt ch dg ml gr g x the for and of cho voi tu va mua tang free qua")
    .split(" ")
    .filter(Boolean),
);
const deAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function topBrand(products: { name?: string; revenue?: number }[]): { name: string; count: number; revenue: number } | null {
  const byToken = new Map<string, { count: number; revenue: number; display: string }>();
  for (const p of products) {
    const seen = new Set<string>();
    for (const raw of String(p.name ?? "").split(/[^\p{L}\p{N}]+/u)) {
      if (raw.length < 4) continue;
      const key = deAccent(raw);
      if (BRAND_STOP.has(key) || /^\d+$/.test(key) || seen.has(key)) continue;
      seen.add(key);
      const e = byToken.get(key) ?? { count: 0, revenue: 0, display: raw };
      e.count++;
      e.revenue += p.revenue ?? 0;
      byToken.set(key, e);
    }
  }
  const best = [...byToken.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue)[0];
  // Xuất hiện ở ít nhất 3 sản phẩm mới đáng gọi là "chiếm ưu thế"
  return best && best.count >= 3 ? { name: best.display, count: best.count, revenue: best.revenue } : null;
}

/** Top sản phẩm theo doanh thu — dùng làm dẫn chứng trực quan, không qua AI. */
export async function topProducts(creatorId: string, limit = 4): Promise<ProductRef[]> {
  const [totals, rows] = await Promise.all([channelTotals(creatorId), productFacts(creatorId)]);
  const { revenue: sum } = denominator(totals, rows);
  return rows.slice(0, limit).map((r) => ({ product_id: r.product_id, name: r.name, revenue: r.revenue, share: sum ? r.revenue / sum : 0 }));
}

export async function creatorEvidence(creatorId: string): Promise<{ claims: Map<string, string>; peers: PeerStats | null }> {
  const db = await getDb();
  const creator = await db.collection(C.creators).findOne({ _id: creatorId as never });
  if (!creator) return { claims: new Map(), peers: null };

  // Pool để so sánh: toàn bộ KOC mỹ phẩm đã crawl (độc lập chiến dịch)
  const pool = await db
    .collection(C.creatorMetrics)
    .find({ source: "web:creator/queryList", category_scope: COSMETICS }, { projection: { creator_id: 1, revenue: 1, views: 1, video_engagement_rate: 1 } })
    .toArray();
  const pRev = percentileOf(pool.map((r) => (r.revenue as number) ?? 0));
  const pViews = percentileOf(pool.map((r) => (r.views as number) ?? 0));
  const pEng = percentileOf(pool.map((r) => (r.video_engagement_rate as number) ?? 0));

  const list = await db.collection(C.creatorMetrics).findOne({ creator_id: creatorId, source: "web:creator/queryList", category_scope: COSMETICS }, { sort: { updated_at: -1 } });
  // Số liệu kênh + sản phẩm từ MỘT nguồn (koc-data/facts.ts) — bảng báo cáo đọc cùng nguồn nên
  // câu trả lời không thể tự mâu thuẫn với bảng nằm ngay dưới nó.
  const [totals, products] = await Promise.all([channelTotals(creatorId), productFacts(creatorId)]);
  const videos = await db.collection(C.videos).find({ creator_id: creatorId }).sort({ views: -1 }).limit(30).toArray();

  const docs: Evidence[] = [];
  const add = (key: string, e: Omit<Evidence, "_id" | "campaign_id" | "creator_id" | "key">) =>
    docs.push({ _id: evId(creatorId, key), campaign_id: null, creator_id: creatorId, key, ...e } as Evidence);

  const followers = (creator.followers as number) ?? 0;
  /**
   * Luôn diễn đạt theo kiểu "cao hơn Y% KOC". Cách nói "top X%" dễ bị hiểu ngược khi chỉ số thấp
   * (percentile 0,19 → "top 81%" nghe như rất tốt, thực ra là thấp hơn 81% số KOC còn lại).
   */
  const betterThan = (p: number) => `cao hơn ${Math.round(p * 100)}% trong ${pool.length} KOC đã thu thập — ${tier(p)}`;

  if (list) {
    const rev = (list.revenue as number) ?? 0;
    add("revenue", {
      type: "metric",
      claim: `Doanh thu mỹ phẩm 30 ngày ${vnd(rev)} (${betterThan(pRev(rev))})`,
      value: rev,
      source: { collection: C.creatorMetrics, ref: String(list._id) },
      strength: pRev(rev) >= 0.7 ? "strong" : "medium",
    });
    const views = (list.views as number) ?? 0;
    add("views", {
      type: "metric",
      claim: `Lượt xem 30 ngày ${compact(views)} (${betterThan(pViews(views))})`,
      value: views,
      source: { collection: C.creatorMetrics, ref: String(list._id) },
      strength: "medium",
    });
    const eng = (list.video_engagement_rate as number) ?? 0;
    add("engagement", {
      type: "metric",
      claim: `Tỷ lệ tương tác video ${pct(eng)} (${betterThan(pEng(eng))})`,
      value: eng,
      source: { collection: C.creatorMetrics, ref: String(list._id) },
      strength: pEng(eng) >= 0.7 ? "strong" : pEng(eng) >= 0.4 ? "medium" : "weak",
    });
  }

  add("followers", {
    type: "metric",
    claim: `${compact(followers)} follower${creator.mcn ? `, thuộc MCN ${String(creator.mcn)}` : ", không thuộc MCN"}`,
    value: followers,
    source: { collection: C.creators, ref: creatorId },
    strength: "strong",
  });

  // Kênh liên hệ công khai — không có claim này thì AI trả lời "không có dữ liệu liên hệ" dù hồ sơ có
  const contacts = contactItems(creator.contact as Record<string, unknown> | null | undefined);
  add("contact", {
    type: "metric",
    claim: contacts.length
      ? `Liên hệ công khai: ${contacts.map((c) => `${c.label} ${c.value}`).join("; ")}; TikTok ${String(creator.handle ?? "")}`
      : `Chưa có liên hệ công khai trong hồ sơ; chỉ có kênh TikTok ${String(creator.handle ?? "")}${creator.mcn ? ` và MCN ${String(creator.mcn)}` : ""}`,
    value: contacts.length,
    source: { collection: C.creators, ref: creatorId },
    strength: contacts.length ? "strong" : "medium",
  });

  const audience = creator.audience as { gender_majority?: string; age_majority?: string } | undefined;
  if (audience?.gender_majority || audience?.age_majority) {
    add("audience", {
      type: "audience",
      claim: `Khán giả đa số ${audience.gender_majority === "female" ? "nữ" : audience.gender_majority === "male" ? "nam" : "không rõ giới tính"}${audience.age_majority ? `, nhóm tuổi ${audience.age_majority}` : ""} (ước tính từ Kalodata)`,
      value: audience.age_majority ?? null,
      source: { collection: C.creators, ref: creatorId },
      strength: "medium",
    });
  }

  const totalsRef = totals?.refs[0] ?? creatorId;
  const daily = totals?.daily ?? [];
  if (daily.length) {
    const days = daily.filter((d) => d.revenue > 0).length;
    const sum = daily.reduce((a, d) => a + d.revenue, 0);
    const peak = Math.max(...daily.map((d) => d.revenue));
    add("consistency", {
      type: "metric",
      claim: `Có doanh thu ${days}/${daily.length} ngày; ngày cao nhất chiếm ${sum ? Math.round((peak / sum) * 100) : 0}% tổng`,
      value: days,
      source: { collection: C.creatorMetrics, ref: totalsRef },
      strength: "medium",
    });
  }

  // Tổng kênh — mẫu số của mọi tỉ trọng bên dưới, nêu thẳng để AI không lấy nhầm số scope mỹ phẩm
  if (totals?.revenue)
    add("channel_total", {
      type: "metric",
      claim: `Tổng doanh thu cả kênh 30 ngày (${totals.date_range}) ${vnd(totals.revenue)}, ${compact(totals.orders)} đơn, đơn giá bình quân ${vnd(totals.aov)}${
        totals.product_number ? `; bán ${totals.product_number} sản phẩm khác nhau` : ""
      }`,
      value: totals.revenue,
      source: { collection: C.creatorMetrics, ref: totalsRef },
      strength: "strong",
    });

  if (products.length) {
    const { revenue: denom, coverage } = denominator(totals, products);
    const base = coverage === null ? "doanh thu các sản phẩm đã thu thập" : "doanh thu kênh";
    const share = (v: number) => (denom ? `${Math.round((v / denom) * 100)}%` : "0%");

    // "Chủ yếu bán danh mục nào" — gộp doanh thu theo danh mục cấp 1, 2, 3; tỉ trọng trên doanh thu kênh
    for (const [key, level, label] of [
      ["category_l1_mix", 1, "Ngành hàng (cấp 1)"],
      ["category_mix", 2, "Danh mục (cấp 2)"],
      ["subcategory_mix", 3, "Nhóm sản phẩm (cấp 3)"],
    ] as const) {
      const top = categoryBreakdown(products, level, denom).slice(0, level === 3 ? 5 : 3);
      if (top.length)
        add(key, {
          type: "product",
          claim: `${label} bán nhiều nhất: ${top.map((c) => `${c.name} ${vnd(c.revenue)} (${share(c.revenue)} ${base}, ${c.products} sản phẩm)`).join("; ")}`,
          value: top[0].name,
          source: { collection: C.creatorProducts, ref: creatorId },
          strength: "strong",
        });
    }

    // Độ phủ: N sản phẩm đã crawl chiếm bao nhiêu doanh thu kênh — để AI không nói quá về phần còn lại
    if (coverage !== null)
      add("product_coverage", {
        type: "product",
        claim: `${products.length} sản phẩm đã thu thập chiếm ${share(products.reduce((a, p) => a + p.revenue, 0))} doanh thu kênh; top 10 sản phẩm chiếm ${share(
          products.slice(0, 10).reduce((a, p) => a + p.revenue, 0),
        )}`,
        value: coverage,
        source: { collection: C.creatorProducts, ref: creatorId },
        strength: "strong",
      });

    // Mức độ phụ thuộc thương hiệu — suy từ tên sản phẩm, là câu hỏi người bán hay quan tâm
    const brand = topBrand(products);
    if (brand)
      add("brand_focus", {
        type: "product",
        claim: `Thương hiệu xuất hiện nhiều nhất trong danh mục đã bán: ${brand.name} — ${brand.count}/${products.length} sản phẩm, chiếm ${share(brand.revenue)} ${base}`,
        value: brand.name,
        source: { collection: C.creatorProducts, ref: creatorId },
        strength: "medium",
      });

    // Vài sản phẩm cụ thể dẫn đầu, để AI trả lời "bán sản phẩm nào" bằng tên thật.
    // Kèm **danh mục và số đơn** của từng sản phẩm: hỏi "bán sản phẩm nào" mà chỉ có tên + doanh thu
    // thì không nói được sản phẩm đó thuộc nhóm nào — Kalopilot nêu cả hai.
    add("products", {
      type: "product",
      // Top 10 (trước đây chỉ 3, tên cắt 55 ký tự — không dựng nổi bảng như Kalopilot). Tên dùng nháy
      // đơn vì chuỗi này đi thẳng vào prompt yêu cầu JSON.
      claim: `Top sản phẩm theo doanh thu: ${products
        .slice(0, 10)
        .map(
          (p, i) =>
            `#${i + 1} '${p.name.slice(0, 90)}' ${vnd(p.revenue)} (${share(p.revenue)}${p.cat3 || p.cat2 ? `, thuộc ${p.cat3 || p.cat2}` : ""}${
              p.sales_volume ? `, ${compact(p.sales_volume)} đơn` : ""
            }${p.unit_price ? `, giá ${vnd(p.unit_price)}` : ""})`,
        )
        .join("; ")}`,
      value: products.length,
      source: { collection: C.creatorProducts, ref: creatorId },
      strength: "strong",
    });

    /**
     * Khoảng giá sản phẩm — người bán cần biết KOC này bán hàng giá nào trước khi chào hợp tác.
     * Dùng trung vị + dải min–max thay vì giá bình quân: KOC bán combo hay có một hai món lẻ giá
     * thấp kéo bình quân xuống, trung vị mô tả đúng "tầm giá chủ đạo" hơn.
     */
    const prices = products.map((p) => p.unit_price ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
    if (prices.length >= 5)
      add("price_range", {
        type: "product",
        claim: `Tầm giá sản phẩm đã bán: trung vị ${vnd(prices[Math.floor(prices.length / 2)])}/sản phẩm, dải ${vnd(prices[0])}–${vnd(
          prices[prices.length - 1],
        )}`,
        value: prices[Math.floor(prices.length / 2)],
        source: { collection: C.creatorProducts, ref: creatorId },
        strength: "strong",
      });

    /**
     * Số đơn — quy mô bán thật, khác với doanh thu (KOC bán combo giá cao ít đơn vẫn doanh thu lớn).
     * Có tổng kênh thì dùng số kênh; cộng từ sản phẩm đã crawl (19,9k) lệch với số kênh (23k) và đã
     * từng làm câu trả lời nêu hai số đơn khác nhau.
     */
    const orders = totals?.orders || products.reduce((a, p) => a + p.sales_volume, 0);
    const orderRevenue = totals?.revenue || products.reduce((a, p) => a + p.revenue, 0);
    if (orders > 0)
      add("orders", {
        type: "product",
        claim: `Tổng ${compact(orders)} đơn trong 30 ngày${totals?.orders ? " (cả kênh)" : ` từ ${products.length} sản phẩm đã thu thập`}; giá trị đơn bình quân ${vnd(
          Math.round(orderRevenue / orders),
        )}`,
        value: orders,
        source: { collection: C.creatorProducts, ref: creatorId },
        strength: "strong",
      });
  }

  if (videos.length) {
    const best = videos[0];
    const vViews = videos.reduce((a, v) => a + ((v.views as number) ?? 0), 0);
    const vLikes = videos.reduce((a, v) => a + ((v.likes as number) ?? 0), 0);
    const ads = videos.filter((v) => v.is_ad).length;
    add("videos", {
      type: "video",
      claim: `${videos.length} video 30 ngày, tổng ${compact(vViews)} lượt xem và ${compact(vLikes)} lượt thích (trung bình ${compact(
        Math.round(vViews / videos.length),
      )} view/video)${ads ? `; ${ads} video có chạy quảng cáo` : ""}`,
      value: videos.length,
      source: { collection: C.videos, ref: String(best._id) },
      strength: "strong",
    });

    // Tên + số đo của vài video dẫn đầu, để AI trả lời "video nào nổi bật" bằng tiêu đề thật
    add("top_videos", {
      type: "video",
      claim: `Video nhiều lượt xem nhất: ${videos
        .slice(0, 3)
        .map(
          (v) =>
            `'${String(v.title ?? "không rõ tiêu đề").slice(0, 50)}' ${compact((v.views as number) ?? 0)} view, ${compact(
              (v.likes as number) ?? 0,
            )} like${(v.revenue as number) > 0 ? `, mang về ${vnd((v.revenue as number) ?? 0)}` : ", chưa ghi nhận doanh thu"}`,
        )
        .join("; ")}`,
      value: (best.views as number) ?? 0,
      source: { collection: C.videos, ref: String(best._id) },
      strength: "strong",
    });
  }

  // ── Nhóm cùng tầm: KOC mỹ phẩm có quy mô follower tương đương (0,5×–2× số follower) ──
  // Người bán hỏi "so với creator cùng tầm thế nào" nên so với toàn pool là không trả lời đúng câu:
  // KOC 600k follower phải được đặt cạnh KOC 300k–1,2tr, không phải cạnh KOC 10k.
  /**
   * Nhóm đối chuẩn. Lọc theo follower **không đủ**: dải 0,5×–2× của một KOC lớn vét về hàng trăm
   * tài khoản gần như không bán được gì, trung vị tụt xuống vài trăm triệu và kết luận thành
   * "gấp 242 lần trung vị" — đúng số nhưng vô dụng với người bán.
   *
   * Nên siết ba lớp: (1) cùng **danh mục chính** (nhóm sản phẩm cấp 3 trùng nhau), (2) **có bán
   * thật** (doanh thu ≥ 10% của KOC đang xem, để loại nhóm ngủ đông), (3) chỉ lấy **10 người gần
   * nhất về quy mô follower** — giống cách một người phân tích chọn đối thủ để so.
   */
  // Kênh bán, số đơn, đơn giá, tỷ lệ chốt. Lấy TRƯỚC khối đối chuẩn vì `live_gpm` của chính KOC
  // cần có để so với trung vị nhóm ngay bên dưới.
  const d = {
    live_gpm: totals?.live_gpm ?? undefined,
    live_number: totals?.live_number ?? undefined,
    live_revenue: totals?.live_revenue,
    video_revenue: totals?.video_revenue,
    sales_volume: totals?.orders,
    unit_price: totals?.aov,
    live_views: totals?.live_views,
  };

  let peerStats: PeerStats | null = null;
  if (followers > 0) {
    const band = { lo: Math.round(followers / 2), hi: Math.round(followers * 2) };
    const myTer = new Set((creator.top_ter_categories as string[]) ?? []);
    const inBand = await db
      .collection(C.creators)
      .find({ followers: { $gte: band.lo, $lte: band.hi } }, { projection: { handle: 1, nickname: 1, followers: 1, top_ter_categories: 1 } })
      .toArray();
    const meta = new Map(
      inBand.map((c) => [
        String(c._id),
        {
          name: String(c.nickname || c.handle || c._id),
          followers: (c.followers as number) ?? 0,
          sameCategory: myTer.size === 0 || ((c.top_ter_categories as string[]) ?? []).some((t) => myTer.has(t)),
        },
      ]),
    );
    const myRev = (list?.revenue as number) ?? 0;
    const myEng = (list?.video_engagement_rate as number) ?? 0;
    const minRev = myRev * 0.1; // loại tài khoản gần như không bán được gì

    const candidates = pool.filter((r) => {
      const m = meta.get(String(r.creator_id));
      return m && String(r.creator_id) !== creatorId && m.sameCategory && ((r.revenue as number) ?? 0) >= minRev;
    });
    // 10 người gần nhất về quy mô follower
    const peers = candidates
      .sort((a, b) => Math.abs((meta.get(String(a.creator_id))!.followers ?? 0) - followers) - Math.abs((meta.get(String(b.creator_id))!.followers ?? 0) - followers))
      .slice(0, 10);

    if (peers.length >= 3) {
      const median = (xs: number[]) => {
        const v = [...xs].sort((a, b) => a - b);
        return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
      };
      const mRev = median(peers.map((r) => (r.revenue as number) ?? 0));
      const mEng = median(peers.map((r) => (r.video_engagement_rate as number) ?? 0));
      const rank = 1 + peers.filter((r) => ((r.revenue as number) ?? 0) > myRev).length;
      const top: PeerRef[] = [...peers]
        .sort((a, b) => ((b.revenue as number) ?? 0) - ((a.revenue as number) ?? 0))
        .slice(0, 4)
        .map((r) => ({
          creator_id: String(r.creator_id),
          name: meta.get(String(r.creator_id))!.name,
          followers: meta.get(String(r.creator_id))!.followers,
          revenue: (r.revenue as number) ?? 0,
          engagement: (r.video_engagement_rate as number) ?? 0,
        }));
      peerStats = { count: peers.length, band, median_revenue: mRev, median_engagement: mEng, my_revenue: myRev, my_engagement: myEng, top };

      add("peer_revenue", {
        type: "metric",
        claim: `Đối chuẩn với ${peers.length} KOC cùng nhóm sản phẩm và cùng quy mô (${compact(band.lo)}–${compact(band.hi)} follower, đều có bán hàng thật): doanh thu ${vnd(
          myRev,
        )} vs trung vị nhóm ${vnd(mRev)} — ${ratioText(myRev, mRev)}; xếp hạng ${rank}/${peers.length + 1} trong nhóm`,
        value: myRev,
        source: { collection: C.creatorMetrics, ref: `peers:${peers.length}` },
        strength: "strong",
      });
      add("peer_engagement", {
        type: "metric",
        claim: `Tương tác ${pct(myEng)} vs trung vị nhóm đối chuẩn ${pct(mEng)} — ${ratioText(myEng, mEng)}`,
        value: myEng,
        source: { collection: C.creatorMetrics, ref: `peers:${peers.length}` },
        strength: "medium",
      });
      /**
       * Hiệu quả bán live so với nhóm — chỉ số Kalopilot nêu ("vượt 66% trung bình nhóm").
       * `live_gpm` = doanh thu trên 1.000 lượt xem live, nằm ở bản ghi `creator/detail` của từng
       * KOC. So GPM chứ không so doanh thu live tuyệt đối: doanh thu lớn có thể chỉ vì live nhiều
       * giờ, còn GPM mới nói lên một lượt xem đáng giá bao nhiêu.
       */
      const peerDetails = await db
        .collection(C.creatorMetrics)
        .find(
          { creator_id: { $in: peers.map((p) => String(p.creator_id)) }, source: "creator/detail", category_scope: "all" },
          { projection: { creator_id: 1, live_gpm: 1, updated_at: 1 } },
        )
        .sort({ updated_at: -1 })
        .toArray();
      const gpmByCreator = new Map<string, number>();
      for (const r of peerDetails) if (!gpmByCreator.has(String(r.creator_id))) gpmByCreator.set(String(r.creator_id), (r.live_gpm as number) ?? 0);
      const peerGpms = [...gpmByCreator.values()].filter((g) => g > 0);
      const myGpm = d.live_gpm ?? 0;
      if (myGpm > 0 && peerGpms.length >= 3) {
        const mGpm = median(peerGpms);
        const gpmRank = 1 + peerGpms.filter((g) => g > myGpm).length;
        add("peer_live", {
          type: "metric",
          claim: `Hiệu quả bán livestream: ${vnd(myGpm)} doanh thu trên 1.000 lượt xem live, vs trung vị nhóm đối chuẩn ${vnd(
            mGpm,
          )} — ${ratioText(myGpm, mGpm)}; xếp hạng ${gpmRank}/${peerGpms.length + 1} trong số KOC cùng nhóm có bán live`,
          value: myGpm,
          source: { collection: C.creatorMetrics, ref: `peers:${peerGpms.length}` },
          strength: "strong",
        });
      }

      if (top.length)
        add("peer_top", {
          type: "metric",
          claim: `KOC doanh thu cao nhất trong nhóm đối chuẩn: ${top.map((p) => `${p.name} ${vnd(p.revenue)} (${compact(p.followers)} follower, tương tác ${pct(p.engagement)})`).join("; ")}`,
          value: top[0].name,
          source: { collection: C.creatorMetrics, ref: `peers:${peers.length}` },
          strength: "strong",
        });
    }
  }

  const liveRev = d.live_revenue ?? 0;
  const vidRev = d.video_revenue ?? 0;
  const orders = d.sales_volume ?? 0;
  const aov = d.unit_price ?? 0;
  const liveViews = d.live_views ?? 0;
  const metricRef = totalsRef;

  if (orders || aov)
    add("sales", {
      type: "metric",
      claim: `Bán ${compact(orders)} đơn trong 30 ngày, đơn giá bình quân ${vnd(aov)}`,
      value: orders,
      source: { collection: C.creatorMetrics, ref: metricRef },
      strength: "strong",
    });

  // Tỷ lệ chốt đơn trên lượt xem live — chỉ số Kalopilot nêu, mình có đủ dữ liệu để tính y hệt
  if (orders && liveViews)
    add("live_conversion", {
      type: "metric",
      claim: `Tỷ lệ chốt đơn trên lượt xem livestream ${pct(orders / liveViews)} (${compact(orders)} đơn trên ${compact(liveViews)} lượt xem live)`,
      value: orders / liveViews,
      source: { collection: C.creatorMetrics, ref: metricRef },
      strength: "strong",
    });

  if (liveRev || vidRev) {
    // Chia cho doanh thu kênh (gồm cả bán qua thẻ shop), không phải live + video — bản cũ ra "100%"
    const sum = totals?.revenue || liveRev + vidRev;
    const p1 = (v: number) => (sum ? `${(Math.round((v / sum) * 1000) / 10).toLocaleString("vi-VN")}%` : "0%");
    add("channel_mix", {
      type: "metric",
      claim: `Doanh thu từ livestream ${vnd(liveRev)} (${p1(liveRev)} doanh thu kênh) vs từ video ${vnd(vidRev)} (${p1(vidRev)})${
        d.live_number ? `; ${d.live_number} phiên live trong kỳ` : ""
      }${d.live_gpm ? `; doanh thu trên 1.000 lượt xem live ${vnd(d.live_gpm)}` : ""}`,
      value: liveRev,
      source: { collection: C.creatorMetrics, ref: metricRef },
      strength: "strong",
    });
  }

  add("independence", {
    type: "metric",
    claim: `${creator.status === "INDEPENDENT" ? "Nhà sáng tạo độc lập, không thuộc shop nào" : `Gắn với shop ${String(creator.shop_name ?? "không rõ")}`}${
      creator.product_count ? `; đang bày bán ${creator.product_count} sản phẩm` : ""
    }${creator.debut_date ? `; hoạt động từ ${String(creator.debut_date)}` : ""}`,
    value: String(creator.status ?? ""),
    source: { collection: C.creators, ref: creatorId },
    strength: "medium",
  });

  const cost = estimateCost(followers, Boolean(creator.mcn));
  add("cost", {
    type: "cost",
    claim: `Chi phí ước tính ${vnd(cost.min)}–${vnd(cost.max)}/video, theo ${cost.method} (độ tin cậy ${cost.confidence})`,
    value: cost.mid,
    source: { collection: C.creators, ref: creatorId },
    strength: "weak",
  });

  // Ghi đè bản cũ cùng id: id ổn định nên trích dẫn cũ vẫn đúng, nội dung thì làm mới theo DB
  await Promise.all(
    docs.map((d) =>
      db.collection(C.evidence).replaceOne({ _id: d._id as never }, { ...d, version: CREATOR_EVIDENCE_VERSION, created_at: new Date() }, { upsert: true }),
    ),
  );
  return { claims: new Map(docs.map((d) => [d._id, d.claim])), peers: peerStats };
}
