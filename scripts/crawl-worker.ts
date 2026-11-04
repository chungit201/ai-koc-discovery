/**
 * Worker crawl chạy liên tục dưới pm2 (máy local) — thay cho crawl-web-daemon.ps1 + scheduled task.
 *
 *   pm2 start ecosystem.local.config.cjs            # bật
 *   pm2 logs detola-crawl                     # xem log
 *   pm2 stop detola-crawl / pm2 restart detola-crawl
 *
 * Mỗi vòng chạy tuần tự (mỗi bước là một tiến trình con, đúng script lẻ vẫn dùng tay được):
 *   crawl-web --fill-missing → build-categories → crawl-creator-shops → crawl-video-products → crawl-shops → build-categories
 * rồi nghỉ IDLE_HOURS và lặp lại (bước nào không còn việc thì thoát ngay, gần như không tốn request).
 *
 * Xử lý theo mã thoát của bước (xem exitCodeFor trong src/lib/kalodata/web-client.ts):
 *   0 → bước tiếp theo
 *   5 → chạm TRẦN NGÀY tự đặt: ngủ tới khi cửa sổ 24h có chỗ (tính từ api_calls), rồi chạy lại đúng bước đó
 *   3 → tài khoản bị khóa: ghi .cache/crawl-halted, thoát mã 3 (pm2 KHÔNG bật lại)
 *   4 → Kalodata chặn (limit/hết lượt/429): ghi .cache/crawl-limited, thoát mã 4 (pm2 KHÔNG bật lại)
 *   6 → phiên đăng nhập hỏng: ghi .cache/crawl-session, thoát mã 6 (chạy `npm run kalo:login`, xoá file, pm2 restart)
 *   khác → lỗi tạm: chờ 10 phút, thử lại bước đó
 * Lúc khởi động, còn file chặn nào trong .cache thì thoát ngay với đúng mã đó — xoá file mới chạy được.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";

const IDLE_HOURS = Number(process.env.CRAWL_WORKER_IDLE_HOURS ?? 6);
const RETRY_MS = 10 * 60_000;
const PER_DAY = Number(process.env.KALODATA_WEB_MAX_PER_DAY ?? 1200);

const STEPS: { name: string; script: string; args?: string[] }[] = [
  { name: "crawl KOC (bổ sung chi tiết top 1000)", script: "scripts/crawl-web.ts", args: ["--fill-missing", "--categories", "848776,848648", "--top", "1000"] },
  { name: "dựng cây danh mục", script: "scripts/build-categories.ts" },
  { name: "tab Cửa hàng cho KOC cũ", script: "scripts/crawl-creator-shops.ts" },
  { name: "sản phẩm gắn video còn thiếu", script: "scripts/crawl-video-products.ts" },
  { name: "tên shop", script: "scripts/crawl-shops.ts" },
  { name: "dựng cây danh mục", script: "scripts/build-categories.ts" },
];

/** File chặn → mã thoát. Còn file nào thì worker không chạy (người phải xử lý rồi xoá). */
const BLOCKERS: [string, number, string][] = [
  [".cache/crawl-halted", 3, "tài khoản Kalodata bị cảnh báo/khóa"],
  [".cache/crawl-limited", 4, "Kalodata báo giới hạn / hết lượt"],
  [".cache/crawl-session", 6, "phiên đăng nhập hỏng — chạy `npm run kalo:login`"],
];

const log = (...a: unknown[]) => console.log(new Date().toLocaleString("vi-VN"), "·", ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(script: string, args: string[] = []): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--env-file=.env.local", "--import", "tsx", script, ...args], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

/** Lúc cửa sổ 24h có chỗ cho request kế tiếp = request thứ (số-trong-cửa-sổ − trần + 1) cũ nhất + 24h. */
async function capFreeAt(): Promise<Date> {
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3_600_000);
  const q = { endpoint: { $regex: "^web:" }, cache_hit: false, created_at: { $gt: since } };
  const n = await db.collection(C.apiCalls).countDocuments(q);
  if (n < PER_DAY) return new Date();
  const [row] = await db.collection(C.apiCalls).find(q).sort({ created_at: 1 }).skip(n - PER_DAY).limit(1).toArray();
  return new Date((row?.created_at as Date).getTime() + 24 * 3_600_000 + 60_000);
}

function stop(code: number, file: string, why: string): never {
  mkdirSync(".cache", { recursive: true });
  writeFileSync(file, `${why} — ${new Date().toISOString()}\n`, "utf8");
  log(`⛔ DỪNG: ${why}. Đã ghi ${file}. Xử lý xong thì xoá file rồi \`pm2 restart detola-crawl\`.`);
  process.exit(code);
}

for (const [file, code, why] of BLOCKERS)
  if (existsSync(file)) {
    log(`⛔ Không chạy: còn ${file} (${why}). Xoá file rồi \`pm2 restart detola-crawl\`.`);
    process.exit(code);
  }

log(`▶ worker crawl bắt đầu · trần ${PER_DAY} request/24h · nghỉ ${IDLE_HOURS}h giữa các vòng`);
for (;;) {
  for (const step of STEPS) {
    for (;;) {
      log(`→ ${step.name}`);
      const code = await run(step.script, step.args);
      if (code === 0) break;
      const blocker = BLOCKERS.find(([, c]) => c === code);
      if (blocker) {
        await closeDb();
        stop(code, blocker[0], blocker[2]);
      }
      if (code === 5) {
        const at = await capFreeAt();
        const ms = Math.max(60_000, at.getTime() - Date.now());
        log(`⏸ chạm trần ngày — ngủ tới ${at.toLocaleString("vi-VN")} (${Math.round(ms / 60_000)} phút), không gửi request nào trong lúc chờ`);
        await sleep(ms);
        continue;
      }
      log(`⚠ ${step.name} lỗi (mã ${code}) — thử lại sau 10 phút`);
      await sleep(RETRY_MS);
    }
  }
  log(`✔ xong một vòng — nghỉ ${IDLE_HOURS} giờ`);
  await sleep(IDLE_HOURS * 3_600_000);
}
