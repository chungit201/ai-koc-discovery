import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { C, type ApiCall, type RawResponse } from "../db/collections";

// Pricing: docs/03-kalodata.md §2 — 1 credit ≈ 0.1 USD
const USD_PER_CREDIT = 0.1;
const RATE_LIMIT = { max: 90, windowMs: 10_000 }; // Kalodata allows 100 / 10s; keep headroom
const THROTTLED = /traffic control|try again later|rate limit/i;
const EMPTY = /not found/i;

export interface KalodataEnvelope<T> {
  success: boolean;
  data: T;
  message: string | null;
  code: string | null;
  cached: boolean | null;
}

export class KalodataError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
    readonly status?: number,
    readonly code?: string | null,
  ) {
    super(message);
  }
}

export const VN_DEFAULTS = { region: "VN", language: "vi-VN", currency: "VND" } as const;

function creditCost(endpoint: string, rows: number): number {
  if (endpoint.endsWith("/video/url")) return 0.5;
  if (endpoint.endsWith("/comment/insight")) return 1;
  if (endpoint.endsWith("/product/images") || endpoint.endsWith("/product/comments")) return 0.01;
  if (endpoint.includes("/credit/")) return 0;
  if (endpoint.endsWith("/rank")) return 0.1 * Math.max(1, Math.ceil(rows / 100));
  return 0.1;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class KalodataClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly sent: number[] = [];

  constructor(
    private readonly db: Db,
    private readonly runId?: string,
  ) {
    this.apiKey = process.env.KALODATA_API_KEY ?? "";
    this.baseUrl = process.env.KALODATA_BASE_URL ?? "https://www.kalodata.com";
    if (!this.apiKey) throw new Error("KALODATA_API_KEY is not set");
    // Decision 2026-11-01: the Open API (paid credits) is OFF. Re-enable only with the user's explicit approval.
    if (process.env.KALODATA_API_ENABLED !== "1") {
      throw new Error("Kalodata Open API is disabled (costs credits). Set KALODATA_API_ENABLED=1 only after the user approves.");
    }
  }

  /**
   * POST with a Mongo-backed cache: an identical request inside `ttlHours`
   * is served from raw_responses and costs 0 credit.
   */
  async post<T>(endpoint: string, body: Record<string, unknown>, ttlHours = 24): Promise<T> {
    const hash = createHash("sha256").update(endpoint + stableStringify(body)).digest("hex");
    const raw = this.db.collection<RawResponse>(C.rawResponses);
    const started = Date.now();

    const cached = await raw.findOne({ _id: hash, expires_at: { $gt: new Date() } });
    if (cached) {
      await this.log({ endpoint, credit: 0, latency_ms: Date.now() - started, cache_hit: true, status: "ok" });
      return (cached.response as KalodataEnvelope<T>).data;
    }

    const envelope = await this.fetchWithRetry<T>(endpoint, body);
    const rows = Array.isArray(envelope.data) ? envelope.data.length : 1;
    const credit = creditCost(endpoint, rows);
    const now = new Date();
    await raw.replaceOne(
      { _id: hash },
      {
        endpoint,
        request: body,
        response: envelope,
        credit_cost: credit,
        fetched_at: now,
        expires_at: new Date(now.getTime() + ttlHours * 3_600_000),
      },
      { upsert: true },
    );
    await this.log({ endpoint, credit, latency_ms: Date.now() - started, cache_hit: false, status: "ok" });
    return envelope.data;
  }

  async creditBalance(): Promise<{ totalRemain: number; mainRemain: number }> {
    const res = await fetch(`${this.baseUrl}/openapi/v1/credit/balance`, {
      headers: { "X-API-Key": this.apiKey },
    });
    const json = (await res.json()) as KalodataEnvelope<{ totalRemain: number; mainRemain: number }>;
    if (!json.success) throw new KalodataError(json.message ?? "balance failed", "credit/balance", res.status);
    return json.data;
  }

  private async fetchWithRetry<T>(endpoint: string, body: unknown, maxAttempts = 4): Promise<KalodataEnvelope<T>> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.throttle();
      try {
        const res = await fetch(`${this.baseUrl}${endpoint}`, {
          method: "POST",
          headers: { "X-API-Key": this.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 429 || res.status >= 500) {
          throw new KalodataError(`HTTP ${res.status}`, endpoint, res.status);
        }
        const json = (await res.json()) as KalodataEnvelope<T>;
        if (!json.success && THROTTLED.test(json.message ?? "")) {
          // Throttling arrives as HTTP 200 + success:false — back off harder and retry
          await this.log({ endpoint, credit: 0, latency_ms: 0, cache_hit: false, status: "error", error: json.message! });
          throw Object.assign(new KalodataError(json.message!, endpoint, res.status, json.code), { backoffMs: 5000 });
        }
        if (!json.success && EMPTY.test(json.message ?? "")) {
          // "video not found" etc. means no data for this filter — a valid empty result
          return { ...json, success: true, data: [] as T };
        }
        if (!json.success) {
          // Business errors (bad params, no data) are not retryable
          const err = new KalodataError(json.message ?? "request failed", endpoint, res.status, json.code);
          await this.log({ endpoint, credit: 0, latency_ms: 0, cache_hit: false, status: "error", error: err.message });
          throw Object.assign(err, { retryable: false });
        }
        return json;
      } catch (err) {
        lastError = err;
        if ((err as { retryable?: boolean }).retryable === false || attempt === maxAttempts) break;
        const base = (err as { backoffMs?: number }).backoffMs ?? 1000;
        await sleep(base * 2 ** (attempt - 1) + Math.random() * 500);
      }
    }
    throw lastError;
  }

  private async throttle(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.sent.length && now - this.sent[0] > RATE_LIMIT.windowMs) this.sent.shift();
      if (this.sent.length < RATE_LIMIT.max) {
        this.sent.push(now);
        return;
      }
      await sleep(RATE_LIMIT.windowMs - (now - this.sent[0]) + 10);
    }
  }

  private async log(call: Omit<ApiCall, "provider" | "cost_usd" | "created_at" | "run_id">): Promise<void> {
    await this.db.collection<ApiCall>(C.apiCalls).insertOne({
      ...call,
      run_id: this.runId,
      provider: "kalodata",
      cost_usd: call.credit * USD_PER_CREDIT,
      created_at: new Date(),
    });
  }
}
