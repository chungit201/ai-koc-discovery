import "server-only";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";
import type { Evidence } from "../scoring/run";
import { estimateCost, percentileOf } from "../scoring/rules";
import { compact, pct, vnd } from "../format";
import { contactItems } from "../contact";

/**
 * Bằng chứng về một KOC, **không gắn chiến dịch nào** (`campaign_id: null`).
 *
 * Khác với evidence của S2: ở đó percentile tính trong nhóm đủ điều kiện của riêng một chiến dịch
 * ("top 35% nhóm đủ điều kiện") nên không mang sang chỗ khác được. Ở đây percentile tính trên
 * **toàn bộ pool đã crawl**, nên claim có nghĩa ở mọi ngữ cảnh — dùng cho chat ở trang hồ sơ KOC.
 *
 * Mọi con số do code lấy từ DB; AI chỉ được trích `evidence_id` (xem `validateReasons`).
 */
export const CREATOR_EVIDENCE_VERSION = "koc-ev-v1";

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
  share: number; // tỷ trọng trong doanh thu sản phẩm của KOC
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
  top_products: { rank: number; product_id: string; name: string; revenue: number; share: number }[];
}

export async function creatorReport(creatorId: string): Promise<CreatorReport | null> {
  const db = await getDb();
  const creator = await db.collection(C.creators).findOne({ _id: creatorId as never });
  if (!creator) return null;
  const list = await db
    .collection(C.creatorMetrics)
    .findOne({ creator_id: creatorId, source: "web:creator/queryList", category_scope: COSMETICS }, { sort: { updated_at: -1 } });
  const rows = await db
    .collection(C.creatorProducts)
    .aggregate<{ product_id: string; name?: string; revenue?: number; cat2?: string; cat3?: string }>([
      { $match: { creator_id: creatorId } },
      { $group: { _id: "$product_id", revenue: { $max: "$revenue" } } },
      { $sort: { revenue: -1 } },
      { $lookup: { from: C.products, localField: "_id", foreignField: "_id", as: "p" } },
      {
        $project: {
          _id: 0,
          product_id: "$_id",
          revenue: 1,
          name: { $first: "$p.name" },
          cat2: { $first: "$p.category_l2.category_name" },
          cat3: { $first: "$p.category_l3.category_name" },
        },
      },
    ])
    .toArray();

  const total = rows.reduce((a, r) => a + (r.revenue ?? 0), 0);
  const byCat = new Map<string, { revenue: number; sub: Map<string, number> }>();
  for (const r of rows) {
    const c2 = String(r.cat2 ?? "").trim() || "Khác";
    const entry = byCat.get(c2) ?? { revenue: 0, sub: new Map() };
    entry.revenue += r.revenue ?? 0;
    const c3 = String(r.cat3 ?? "").trim();
    if (c3) entry.sub.set(c3, (entry.sub.get(c3) ?? 0) + (r.revenue ?? 0));
    byCat.set(c2, entry);
  }

  return {
    period_days: 30,
    revenue: (list?.revenue as number) ?? 0,
    products_count: rows.length,
    videos_count: await db.collection(C.videos).countDocuments({ creator_id: creatorId }),
    followers: (creator.followers as number) ?? 0,
    categories: [...byCat.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 4)
      .map(([name, v]) => ({
        name,
        revenue: v.revenue,
        share: total ? v.revenue / total : 0,
        sub: [...v.sub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s),
      })),
    top_products: rows.slice(0, 10).map((r, i) => ({
      rank: i + 1,
      product_id: String(r.product_id),
      name: String(r.name ?? "Sản phẩm không rõ tên"),
      revenue: r.revenue ?? 0,
      share: total ? (r.revenue ?? 0) / total : 0,
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

function topBrand(products: { name?: string; revenue?: number }[]): { name: string; count: number; revenue: number } | null {
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
  const db = await getDb();
  const rows = await db
    .collection(C.creatorProducts)
    .aggregate<{ product_id: string; name?: string; revenue?: number }>([
      { $match: { creator_id: creatorId } },
      { $group: { _id: "$product_id", revenue: { $max: "$revenue" } } },
      { $sort: { revenue: -1 } },
      { $lookup: { from: C.products, localField: "_id", foreignField: "_id", as: "p" } },
      { $project: { _id: 0, product_id: "$_id", revenue: 1, name: { $first: "$p.name" } } },
    ])
    .toArray();
  const sum = rows.reduce((a, r) => a + (r.revenue ?? 0), 0);
  return rows.slice(0, limit).map((r) => ({
    product_id: String(r.product_id),
    name: String(r.name ?? "Sản phẩm không rõ tên"),
    revenue: r.revenue ?? 0,
    share: sum ? (r.revenue ?? 0) / sum : 0,
  }));
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
  const total = await db.collection(C.creatorMetrics).findOne({ creator_id: creatorId, source: "web:creator/detail/total", category_scope: "all" }, { sort: { updated_at: -1 } });
  const products = await db
    .collection(C.creatorProducts)
    .aggregate<{ name: string; revenue: number; cat2: string; cat3: string }>([
      { $match: { creator_id: creatorId } },
      { $sort: { revenue: -1 } },
      { $lookup: { from: C.products, localField: "product_id", foreignField: "_id", as: "p" } },
      {
        $project: {
          name: { $first: "$p.name" },
          revenue: 1,
          cat2: { $first: "$p.category_l2.category_name" },
          cat3: { $first: "$p.category_l3.category_name" },
        },
      },
    ])
    .toArray();
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

  const daily: { day: string; revenue: number | null }[] = (total?.daily as never) ?? [];
  if (daily.length) {
    const days = daily.filter((d) => (d.revenue ?? 0) > 0).length;
    const sum = daily.reduce((a, d) => a + (d.revenue ?? 0), 0);
    const peak = Math.max(...daily.map((d) => d.revenue ?? 0));
    add("consistency", {
      type: "metric",
      claim: `Có doanh thu ${days}/${daily.length} ngày; ngày cao nhất chiếm ${sum ? Math.round((peak / sum) * 100) : 0}% tổng`,
      value: days,
      source: { collection: C.creatorMetrics, ref: String(total?._id) },
      strength: "medium",
    });
  }

  if (products.length) {
    const prodRevenue = products.reduce((a, p) => a + (p.revenue ?? 0), 0);
    const share = (v: number) => (prodRevenue ? `${Math.round((v / prodRevenue) * 100)}%` : "0%");

    // "Chủ yếu bán danh mục nào" — gộp doanh thu theo danh mục cấp 2 và cấp 3
    for (const [key, level, label] of [
      ["category_mix", "cat2", "Danh mục"],
      ["subcategory_mix", "cat3", "Nhóm sản phẩm"],
    ] as const) {
      const byCat = new Map<string, number>();
      for (const p of products) {
        const name = String((p as Record<string, unknown>)[level] ?? "").trim();
        if (name) byCat.set(name, (byCat.get(name) ?? 0) + (p.revenue ?? 0));
      }
      const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (top.length)
        add(key, {
          type: "product",
          claim: `${label} bán nhiều nhất: ${top.map(([n, v]) => `${n} ${vnd(v)} (${share(v)} doanh thu sản phẩm)`).join("; ")}`,
          value: top[0][0],
          source: { collection: C.creatorProducts, ref: creatorId },
          strength: "strong",
        });
    }

    // Mức độ phụ thuộc thương hiệu — suy từ tên sản phẩm, là câu hỏi người bán hay quan tâm
    const brand = topBrand(products);
    if (brand)
      add("brand_focus", {
        type: "product",
        claim: `Thương hiệu xuất hiện nhiều nhất trong danh mục đã bán: ${brand.name} — ${brand.count}/${products.length} sản phẩm, chiếm ${share(brand.revenue)} doanh thu sản phẩm`,
        value: brand.name,
        source: { collection: C.creatorProducts, ref: creatorId },
        strength: "medium",
      });

    // Vài sản phẩm cụ thể dẫn đầu, để AI trả lời "bán sản phẩm nào" bằng tên thật
    add("products", {
      type: "product",
      claim: `Đã bán ${products.length} sản phẩm, tổng ${vnd(prodRevenue)}; dẫn đầu: ${products
        .slice(0, 3)
        .map((p) => `"${String(p.name ?? "không rõ tên").slice(0, 55)}" ${vnd(p.revenue ?? 0)} (${share(p.revenue ?? 0)})`)
        .join("; ")}`,
      value: products.length,
      source: { collection: C.creatorProducts, ref: creatorId },
      strength: "strong",
    });
  }

  if (videos.length) {
    const best = videos[0];
    add("videos", {
      type: "video",
      claim: `${videos.length} video 30 ngày; video nhiều view nhất ${compact((best.views as number) ?? 0)} lượt`,
      value: videos.length,
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

  // ── Kênh bán, số đơn, đơn giá, tỷ lệ chốt: dữ liệu đã crawl nhưng từng bị bỏ phí ──
  const detail = await db.collection(C.creatorMetrics).findOne({ creator_id: creatorId, source: "creator/detail", category_scope: "all" }, { sort: { updated_at: -1 } });
  const d = (detail ?? total ?? {}) as Record<string, number | undefined>;
  const liveRev = d.live_revenue ?? 0;
  const vidRev = d.video_revenue ?? 0;
  const orders = d.sales_volume ?? 0;
  const aov = d.unit_price ?? 0;
  const liveViews = d.live_views ?? 0;
  const metricRef = String((detail ?? total)?._id ?? creatorId);

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
    const sum = liveRev + vidRev;
    add("channel_mix", {
      type: "metric",
      claim: `Doanh thu từ livestream ${vnd(liveRev)} (${sum ? Math.round((liveRev / sum) * 100) : 0}% tổng) vs từ video ${vnd(vidRev)}${
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
