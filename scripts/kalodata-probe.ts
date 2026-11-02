// Explore Kalodata categories: npm run probe -- [level] [parentCategoryId]
import { closeDb, getDb } from "../src/lib/db/mongo";
import { KalodataClient, VN_DEFAULTS } from "../src/lib/kalodata/client";

interface CategoryRow {
  category_id: string;
  category_name: string;
  revenue: number;
  sale: number;
}

const [level = "1", parent] = process.argv.slice(2);
const db = await getDb();
const kalo = new KalodataClient(db, "probe");

console.log("balance:", await kalo.creditBalance());
const rows = await kalo.post<CategoryRow[]>(
  "/openapi/v1/tiktok/category/rank",
  {
    ...VN_DEFAULTS,
    date_range: "last30Day",
    sort_field: { field: "revenue", type: "DESC" },
    category_level: Number(level),
    category_ids: parent ? [parent] : undefined,
    page_size: 100,
    page_number: 1,
  },
  24 * 30,
);
for (const r of rows) console.log(r.category_id.padEnd(12), r.category_name, "|", Math.round(r.revenue).toLocaleString("vi-VN"));
await closeDb();
