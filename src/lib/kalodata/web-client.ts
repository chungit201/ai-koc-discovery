import { createHash } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import type { Db } from "mongodb";
import { C, type ApiCall, type RawResponse } from "../db/collections";

// Dedicated crawler account session (separate from the account people use in the browser)
export const SESSION_FILE = process.env.KALODATA_WEB_SESSION ?? ".auth/kalodata-crawler.json";

// Low, steady pace. After the 2026-11-01 lock (~600 req at 1 req/1.2s) these are deliberately conservative.
const PACE = {
  minIntervalMs: Number(process.env.KALODATA_WEB_INTERVAL_MS ?? 5000), // ≤ 12 req/min
  perHour: Number(process.env.KALODATA_WEB_MAX_PER_HOUR ?? 300),
  perDay: Number(process.env.KALODATA_WEB_MAX_PER_DAY ?? 1200),
};

interface WebEnvelope<T> {
  success: boolean;
  data: T;
  message: string | null;
  code: string | null;
}

/**
 * Mã thoát cho script crawl — worker (scripts/crawl-worker.ts, chạy dưới pm2) dựa vào đây:
 *   3 = tài khoản bị cảnh báo/khóa → .cache/crawl-halted, KHÔNG BAO GIỜ tự chạy lại
 *   4 = KALODATA chặn (báo hết lượt / "limit" / HTTP 429) → .cache/crawl-limited, dừng hẳn
 *   5 = chạm TRẦN NGÀY do mình tự đặt (KALODATA_WEB_MAX_PER_DAY) → worker ngủ tới khi cửa sổ 24h có chỗ rồi chạy tiếp
 *   6 = phiên đăng nhập hỏng → .cache/crawl-session, chờ người chạy `npm run kalo:login`
 *   1 = lỗi tạm (mạng, DB) → worker thử lại sau 10 phút
 */
export const LIMIT_EXIT = 4;
export const DAILY_CAP_EXIT = 5;
export const SESSION_EXIT = 6;
export function exitCodeFor(err: unknown): number {
  const kind = (err as { kind?: string })?.kind;
  if (kind === "locked") return 3;
  if (kind === "quota") return LIMIT_EXIT;
  if (kind === "daily_cap") return DAILY_CAP_EXIT;
  if (kind === "session") return SESSION_EXIT;
  return 1;
}

export class KalodataWebError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly kind: "session" | "quota" | "empty" | "locked" | "daily_cap" | "other",
  ) {
    super(message);
  }
}

/**
 * Calls Kalodata's web endpoints from inside a logged-in page (session from `npm run kalo:login`).
 * Requests are serialized and paced; responses are cached in raw_responses like the Open API client.
 */
