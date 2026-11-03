/**
 * Fill shop (seller) names for products we already have, via the Kalodata WEB shop ranking
 * (`/shop/queryList`, logged-in session — never the Open API key). One call = 50 shops with names.
 * Walks the cosmetics ranking page by page and stops when MISS_STOP pages in a row bring no
 * unnamed seller of ours, or at --max-pages. Uses the same pacing/daily cap as the KOC crawl.
 *   npm run crawl:shops [-- --max-pages 80]
 */
import { exitCodeFor, KalodataWebClient } from "../src/lib/kalodata/web-client";
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const MAX_PAGES = Number(arg("max-pages", "80"));
const MISS_STOP = 5;
const end = new Date(Date.now() - 86_400_000);
const start = new Date(end.getTime() - 29 * 86_400_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

const db = await getDb();
const products = db.collection(C.products);
const unnamed = async () => {
  const named = new Set((await products.distinct("seller_id", { seller_name: { $nin: [null, ""] } })).map(String));
  return new Set((await products.distinct("seller_id")).map(String).filter((s) => !named.has(s)));
};
const todo = await unnamed();
console.log(`▶ shops: ${todo.size} sellers without a name`);
if (!todo.size) process.exit(0);

const web = new KalodataWebClient(db, `shops-${ymd(new Date())}`);
let filled = 0;
try {
  await web.open();
  let misses = 0;
  for (let page = 1; page <= MAX_PAGES && todo.size && misses < MISS_STOP; page++) {
    const rows = await web.post<Record<string, unknown>[]>("/shop/queryList", {
      country: "VN", startDate: ymd(start), endDate: ymd(end), cateIds: ["848776", "848648"], showCateIds: [],
      pageNo: page, pageSize: 50, sort: [{ field: "revenue", type: "DESC" }],
    });
    if (!rows?.length) break;
    let hit = 0;
    for (const r of rows) {
      const id = String(r.id ?? "");
      if (!id) continue;
      await db.collection(C.shops).updateOne(
        { _id: id as never },
        { $set: { name: r.name, seller_type: r.seller_type ?? null, main_category: r.main_category ?? null, region: r.region ?? null, updated_at: new Date() } },
        { upsert: true },
      );
      if (todo.has(id) && r.name) {
        await products.updateMany({ seller_id: id }, { $set: { seller_name: String(r.name) } });
        todo.delete(id);
        hit++;
      }
    }
    filled += hit;
    misses = hit ? 0 : misses + 1;
    console.log(`  page ${page}: +${hit} named · còn ${todo.size}`);
  }
  console.log(`✔ shops: named ${filled}, still unnamed ${todo.size}`);
} catch (err) {
  console.error(`✖ shops stopped: ${err instanceof Error ? err.message : err}`);
  await web.close();
  await closeDb();
  process.exit(exitCodeFor(err)); // 3 = khóa tài khoản, 4 = chạm giới hạn → daemon dừng hẳn
}
await web.close();
await closeDb();
process.exit(0);
