/**
 * Bổ sung sản phẩm gắn trong video mà `products` chưa có (nằm ngoài top 50 sản phẩm đã crawl): lấy thêm
 * trang 2→4 của `/creator/detail/searchProducts` cho từng KOC, dừng sớm khi đủ. Cùng nhịp/trần với crawl
 * KOC (KalodataWebClient). Resume được.
 *
 *   npm run crawl:video-products                      # mọi KOC có video gắn sản phẩm chưa có trong DB
 *   npm run crawl:video-products -- --only <creatorId>[,<id>…]
 *   npm run crawl:video-products -- --limit 100
 *   npm run crawl:video-products -- --resume <runId>
 *
 * Khoảng ngày = cửa sổ 30 ngày của lượt crawl danh sách gần nhất (khớp creator_products hiện có).
 * Exit 3 khi tài khoản bị cảnh báo/khóa (daemon không được chạy lại).
 */
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C, ensureIndexes } from "../src/lib/db/collections";
import { exitCodeFor, KalodataWebClient, LIMIT_EXIT } from "../src/lib/kalodata/web-client";
import { Checkpoint } from "../src/lib/crawl/checkpoint";
import { fillVideoProducts, missingVideoProducts } from "../src/lib/crawl/creator-products";

const { values: args } = parseArgs({ options: { resume: { type: "string" }, limit: { type: "string" }, only: { type: "string" } } });

const db = await getDb();
await ensureIndexes(db);
const runs = db.collection<{ _id: string; source: string; config: Record<string, unknown>; status: string; started_at: Date; ids?: string[] }>(C.crawlRuns);

let runId: string;
let range: { startDate: string; endDate: string };
let ids: string[];
if (args.resume) {
  const run = await runs.findOne({ _id: args.resume });
  if (!run?.ids) throw new Error(`run ${args.resume} not found`);
  ({ _id: runId, ids } = run);
  range = run.config.range as typeof range;
  await runs.updateOne({ _id: runId }, { $set: { status: "running" } });
  console.log(`▶ resuming video-products run ${runId}`);
} else {
  const ref = await runs.findOne({ source: "kalodata_web", "config.mode": { $ne: "fill" } }, { sort: { started_at: -1 } });
  if (!ref) throw new Error("chưa có lượt crawl danh sách nào để lấy khoảng ngày");
  range = { startDate: String(ref.config.start_date), endDate: String(ref.config.end_date) };
  let pool: string[];
  if (args.only) pool = args.only.split(",").map((s) => s.trim());
  else {
    // KOC đã crawl chi tiết, doanh thu cao trước
    const rows = await db
      .collection(C.creatorMetrics)
      .aggregate<{ _id: string }>([
        { $match: { category_scope: "all" } },
        { $sort: { revenue: -1 } },
        { $group: { _id: "$creator_id", revenue: { $first: "$revenue" } } },
        { $sort: { revenue: -1 } },
      ])
      .toArray();
    pool = rows.map((r) => String(r._id));
  }
  ids = [];
  for (const id of pool) if ((await missingVideoProducts(db, id)).length) ids.push(id);
  if (args.limit) ids = ids.slice(0, Number(args.limit));
  runId = randomUUID();
  await runs.insertOne({ _id: runId, source: "kalodata_web_video_products", config: { range }, ids, status: "running", started_at: new Date() });
  console.log(`▶ new video-products run ${runId}: ${ids.length} KOC thiếu sản phẩm gắn video · ${range.startDate}~${range.endDate}`);
}

const web = new KalodataWebClient(db, runId);
// Mở phiên cũng gọi Kalodata (kiểm tra đăng nhập) → có thể chạm giới hạn / phiên hỏng ngay tại đây
try {
  await web.open();
} catch (err) {
  console.error(`✖ không mở được phiên: ${err instanceof Error ? err.message : err}`);
  await web.close().catch(() => undefined);
  await closeDb();
  process.exit(exitCodeFor(err)); // 4 = chạm giới hạn → daemon dừng hẳn
}
const cp = new Checkpoint(db, runId, "web:video-products");
await cp.register(ids);
const todo = await cp.todo();
let n = 0;
let requests = 0;
let still = 0;
try {
  for (const id of todo) {
    await cp.run(id, async () => {
      const r = await fillVideoProducts(web, db, id, range);
      requests += r.pages;
      still += r.stillMissing;
    });
    if (++n % 25 === 0) console.log(`  ${n}/${todo.length} KOC · ${requests} request`, await cp.summary());
  }
} catch (err) {
  const kind = (err as { kind?: string }).kind;
  await runs.updateOne({ _id: runId }, { $set: { status: kind === "locked" ? "locked" : exitCodeFor(err) === LIMIT_EXIT ? "limited" : "partial", halted_reason: String(err), finished_at: new Date() } });
  console.error(`✖ run ${runId} stopped: ${err instanceof Error ? err.message : err}`);
  await web.close();
  await closeDb();
  process.exit(exitCodeFor(err)); // 3 = khóa tài khoản, 4 = chạm giới hạn → daemon dừng hẳn
}
await web.close();
const failed = await db.collection(C.stageItems).countDocuments({ run_id: runId, status: "failed" });
await runs.updateOne({ _id: runId }, { $set: { status: failed ? "partial" : "done", finished_at: new Date() } });
console.log(`✔ video-products run ${runId}: ${n} KOC · ${requests} request · còn ${still} sản phẩm gắn video chưa tìm thấy (ngoài 200 sản phẩm đầu)${failed ? ` · ${failed} lỗi` : ""}`);
await closeDb();