export class KalodataWebClient {
  private browser?: Browser;
  private page?: Page;
  private last = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /** Set once Kalodata reports the account locked; every later call fails fast. */
  halted: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly runId?: string,
  ) {}

  async open(): Promise<void> {
    this.browser = await chromium.launch();
    const context = await this.browser.newContext({ storageState: SESSION_FILE, locale: "vi-VN" });
    this.page = await context.newPage();
    await this.page.goto("https://www.kalodata.com/explore", { waitUntil: "domcontentloaded", timeout: 60_000 });
    const profile = await this.raw<{ id?: unknown }>("/user/queryProfile", {});
    if (!profile.success || !profile.data) {
      throw new KalodataWebError("Kalodata session expired — run `npm run kalo:login`", "/user/queryProfile", "session");
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  async post<T>(path: string, body: Record<string, unknown>, ttlHours = 24): Promise<T> {
    const endpoint = `web:${path}`;
    const hash = createHash("sha256").update(endpoint + JSON.stringify(body)).digest("hex");
    const raw = this.db.collection<RawResponse>(C.rawResponses);
    const started = Date.now();

    const cached = await raw.findOne({ _id: hash, expires_at: { $gt: new Date() } });
    if (cached) {
      await this.log({ endpoint, latency_ms: Date.now() - started, cache_hit: true, status: "ok" });
      return (cached.response as WebEnvelope<T>).data;
    }

    // Serialize all network calls through one paced queue
    const run = this.queue.then(() => this.fetchWithRetry<T>(path, body));
    this.queue = run.catch(() => undefined);
    const env = await run;

    const now = new Date();
    await raw.replaceOne(
      { _id: hash },
      { endpoint, request: body, response: env, credit_cost: 0, fetched_at: now, expires_at: new Date(now.getTime() + ttlHours * 3_600_000) },
      { upsert: true },
    );
    await this.log({ endpoint, latency_ms: Date.now() - started, cache_hit: false, status: "ok" });
    return env.data;
  }

  private async fetchWithRetry<T>(path: string, body: unknown, maxAttempts = 3): Promise<WebEnvelope<T>> {
    for (let attempt = 1; ; attempt++) {
      const env = await this.raw<T>(path, body);
      if (env.success) return env;
      const msg = env.message ?? "request failed";
      if (/locked|suspect|suspicious|banned|risk control/i.test(msg)) {
        // Account protection triggered: stop everything, never retry
        this.halted = msg;
        throw new KalodataWebError(`ACCOUNT LOCKED — crawl halted: ${msg}`, path, "locked");
      }
      // Kalodata chặn vì hết lượt / gọi quá nhiều → DỪNG cả lượt crawl, không thử lại (xem LIMIT_EXIT)
      if (/used up|upgrade|limit|too many|frequen/i.test(msg)) throw new KalodataWebError(msg, path, "quota");
      if (/login|unauthori|session/i.test(msg)) throw new KalodataWebError(`${msg} — run \`npm run kalo:login\``, path, "session");
      if (/not found|no data/i.test(msg)) return { ...env, success: true, data: [] as T };
      if (attempt >= maxAttempts) throw new KalodataWebError(msg, path, "other");
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }

  private async raw<T>(path: string, body: unknown): Promise<WebEnvelope<T>> {
    if (!this.page) throw new Error("call open() first");
    if (this.halted) throw new KalodataWebError(`crawl halted: ${this.halted}`, path, "locked");
    await this.pace(path);
    const res = await this.page.evaluate(
      async ({ path, body }) => {
        const r = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        return { status: r.status, json: await r.json().catch(() => null) };
      },
      { path, body },
    );
    if (res.status === 429) throw new KalodataWebError("HTTP 429 — Kalodata giới hạn tần suất, dừng crawl", path, "quota");
    if (res.status === 401 || res.status === 403) {
      throw new KalodataWebError(`HTTP ${res.status} — run \`npm run kalo:login\``, path, "session");
    }
    return (res.json ?? { success: false, data: null, message: `HTTP ${res.status}`, code: null }) as WebEnvelope<T>;
  }

  /** Enforce min interval + hourly/daily caps, counted from api_calls so caps hold across runs. */
  private async pace(path: string): Promise<void> {
    const calls = this.db.collection<ApiCall>(C.apiCalls);
    const networkCallsSince = (ms: number) =>
      calls.countDocuments({
        endpoint: { $regex: "^web:" },
        cache_hit: false,
        created_at: { $gt: new Date(Date.now() - ms) },
      });

    // Chạm trần ngày → DỪNG (không ngủ chờ): lượt sau chạy lại khi người vận hành bật
    if ((await networkCallsSince(24 * 3_600_000)) >= PACE.perDay) {
      throw new KalodataWebError(`daily cap ${PACE.perDay} reached — crawl dừng, chạy lại sau khi trần 24h có chỗ trống`, path, "daily_cap");
    }
    while ((await networkCallsSince(3_600_000)) >= PACE.perHour) {
      console.log(`  pacing: ${PACE.perHour}/h reached, waiting 5 min…`);
      await new Promise((r) => setTimeout(r, 5 * 60_000));
    }
    const wait = this.last + PACE.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
  }

  private async log(call: Pick<ApiCall, "endpoint" | "latency_ms" | "cache_hit" | "status">): Promise<void> {
    await this.db.collection<ApiCall>(C.apiCalls).insertOne({
      ...call,
      run_id: this.runId,
      provider: "kalodata",
      credit: 0,
      cost_usd: 0,
      created_at: new Date(),
    });
  }
}
