import type { Db } from "mongodb";
import { C } from "./db/collections";

/**
 * CÂY DANH MỤC (đa ngành) + PHÂN LOẠI SẢN PHẨM — để Tola query theo ngành nhanh và đúng.
 *
 *   categories:  _id = category id Kalodata · level 1 (ngành) / 2 (nhóm) / 3 (loại) · parent_id · path
 *                + stats {products, kocs, revenue, orders} cộng dồn từ creator_products (kỳ mới nhất mỗi KOC)
 *   products.category: { l1, l2, l3: {id, name}, source: "kalodata" | "inferred", confidence }
 *   creator_products.cat: { l1, l2, l3 } (mã) — doanh thu theo ngành KHÔNG cần nối bảng
 *   creators.industry: { l1, l2, l3: {id, name, share} } — ngành/nhóm/loại chính của KOC theo doanh thu
 *   creators.category_mix: [{id, name, level, share}] — top nhóm (cấp 2) + loại (cấp 3) KOC bán
 *
 * Nguồn cây: sản phẩm đã có danh mục từ Kalodata (Open API trả category_l1/2/3). Sản phẩm chưa có
 * (crawl web không trả danh mục) được SUY RA TỪ TÊN: so với sản phẩm đã gắn nhãn giống nhất (k láng
 * giềng, trọng số idf), các láng giềng bỏ phiếu cấp 3. Không gắn cứng ngành nào → crawl ngành mới về là
 * tự có nhãn của ngành đó. Chạy lại bằng `npm run build:categories` sau mỗi đợt crawl.
 */

export interface CatRef {
  id: string;
  name: string;
}
export interface ProductCategory {
  l1: CatRef;
  l2: CatRef;
  /** null khi chỉ chắc tới cấp 2 (láng giềng đồng thuận nhóm nhưng chia rẽ loại) */
  l3: CatRef | null;
  source: "kalodata" | "inferred";
  /** 1 = nhãn gốc Kalodata; < 1 = tỉ lệ phiếu của láng giềng cho nhãn thắng */
  confidence: number;
}

/** Từ vô nghĩa cho việc phân loại (khuyến mãi, đơn vị, quà tặng) — sau khi đã bỏ dấu. */
const STOP = new Set(
  "combo set bo hop tang qua mua giam gia sale chinh hang hang moi new freeship ship live deal tong mon chiec cai goi tui chai tuyp lo ml g kg gr x va cho voi cua la mot hai ba the nhe hot best ban chay chinh official mall store shop vn viet nam".split(" "),
);

function tokens(name: string): string[] {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 2 && !/^\d+[a-z]*$/.test(w) && !STOP.has(w));
  // Cặp từ liền nhau giữ nghĩa ("chong nang", "duong am") — chính xác hơn từ đơn
  const bigrams = words.slice(1).map((w, i) => `${words[i]}_${w}`);
  return [...new Set([...words, ...bigrams])];
}

type Labeled = { id: string; cat: { l1: CatRef; l2: CatRef; l3: CatRef } };

