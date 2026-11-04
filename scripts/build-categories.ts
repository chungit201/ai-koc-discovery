/**
 * Dựng cây danh mục `categories` + gắn `products.category` (nhãn Kalodata hoặc suy ra từ tên) + số liệu
 * mỗi nút. Chỉ đọc/ghi DB, KHÔNG gọi Kalodata. Chạy lại sau mỗi đợt crawl.
 *
 *   npm run build:categories
 */
import { closeDb, getDb } from "../src/lib/db/mongo";
import { ensureIndexes } from "../src/lib/db/collections";
import { buildCategories } from "../src/lib/categories";

const db = await getDb();
await ensureIndexes(db);
const t0 = Date.now();
const r = await buildCategories(db);
console.log(
  `✔ categories: ${r.nodes} nút · sản phẩm: ${r.labeled} nhãn Kalodata, ${r.inferred} suy ra từ tên, ${r.unknown} chưa xếp được · ngành của ${r.kocs} KOC · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
);
await closeDb();
