/**
 * Bổ sung tab "Cửa hàng" (shop KOC hợp tác) cho các KOC ĐÃ crawl chi tiết trước khi `crawl-web.ts`
 * có bước này. Mỗi KOC 1 request; cùng nhịp/trần với crawl KOC (KalodataWebClient). Resume được.
 *
 *   npm run crawl:creator-shops                 # mọi KOC có detail mà chưa có shops_updated_at
 *   npm run crawl:creator-shops -- --limit 100
 *   npm run crawl:creator-shops -- --resume <runId>
 *
 * Khoảng ngày = cửa sổ 30 ngày của lượt crawl danh sách gần nhất → khớp creator_metrics/products.
 * Exit 3 khi tài khoản bị cảnh báo/khóa (daemon không được chạy lại).
 */
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C, ensureIndexes } from "../src/lib/db/collections";
import { exitCodeFor, KalodataWebClient, LIMIT_EXIT } from "../src/lib/kalodata/web-client";
import { Checkpoint } from "../src/lib/crawl/checkpoint";
import { crawlCreatorShops } from "../src/lib/crawl/creator-shops";

const { values: args } = parseArgs({
  options: {
    resume: { type: "string" },
    limit: { type: "string" },
  },
});

const db = await getDb();
await ensureIndexes(db);
const runs = db.collection<{ _id: string; source: string; config: Record<string, unknown>; status: string; started_at: Date; ids?: string[] }>(C.crawlRuns);

let runId: string;
let range: { startDate: string; endDate: string };
let ids: string[];
if (args.resume) {
  const run = await runs.findOne({ _id: args.resume });
  if (!run?.ids) throw new Error(`run ${args.resume} not found`);
  runId = run._id;
  range = run.config.range as typeof range;
  ids = run.ids;
  await runs.updateOne({ _id: runId }, { $set: { status: "running" } });
  console.log(`▶ resuming creator-shops run ${runId}`);
} else {
  const ref = await runs.findOne({ source: "kalodata_web", "config.mode": { $ne: "fill" } }, { sort: { started_at: -1 } });
  if (!ref) throw new Error("chưa có lượt crawl danh sách nào để lấy khoảng ngày");
  range = { startDate: String(ref.config.start_date), endDate: String(ref.config.end_date) };
  // Doanh thu cao trước: KOC hay được xem nhất có dữ liệu sớm nhất
  const rows = await db
    .collection(C.creatorMetrics)
    .aggregate<{ _id: string }>([
      { $match: { category_scope: "all" } },
      { $sort: { revenue: -1 } },
      { $group: { _id: "$creator_id", revenue: { $first: "$revenue" } } },
      { $lookup: { from: C.creators, localField: "_id", foreignField: "_id", as: "c" } },
      { $match: { "c.detail_updated_at": { $exists: true }, "c.shops_updated_at": { $exists: false } } },
      { $sort: { revenue: -1 } },
      { $project: { _id: 1 } },
    ])
    .toArray();
  ids = rows.map((r) => String(r._id));
  if (args.limit) ids = ids.slice(0, Number(args.limit));
  runId = randomUUID();
  await runs.insertOne({ _id: runId, source: "kalodata_web_creator_shops", config: { range }, ids, status: "running", started_at: new Date() });
  console.log(`▶ new creator-shops run ${runId}: ${ids.length} KOC · ${range.startDate}~${range.endDate}`);
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
const cp = new Checkpoint(db, runId, "web:creator-shops");
await cp.register(ids);
const todo = await cp.todo();
let n = 0;
let shops = 0;
try {
  for (const id of todo) {
    await cp.run(id, async () => {
      shops += await crawlCreatorShops(web, db, id, range);
    });
    if (++n % 25 === 0) console.log(`  ${n}/${todo.length} KOC · ${shops} dòng shop`, await cp.summary());
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
console.log(`✔ creator-shops run ${runId}: ${n} KOC · ${shops} dòng shop${failed ? ` · ${failed} lỗi — chạy lại với --resume ${runId}` : ""}`);
await closeDb();
