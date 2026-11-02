/**
 * Keep only the TOP N cosmetics KOCs.
 *   npm run top-kocs -- --n 1000            # dry run: shows what would be kept / deleted (read-only)
 *   npm run top-kocs -- --n 1000 --apply    # deletes everything outside the top N (after a mongodump backup)
 *
 * Ranking (code only, no AI): percentile blend over the cosmetics list rows —
 * revenue 50% · video engagement rate 30% · views 20% (same as the crawler's deep-crawl priority).
 */
import { parseArgs } from "node:util";
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";

const { values: args } = parseArgs({ options: { n: { type: "string", default: "1000" }, apply: { type: "boolean", default: false }, "keep-detailed": { type: "boolean", default: false } } });
const N = Number(args.n);
const COSMETICS = "848776,848648";
const db = await getDb();

// Latest cosmetics list row per creator
const rows = await db
  .collection(C.creatorMetrics)
  .aggregate<{ _id: string; revenue: number | null; eng: number | null; views: number | null }>([
    { $match: { category_scope: COSMETICS, source: "web:creator/queryList" } },
    { $sort: { updated_at: -1 } },
    { $group: { _id: "$creator_id", revenue: { $first: "$revenue" }, eng: { $first: "$video_engagement_rate" }, views: { $first: "$views" } } },
  ])
  .toArray();

const pctOf = (vals: number[]) => {
  const sorted = [...vals].sort((a, b) => a - b);
  return (v: number) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    return sorted.length ? lo / sorted.length : 0;
  };
};
const pR = pctOf(rows.map((r) => r.revenue ?? 0));
const pE = pctOf(rows.map((r) => r.eng ?? 0));
const pV = pctOf(rows.map((r) => r.views ?? 0));
const ranked = rows
  .map((r) => ({ id: r._id, score: 0.5 * pR(r.revenue ?? 0) + 0.3 * pE(r.eng ?? 0) + 0.2 * pV(r.views ?? 0) }))
  .sort((a, b) => b.score - a.score);
const keep = new Set(ranked.slice(0, N).map((r) => r.id));

const allIds = (await db.collection(C.creators).find({}, { projection: { _id: 1, detail_updated_at: 1 } }).toArray()).map((c) => ({
  id: String(c._id),
  detailed: Boolean(c.detail_updated_at),
}));
// --keep-detailed: never delete creators we already fully crawled
const droppedDetailed = allIds.filter((c) => !keep.has(c.id) && c.detailed).length;
if (args["keep-detailed"]) for (const c of allIds) if (c.detailed) keep.add(c.id);
const drop = allIds.filter((c) => !keep.has(c.id)).map((c) => c.id);
const keptDetailed = allIds.filter((c) => keep.has(c.id) && c.detailed).length;

const count = (col: string, f: object) => db.collection(col).countDocuments(f);
const inDrop = { $in: drop };
const report = {
  creators_total: allIds.length,
  ranked_cosmetics: rows.length,
  keep: keep.size,
  keep_with_full_detail: keptDetailed,
  keep_needing_crawl: keep.size - keptDetailed,
  delete_creators: drop.length,
  full_detail_outside_top: droppedDetailed,
  full_detail_outside_top_kept: Boolean(args["keep-detailed"]),
  delete_docs: {
    creators: drop.length,
    creator_metrics: await count(C.creatorMetrics, { creator_id: inDrop }),
    creator_products: await count(C.creatorProducts, { creator_id: inDrop }),
    videos: await count(C.videos, { creator_id: inDrop }),
    avatars: await count(C.avatars, { _id: inDrop }),
  },
};
console.log(JSON.stringify(report, null, 2));
console.log(`score cut-off at #${N}: ${ranked[N - 1]?.score.toFixed(3)}`);

if (args.apply) {
  await db.collection(C.creators).deleteMany({ _id: inDrop as never });
  await db.collection(C.creatorMetrics).deleteMany({ creator_id: inDrop });
  await db.collection(C.creatorProducts).deleteMany({ creator_id: inDrop });
  await db.collection(C.videos).deleteMany({ creator_id: inDrop });
  await db.collection(C.avatars).deleteMany({ _id: inDrop as never });
  // Products no longer sold by any kept creator
  const usedProducts = await db.collection(C.creatorProducts).distinct("product_id");
  const p = await db.collection(C.products).deleteMany({ _id: { $nin: usedProducts } as never });
  await db.collection("top_kocs").replaceOne(
    { _id: `top${N}` as never },
    { ids: [...keep], ranking: ranked.slice(0, N), created_at: new Date() },
    { upsert: true },
  );
  console.log(`✔ deleted ${drop.length} creators and their data · ${p.deletedCount} orphan products · saved list top_kocs/top${N}`);
}
await closeDb();
