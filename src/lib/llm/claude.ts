import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { getDb } from "../db/mongo";
import { C, type ApiCall } from "../db/collections";

/**
 * Headless Claude via the local Claude CLI (`claude -p`), the LLM choice for this project
 * (docs/01-plan.md). No tools, no session, our own short system prompt. Every call is logged
 * to `api_calls` with tokens + cost; identical prompts are served from `llm_cache`.
 */
export interface ClaudeResult {
  text: string;
  model: string; // alias requested ("haiku" / "sonnet")
  model_id: string; // full model id that actually answered, e.g. "claude-haiku-5-5"
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  cache_hit: boolean;
}

/**
 * Spawn the real executable without a shell, so arguments with spaces/newlines (our system
 * prompt) and empty values (`--tools ""`) reach the CLI intact. On Windows the npm `claude`
 * command is a .cmd shim around claude.exe.
 */
function resolveCli(): string {
  const configured = process.env.CLAUDE_CLI_PATH;
  if (configured && configured !== "claude") return configured;
  if (process.platform === "win32" && process.env.APPDATA) {
    const exe = join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (existsSync(exe)) return exe;
  }
  return "claude";
}
const CLI = resolveCli();
const TIMEOUT_MS = 90_000;

export interface ClaudeImage {
  media_type: "image/jpeg" | "image/png";
  data: string; // base64
}

export async function claude(opts: {
  system: string;
  prompt: string;
  model?: "haiku" | "sonnet";
  purpose: string;
  images?: ClaudeImage[];
}): Promise<ClaudeResult> {
  const model = opts.model ?? "haiku";
  const imageHash = (opts.images ?? []).map((i) => createHash("sha256").update(i.data).digest("hex").slice(0, 16)).join(",");
  const key = createHash("sha256").update(`${model}\n${opts.system}\n${opts.prompt}\n${imageHash}`).digest("hex");
  const db = await getDb();
  const cache = db.collection<{ _id: string; text: string; model_id?: string; created_at: Date }>(C.llmCache);
  const started = Date.now();

  const hit = await cache.findOne({ _id: key });
  if (hit) {
    await log(db, { endpoint: opts.purpose, model, tokens_in: 0, tokens_out: 0, cost: 0, latency: Date.now() - started, cache_hit: true, ok: true });
    return { text: hit.text, model, model_id: hit.model_id ?? (await resolvedModelId(model)), tokens_in: 0, tokens_out: 0, cost_usd: 0, latency_ms: Date.now() - started, cache_hit: true };
  }

  // Images go through stream-json input (one user message with image + text blocks)
  const raw = opts.images?.length
    ? lastResultLine(
        await run(
          ["-p", "--model", model, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--tools", "", "--no-session-persistence", "--system-prompt", opts.system],
          JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                ...opts.images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
                { type: "text", text: opts.prompt },
              ],
            },
          }) + "\n",
        ),
      )
    : await run(["-p", "--model", model, "--output-format", "json", "--tools", "", "--no-session-persistence", "--system-prompt", opts.system], opts.prompt);
  let parsed: { result?: string; is_error?: boolean; total_cost_usd?: number; usage?: Record<string, number>; modelUsage?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    await log(db, { endpoint: opts.purpose, model, tokens_in: 0, tokens_out: 0, cost: 0, latency: Date.now() - started, cache_hit: false, ok: false, error: raw.slice(0, 300) });
    throw new Error("Claude CLI trả về dữ liệu không đọc được");
  }
  const u = parsed.usage ?? {};
  const tokensIn = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const modelId = Object.keys(parsed.modelUsage ?? {})[0] ?? model;
  if (modelId !== model) await rememberModelId(model, modelId);
  const result: ClaudeResult = {
    text: parsed.result ?? "",
    model,
    model_id: modelId,
    tokens_in: tokensIn,
    tokens_out: u.output_tokens ?? 0,
    cost_usd: parsed.total_cost_usd ?? 0,
    latency_ms: Date.now() - started,
    cache_hit: false,
  };
  await log(db, { endpoint: opts.purpose, model, model_id: modelId, tokens_in: result.tokens_in, tokens_out: result.tokens_out, cost: result.cost_usd, latency: result.latency_ms, cache_hit: false, ok: !parsed.is_error });
  if (parsed.is_error) throw new Error(result.text || "Claude CLI báo lỗi");
  await cache.replaceOne({ _id: key }, { text: result.text, model_id: modelId, created_at: new Date() }, { upsert: true });
  return result;
}

/**
 * Which full model an alias currently resolves to (learned from the last real call).
 * Used in cache keys so a model upgrade behind the alias invalidates old analyses.
 */
export async function resolvedModelId(alias: string): Promise<string> {
  const db = await getDb();
  const row = await db.collection<{ _id: string; model_id: string }>(C.llmModels).findOne({ _id: alias });
  return row?.model_id ?? alias;
}

async function rememberModelId(alias: string, modelId: string) {
  const db = await getDb();
  await db.collection<{ _id: string; model_id: string; seen_at: Date }>(C.llmModels).replaceOne({ _id: alias }, { model_id: modelId, seen_at: new Date() }, { upsert: true });
}

/** stream-json prints one JSON event per line; the final "result" event matches the json output shape. */
function lastResultLine(out: string): string {
  const lines = out.split("\n").filter((l) => l.includes('"type":"result"'));
  return lines[lines.length - 1] ?? out;
}

function run(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, args, { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Claude CLI quá thời gian phản hồi"));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || out.trim().startsWith("{")) resolve(out);
      else reject(new Error(`Claude CLI exit ${code}: ${err.slice(0, 300)}`));
    });
    child.stdin.end(input);
  });
}

async function log(
  db: Awaited<ReturnType<typeof getDb>>,
  c: { endpoint: string; model: string; model_id?: string; tokens_in: number; tokens_out: number; cost: number; latency: number; cache_hit: boolean; ok: boolean; error?: string },
) {
  await db.collection<ApiCall>(C.apiCalls).insertOne({
    provider: "claude",
    endpoint: `${c.endpoint} · ${c.model}`,
    model_id: c.model_id,
    credit: 0,
    cost_usd: c.cost,
    tokens_in: c.tokens_in,
    tokens_out: c.tokens_out,
    latency_ms: c.latency,
    cache_hit: c.cache_hit,
    status: c.ok ? "ok" : "error",
    error: c.error,
    created_at: new Date(),
  });
}