/** Dựng `categories` + gắn `products.category`. Trả về thống kê để in log. */
export async function buildCategories(db: Db): Promise<{ nodes: number; labeled: number; inferred: number; unknown: number; kocs: number }> {
  // ── 1. Nhãn gốc từ Kalodata ──
  const raw = await db
    .collection(C.products)
    .find({ "category_l3.category_id": { $exists: true } }, { projection: { name: 1, category_l1: 1, category_l2: 1, category_l3: 1 } })
    .toArray();
  const ref = (o: unknown): CatRef | null => {
    const x = o as { category_id?: unknown; category_name?: unknown } | undefined;
    return x?.category_id ? { id: String(x.category_id), name: String(x.category_name ?? "") } : null;
  };
  const labeled: Labeled[] = [];
  const nodes = new Map<string, { _id: string; name: string; level: number; parent_id: string | null }>();
  for (const p of raw) {
    const l1 = ref(p.category_l1);
    const l2 = ref(p.category_l2);
    const l3 = ref(p.category_l3);
    if (!l1 || !l2 || !l3) continue;
    labeled.push({ id: String(p._id), cat: { l1, l2, l3 } });
    nodes.set(l1.id, { _id: l1.id, name: l1.name, level: 1, parent_id: null });
    nodes.set(l2.id, { _id: l2.id, name: l2.name, level: 2, parent_id: l1.id });
    nodes.set(l3.id, { _id: l3.id, name: l3.name, level: 3, parent_id: l2.id });
  }
  const byL3 = new Map(labeled.map((l) => [l.cat.l3.id, l.cat]));

  // ── 2. Chỉ mục token → sản phẩm đã gắn nhãn (idf) ──
  const index = new Map<string, number[]>();
  labeled.forEach((l, i) => {
    const name = raw.find((r) => String(r._id) === l.id)?.name;
    for (const t of tokens(String(name ?? ""))) (index.get(t) ?? index.set(t, []).get(t)!).push(i);
  });
  const N = labeled.length || 1;
  const idf = (t: string) => Math.log(N / (index.get(t)?.length ?? N));

  // ── 3. Suy ra danh mục cho sản phẩm chưa có nhãn ──
  const all = await db.collection(C.products).find({}, { projection: { name: 1, category_l3: 1 } }).toArray();
  const labeledIds = new Set(labeled.map((l) => l.id));
  const writes: { updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }[] = [];
  let inferred = 0;
  let unknown = 0;
  for (const p of all) {
    const id = String(p._id);
    if (labeledIds.has(id)) {
      const cat = labeled.find((l) => l.id === id)!.cat;
      writes.push({ updateOne: { filter: { _id: id }, update: { $set: { category: { ...cat, source: "kalodata", confidence: 1 } } } } });
      continue;
    }
    const score = new Map<number, number>();
    for (const t of tokens(String(p.name ?? ""))) {
      const hits = index.get(t);
      if (!hits || hits.length > N * 0.2) continue; // token quá phổ biến không phân biệt được
      const w = idf(t) * (t.includes("_") ? 1.5 : 1);
      for (const h of hits) score.set(h, (score.get(h) ?? 0) + w);
    }
    const top = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const votes = new Map<string, number>();
    for (const [h, s] of top) votes.set(labeled[h].cat.l3.id, (votes.get(labeled[h].cat.l3.id) ?? 0) + s);
    const total = [...votes.values()].reduce((a, b) => a + b, 0);
    const [win, ws] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    /**
     * Ngưỡng chọn bằng kiểm chứng chéo trên chính sản phẩm đã có nhãn (bỏ-ra-một):
     * top ≥ 2 & thắng ≥ 35% phiếu → phủ ~79%, đúng cấp 3 ~76%, đúng cấp 2 ~91%.
     * Không đủ chắc ở cấp 3 nhưng láng giềng đồng thuận NHÓM (cấp 2 ≥ 55%) → chỉ gắn tới cấp 2.
     */
    const best = top[0]?.[1] ?? 0;
    if (!win || best < 2 || ws / total < 0.35) {
      const v2 = new Map<string, number>();
      for (const [h, s] of top) v2.set(labeled[h].cat.l2.id, (v2.get(labeled[h].cat.l2.id) ?? 0) + s);
      const [w2, s2] = [...v2.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      const c2 = w2 ? labeled.find((l) => l.cat.l2.id === w2)!.cat : null;
      if (c2 && best >= 2 && s2 / total >= 0.55) {
        inferred++;
        writes.push({ updateOne: { filter: { _id: id }, update: { $set: { category: { l1: c2.l1, l2: c2.l2, l3: null, source: "inferred", confidence: Math.round((s2 / total) * 100) / 100 } } } } });
      } else {
        unknown++;
        writes.push({ updateOne: { filter: { _id: id }, update: { $unset: { category: "" } } } });
      }
      continue;
    }
    inferred++;
    writes.push({ updateOne: { filter: { _id: id }, update: { $set: { category: { ...byL3.get(win)!, source: "inferred", confidence: Math.round((ws / total) * 100) / 100 } } } } });
  }
  for (let i = 0; i < writes.length; i += 1000) await db.collection(C.products).bulkWrite(writes.slice(i, i + 1000) as never);

  // ── 4. Số liệu mỗi nút: sản phẩm, KOC, doanh thu, đơn (kỳ mới nhất mỗi cặp KOC × sản phẩm) ──
  const cats = new Map((await db.collection(C.products).find({ category: { $exists: true } }, { projection: { category: 1 } }).toArray()).map((p) => [String(p._id), p.category as ProductCategory]));
  const sales = await db
    .collection(C.creatorProducts)
    .aggregate<{ _id: { p: string; c: string }; revenue: number; orders: number }>([
      { $sort: { updated_at: -1 } },
      { $group: { _id: { p: "$product_id", c: "$creator_id" }, revenue: { $first: "$revenue" }, orders: { $first: "$sales_volume" } } },
    ])
    .toArray();
  const stats = new Map<string, { products: Set<string>; kocs: Set<string>; revenue: number; orders: number }>();
  const bump = (cid: string, pid: string, kid: string | null, rev: number, ord: number) => {
    const s = stats.get(cid) ?? stats.set(cid, { products: new Set(), kocs: new Set(), revenue: 0, orders: 0 }).get(cid)!;
    s.products.add(pid);
    if (kid) s.kocs.add(kid);
    s.revenue += rev;
    s.orders += ord;
  };
  for (const [pid, c] of cats) for (const lv of [c.l1, c.l2, c.l3]) if (lv) bump(lv.id, pid, null, 0, 0);
  for (const r of sales) {
    const c = cats.get(String(r._id.p));
    if (!c) continue;
    for (const lv of [c.l1, c.l2, c.l3]) if (lv) bump(lv.id, String(r._id.p), String(r._id.c), Number(r.revenue) || 0, Number(r.orders) || 0);
  }

  // ── 5. Ghi cây ──
  const now = new Date();
  const pathOf = (id: string): string[] => {
    const n = nodes.get(id);
    return n ? [...(n.parent_id ? pathOf(n.parent_id) : []), n.name] : [];
  };
  await db.collection(C.categories).bulkWrite(
    [...nodes.values()].map((n) => {
      const s = stats.get(n._id);
      return {
        replaceOne: {
          filter: { _id: n._id as never },
          replacement: { ...n, path: pathOf(n._id), stats: { products: s?.products.size ?? 0, kocs: s?.kocs.size ?? 0, revenue: s?.revenue ?? 0, orders: s?.orders ?? 0 }, updated_at: now },
          upsert: true,
        },
      };
    }),
  );
  // ── 6. Gắn mã danh mục xuống creator_products (`cat`) — tính doanh thu theo ngành không cần nối bảng ──
  const groups = new Map<string, { cat: { l1: string; l2: string; l3: string | null }; ids: string[] }>();
  for (const [pid, c] of cats) {
    const key = `${c.l1.id}|${c.l2.id}|${c.l3?.id ?? ""}`;
    (groups.get(key) ?? groups.set(key, { cat: { l1: c.l1.id, l2: c.l2.id, l3: c.l3?.id ?? null }, ids: [] }).get(key)!).ids.push(pid);
  }
  const cpWrites: { updateMany: { filter: Record<string, unknown>; update: Record<string, unknown> } }[] = [...groups.values()].map((g) => ({ updateMany: { filter: { product_id: { $in: g.ids } }, update: { $set: { cat: g.cat } } } }));
  cpWrites.push({ updateMany: { filter: { product_id: { $nin: [...cats.keys()] } }, update: { $unset: { cat: "" } } } });
  for (let i = 0; i < cpWrites.length; i += 200) await db.collection(C.creatorProducts).bulkWrite(cpWrites.slice(i, i + 200) as never);

  // ── 7. Ngành của từng KOC (`creators.industry` + `creators.category_mix`) từ doanh thu theo danh mục ──
  const name = (id: string) => nodes.get(id)?.name ?? id;
  const perKoc = new Map<string, { total: number; l1: Map<string, number>; l2: Map<string, number>; l3: Map<string, number> }>();
  for (const r of sales) {
    const c = cats.get(String(r._id.p));
    const rev = Number(r.revenue) || 0;
    if (!c || rev <= 0) continue;
    const k = perKoc.get(String(r._id.c)) ?? perKoc.set(String(r._id.c), { total: 0, l1: new Map(), l2: new Map(), l3: new Map() }).get(String(r._id.c))!;
    k.total += rev;
    k.l1.set(c.l1.id, (k.l1.get(c.l1.id) ?? 0) + rev);
    k.l2.set(c.l2.id, (k.l2.get(c.l2.id) ?? 0) + rev);
    if (c.l3) k.l3.set(c.l3.id, (k.l3.get(c.l3.id) ?? 0) + rev);
  }
  const topOf = (m: Map<string, number>, total: number) => {
    const [id, rev] = [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return id ? { id, name: name(id), share: Math.round((rev / total) * 1000) / 1000 } : null;
  };
  const kWrites = [...perKoc.entries()].map(([cid, k]) => ({
    updateOne: {
      filter: { _id: cid },
      update: {
        $set: {
          industry: { l1: topOf(k.l1, k.total), l2: topOf(k.l2, k.total), l3: topOf(k.l3, k.total), classified_revenue: k.total, updated_at: now },
          // Top nhóm (cấp 2) và loại (cấp 3) KOC bán — lọc "KOC bán serum" bằng index thay vì quét sản phẩm
          category_mix: [
            ...[...k.l2.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, rev]) => ({ id, name: name(id), level: 2, share: Math.round((rev / k.total) * 1000) / 1000 })),
            ...[...k.l3.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, rev]) => ({ id, name: name(id), level: 3, share: Math.round((rev / k.total) * 1000) / 1000 })),
          ],
        },
      },
    },
  }));
  for (let i = 0; i < kWrites.length; i += 500) await db.collection(C.creators).bulkWrite(kWrites.slice(i, i + 500) as never);

  // ── 8. Danh mục Kalodata gắn trên hồ sơ KOC (/creator/detail: pri/sec/ter_cate_ids, main_category) ──
  // Lấy lại từ raw_responses cho KOC crawl trước khi crawler lưu trường này — không gọi Kalodata
  const missing = await db.collection(C.creators).find({ detail_updated_at: { $exists: true }, kalodata_categories: { $exists: false } }, { projection: { _id: 1 } }).toArray();
  if (missing.length) {
    const ids = missing.map((m) => String(m._id));
    const raws = await db.collection(C.rawResponses).find({ endpoint: "web:/creator/detail", "request.id": { $in: ids } }, { projection: { request: 1, response: 1 } }).toArray();
    const back = raws
      .map((r) => {
        const d = (r.response as { data?: Record<string, unknown> })?.data;
        const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
        return d ? { updateOne: { filter: { _id: String((r.request as { id: string }).id) }, update: { $set: { kalodata_categories: { l1: arr(d.pri_cate_ids), l2: arr(d.sec_cate_ids), l3: arr(d.ter_cate_ids) } } } } } : null;
      })
      .filter(Boolean);
    if (back.length) await db.collection(C.creators).bulkWrite(back as never);
  }
  // main_category ở trang DANH SÁCH (/creator/queryList) — có cho mọi KOC, kể cả chưa crawl chi tiết
  const noList = new Set((await db.collection(C.creators).find({ list_main_category: { $exists: false } }, { projection: { _id: 1 } }).toArray()).map((c) => String(c._id)));
  if (noList.size) {
    const listMain = new Map<string, { l1: string[]; l2: string[] }>();
    for await (const r of db.collection(C.rawResponses).find({ endpoint: "web:/creator/queryList" }, { projection: { response: 1 } })) {
      for (const row of ((r.response as { data?: Record<string, unknown>[] })?.data ?? []) as Record<string, unknown>[]) {
        const id = String(row.id ?? "");
        if (!noList.has(id) || listMain.has(id)) continue;
        try {
          const o = (typeof row.main_category === "string" ? JSON.parse(row.main_category) : row.main_category) as { pri_main_category?: unknown[]; sec_main_category?: unknown[] } | null;
          if (o) listMain.set(id, { l1: (o.pri_main_category ?? []).map(String), l2: (o.sec_main_category ?? []).map((x) => String(x).split("-").pop() ?? "").filter(Boolean) });
        } catch {
          /* chuỗi hỏng → bỏ qua */
        }
      }
    }
    if (listMain.size) await db.collection(C.creators).bulkWrite([...listMain.entries()].map(([id, v]) => ({ updateOne: { filter: { _id: id as never }, update: { $set: { list_main_category: v } } } })));
  }

  // KOC chưa phân loại được sản phẩm nào → ngành chính theo Kalodata: hồ sơ ("cấp1-cấp2"), không có thì trang danh sách
  const noInd = await db
    .collection(C.creators)
    .find({ _id: { $nin: [...perKoc.keys()] as never[] }, $or: [{ "main_categories.0": { $exists: true } }, { "list_main_category.l1.0": { $exists: true } }] }, { projection: { main_categories: 1, list_main_category: 1 } })
    .toArray();
  const fallback = noInd
    .map((c) => {
      const lm = c.list_main_category as { l1: string[]; l2: string[] } | undefined;
      const [l1, l2] = ((c.main_categories as string[] | undefined)?.[0] ?? (lm?.l1[0] ? `${lm.l1[0]}-${lm.l2[0] ?? ""}` : "")).split("-");
      return l1 ? { updateOne: { filter: { _id: c._id }, update: { $set: { industry: { l1: { id: l1, name: name(l1), share: null }, l2: l2 ? { id: l2, name: name(l2), share: null } : null, l3: null, source: "kalodata_profile", updated_at: now } } } } } : null;
    })
    .filter(Boolean);
  if (fallback.length) await db.collection(C.creators).bulkWrite(fallback as never);

  return { nodes: nodes.size, labeled: labeled.length, inferred, unknown, kocs: perKoc.size };
}
