// Is the crawled data enough to pick 5 cosmetics KOCs with evidence? Reads MongoDB only.
//   npm run db:audit
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";

const SUNSCREEN = /chống nắng|kcn|sunscreen|spf|sun ?cream|sun ?stick/i;
const db = await getDb();

// ── Tier 1: cosmetics list coverage ──────────────────────────────────────────
const cosmeticsRows = await db
  .collection(C.creatorMetrics)
  .find({ category_scope: "848776,848648", source: "web:creator/queryList" })
  .project<{ creator_id: string }>({ creator_id: 1 })
  .toArray();
const cosmeticsIds = new Set(cosmeticsRows.map((r) => r.creator_id));
const byAge = await db
  .collection(C.creators)
  .aggregate<{ _id: string; n: number }>([
    { $match: { _id: { $in: [...cosmeticsIds] as never[] } } },
    { $unwind: "$audience.age_buckets_matched" },
    { $group: { _id: "$audience.age_buckets_matched", n: { $sum: 1 } } },
  ])
  .toArray();
const runDoc = await db.collection(C.crawlRuns).findOne({ _id: "96985620-997a-40f5-a1cd-cbf02f4eedeb" as never });
const pagesByAge = (runDoc?.config as { pages_by_age?: Record<string, number> })?.pages_by_age ?? {};
const listDone = await db
  .collection(C.stageItems)
  .aggregate<{ _id: string; n: number }>([
    { $match: { run_id: "96985620-997a-40f5-a1cd-cbf02f4eedeb", stage: "web:list", status: "done" } },
    { $group: { _id: { $arrayElemAt: [{ $split: ["$item_id", "|"] }, 0] }, n: { $sum: 1 } } },
  ])
  .toArray();

console.log("══ TẦNG 1 — danh sách KOC mỹ phẩm (Chăm sóc da + Trang điểm) ══");
console.log(`KOC đã có: ${cosmeticsIds.size}`);
for (const a of byAge) {
  const done = listDone.find((x) => x._id === a._id)?.n ?? 0;
  console.log(`  tuổi ${a._id}: ${a.n} KOC · ${done}/${pagesByAge[a._id] ?? "?"} trang`);
}

// ── Tier 2: creators with full detail (audience + totals + products + videos) ─
const detailed = await db
  .collection(C.creators)
  .find({ "audience.age_majority": { $exists: true }, detail_updated_at: { $exists: true } })
  .toArray();
interface Row {
  handle: string;
  followers: number;
  age: string;
  mcn: string | null;
  cosmetics: boolean;
  videos: number;
  sunscreenVideos: number;
  products: number;
  sunscreenProducts: number;
  hasDaily: boolean;
}
const rows: Row[] = [];
for (const c of detailed) {
  const id = String(c._id);
  const videos = await db.collection(C.videos).find({ creator_id: id }).project<{ title?: string }>({ title: 1 }).toArray();
  const prods = await db
    .collection(C.creatorProducts)
    .aggregate<{ name?: string }>([
      { $match: { creator_id: id } },
      { $group: { _id: "$product_id" } },
      { $lookup: { from: C.products, localField: "_id", foreignField: "_id", as: "p" } },
      { $project: { name: { $first: "$p.name" } } },
    ])
    .toArray();
  const daily = await db.collection(C.creatorMetrics).countDocuments({ creator_id: id, "daily.0": { $exists: true } });
  rows.push({
    handle: c.handle,
    followers: c.followers ?? 0,
    age: c.audience?.age_majority ?? "?",
    mcn: c.mcn || null,
    cosmetics: cosmeticsIds.has(id),
    videos: videos.length,
    sunscreenVideos: videos.filter((v) => SUNSCREEN.test(v.title ?? "")).length,
    products: prods.length,
    sunscreenProducts: prods.filter((p) => SUNSCREEN.test(p.name ?? "")).length,
    hasDaily: daily > 0,
  });
}

const count = (f: (r: Row) => boolean) => rows.filter(f).length;
console.log("\n══ TẦNG 2 — KOC có dữ liệu chi tiết ══");
console.log(`Tổng: ${rows.length}`);
console.log(`  có trong danh sách mỹ phẩm: ${count((r) => r.cosmetics)}`);
console.log(`  có doanh thu theo ngày: ${count((r) => r.hasDaily)}`);
console.log(`  có ≥5 video (đủ để phân tích video AI): ${count((r) => r.videos >= 5)}`);
console.log(`  có video nhắc chống nắng: ${count((r) => r.sunscreenVideos > 0)}`);
console.log(`  đã bán sản phẩm chống nắng: ${count((r) => r.sunscreenProducts > 0)}`);
console.log(`  không thuộc MCN: ${count((r) => !r.mcn)}`);
const tiers: [string, (f: number) => boolean][] = [
  ["< 50k", (f) => f < 50_000],
  ["50k–200k", (f) => f >= 50_000 && f < 200_000],
  ["200k–500k", (f) => f >= 200_000 && f < 500_000],
  ["≥ 500k", (f) => f >= 500_000],
];
for (const [label, test] of tiers) console.log(`  follower ${label}: ${count((r) => test(r.followers))}`);
console.log(`  tuổi đông nhất 18-24: ${count((r) => r.age === "18-24")} · 25-34: ${count((r) => r.age === "25-34")}`);

const strong = rows.filter((r) => r.videos >= 5 && r.sunscreenProducts > 0 && r.followers < 500_000);
console.log(`\nỨng viên mạnh (≥5 video · đã bán chống nắng · <500k follower): ${strong.length}`);
for (const r of strong.sort((a, b) => b.sunscreenVideos - a.sunscreenVideos))
  console.log(
    `  ${r.handle.padEnd(26)} ${String(Math.round(r.followers / 1000)).padStart(4)}k · ${r.age} · video ${r.videos} (KCN ${r.sunscreenVideos}) · SP KCN ${r.sunscreenProducts}/${r.products} · ${r.mcn ?? "no MCN"}`,
  );

await closeDb();
