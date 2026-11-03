import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { getDb } from "../db/mongo";
import { C, type ApiCall } from "../db/collections";

/**
 * Headless Claude via the local Claude CLI (`claude -p`), the LLM choice for this project
 * (docs/02-tola-ai.md). No tools, no session, our own short system prompt. Every call is logged
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
/**
 * Per-call ceiling (một chiến dịch gồm nhiều call: S3 1 call/10 KOC, S4 1 call/video, S5 1 call).
 * Đo thực tế trên `api_calls`: S4 ~7s, S5 ~21s, nhưng S3 (10 KOC/call) avg 32s và đã thấy 67s —
 * khi S3 chạy song song với việc tải khung hình S4 thì mốc 90s cũ bị vượt và cả pipeline chết.
 */
const TIMEOUT_MS = 240_000;
/** Timeout thường là call chậm chứ không phải call lỗi → thử lại một lần trước khi bỏ. */
const TIMEOUT_RETRIES = 1;
const TIMEOUT_MESSAGE = "Claude CLI quá thời gian phản hồi";

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
  const modelId = pickModelId(parsed.modelUsage, model);
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
 * `modelUsage` có thể chứa nhiều model: ngoài model trả lời còn model phụ trợ của CLI
 * (vd gọi `--model sonnet` vẫn thấy một dòng haiku). Lấy khoá khớp alias đã yêu cầu;
 * nếu không có thì lấy model tiêu thụ nhiều token nhất. Ghi sai khoá này sẽ làm lệch
 * `llm_models` và khoá cache của `ai_assessments`.
 */
function pickModelId(usage: Record<string, unknown> | undefined, alias: string): string {
  const entries = Object.entries(usage ?? {});
  if (!entries.length) return alias;
  const match = entries.find(([id]) => id.includes(alias));
  if (match) return match[0];
  const tokens = (v: unknown) => {
    const u = (v ?? {}) as Record<string, number>;
    return (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
  };
  return entries.sort((a, b) => tokens(b[1]) - tokens(a[1]))[0][0];
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

/** Gọi CLI, thử lại khi quá thời gian (call chậm) nhưng không thử lại khi CLI báo lỗi thật. */
async function run(args: string[], input: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await spawnCli(args, input);
    } catch (err) {
      const timedOut = err instanceof Error && err.message === TIMEOUT_MESSAGE;
      if (!timedOut || attempt >= TIMEOUT_RETRIES) throw err;
      console.warn(`[llm] call quá ${TIMEOUT_MS / 1000}s, thử lại lần ${attempt + 2}`);
    }
  }
}

function spawnCli(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, args, { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(TIMEOUT_MESSAGE));
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

// ── Chế độ agent (docs/02-tola-ai.md) ──────────────────────────────────

/** Một MCP server stdio cho agent — chạy bằng chính node đang chạy app, cwd = gốc repo. */
export interface AgentMcp {
  name: string;
  /** Đường dẫn script tương đối với gốc repo, vd `scripts/koc-mcp.ts`. */
  script: string;
  env: Record<string, string>;
}

export type AgentEvent =
  /** Agent gọi một công cụ. `name` đã bỏ tiền tố `mcp__<server>__`. */
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; is_error: boolean; text: string }
  /** Đoạn chữ agent viết giữa các lần gọi (kế hoạch, nhận xét) — câu trả lời cuối nằm ở `done`. */
  | { type: "text"; text: string }
  | { type: "done"; result: ClaudeResult & { turns: number; tool_calls: number } };

/** Agent gọi nhiều lượt công cụ rồi mới viết — đo trước P4 ~40–90 s, để rộng cho câu khó. */
const AGENT_TIMEOUT_MS = 300_000;
const AGENT_MAX_TURNS = 24;

/**
 * Chạy Claude CLI như một agent có công cụ MCP và **phát sự kiện theo thời gian thực** (đọc
 * `stream-json` từng dòng) để giao diện hiện từng lần gọi công cụ thành thẻ như Kalopilot.
 *
 * Khác `claude()`: không cache (câu trả lời phụ thuộc kết quả công cụ của phiên), không thử lại khi
 * quá thời gian (đắt và các lần gọi công cụ đã ghi evidence), chỉ cho phép công cụ `mcp__<server>__*`
 * — công cụ có sẵn của CLI (đọc file, bash…) tắt bằng `--tools ""`, trừ những cái liệt kê trong
 * `builtinTools` (vd tìm web).
 */
export async function* claudeAgent(opts: {
  system: string;
  prompt: string;
  mcp: AgentMcp;
  model?: "haiku" | "sonnet";
  purpose: string;
  signal?: AbortSignal;
  /** Công cụ có sẵn của CLI được bật thêm, vd `["WebSearch", "WebFetch"]`. Mặc định tắt hết. */
  builtinTools?: string[];
}): AsyncGenerator<AgentEvent> {
  const model = opts.model ?? "sonnet";
  const db = await getDb();
  const started = Date.now();
  const root = process.cwd();
  const config = join(tmpdir(), `detola-mcp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: {
        [opts.mcp.name]: {
          type: "stdio",
          command: process.execPath,
          args: ["--conditions=react-server", `--env-file=${join(root, ".env.local")}`, "--import", "tsx", join(root, opts.mcp.script)],
          env: opts.mcp.env,
        },
      },
    }),
  );
  const prefix = `mcp__${opts.mcp.name}__`;
  const args = [
    "-p",
    "--model", model,
    "--output-format", "stream-json",
    "--verbose",
    "--mcp-config", config,
    "--strict-mcp-config",
    "--allowedTools", [`${prefix}*`, ...(opts.builtinTools ?? [])].join(","),
    "--tools", (opts.builtinTools ?? []).join(","),
    "--max-turns", String(AGENT_MAX_TURNS),
    "--no-session-persistence",
    "--system-prompt", opts.system,
  ];

  const child = spawn(CLI, args, { windowsHide: true, cwd: root });
  // Hàng đợi dòng stdout → generator đọc dần; kết thúc khi tiến trình đóng
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let closed: { code: number | null } | null = null;
  let failure: Error | null = null;
  let buf = "";
  let err = "";
  const notify = () => {
    wake?.();
    wake = null;
  };
  child.stdout.on("data", (d) => {
    buf += d;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    queue.push(...lines.filter((l) => l.trim()));
    notify();
  });
  child.stderr.on("data", (d) => (err += d));
  child.on("error", (e) => ((failure = e), notify()));
  child.on("close", (code) => {
    if (buf.trim()) queue.push(buf);
    closed = { code };
    notify();
  });
  const kill = (why: string) => {
    if (!closed) child.kill();
    failure ??= new Error(why);
    notify();
  };
  const timer = setTimeout(() => kill(TIMEOUT_MESSAGE), AGENT_TIMEOUT_MS);
  const onAbort = () => kill("Đã huỷ");
  opts.signal?.addEventListener("abort", onAbort);
  child.stdin.end(opts.prompt);

  const names = new Map<string, string>(); // tool_use_id → tên công cụ
  let final: Record<string, unknown> | null = null;
  let toolCalls = 0;
  try {
    while (true) {
      if (!queue.length) {
        if (failure) throw failure;
        if (closed) break;
        await new Promise<void>((r) => (wake = r));
        continue;
      }
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(queue.shift()!);
      } catch {
        continue; // dòng không phải JSON (cảnh báo của CLI) — bỏ qua
      }
      const content = ((ev.message as { content?: unknown })?.content ?? []) as Record<string, unknown>[];
      if (ev.type === "assistant")
        for (const c of Array.isArray(content) ? content : []) {
          if (c.type === "tool_use") {
            const name = String(c.name ?? "").replace(prefix, "");
            names.set(String(c.id), name);
            toolCalls++;
            yield { type: "tool_use", id: String(c.id), name, input: (c.input as Record<string, unknown>) ?? {} };
          } else if (c.type === "text" && String(c.text ?? "").trim()) yield { type: "text", text: String(c.text) };
        }
      else if (ev.type === "user")
        for (const c of Array.isArray(content) ? content : []) {
          if (c.type !== "tool_result") continue;
          const raw = c.content;
          const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((x: { text?: string }) => x.text ?? "").join("\n") : "";
          yield { type: "tool_result", id: String(c.tool_use_id), name: names.get(String(c.tool_use_id)) ?? "", is_error: Boolean(c.is_error), text };
        }
      else if (ev.type === "result") final = ev;
    }
  } catch (e) {
    await log(db, { endpoint: opts.purpose, model, tokens_in: 0, tokens_out: 0, cost: 0, latency: Date.now() - started, cache_hit: false, ok: false, error: (e as Error).message });
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    if (!closed) child.kill();
    await unlink(config).catch(() => {});
  }

  if (!final) {
    const msg = `Claude CLI kết thúc không có kết quả (exit ${(closed as { code: number | null } | null)?.code}): ${err.slice(0, 300)}`;
    await log(db, { endpoint: opts.purpose, model, tokens_in: 0, tokens_out: 0, cost: 0, latency: Date.now() - started, cache_hit: false, ok: false, error: msg });
    throw new Error(msg);
  }
  const u = (final.usage ?? {}) as Record<string, number>;
  const modelId = pickModelId(final.modelUsage as Record<string, unknown> | undefined, model);
  if (modelId !== model) await rememberModelId(model, modelId);
  const result = {
    text: String(final.result ?? ""),
    model,
    model_id: modelId,
    tokens_in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    tokens_out: u.output_tokens ?? 0,
    cost_usd: Number(final.total_cost_usd ?? 0),
    latency_ms: Date.now() - started,
    cache_hit: false,
    turns: Number(final.num_turns ?? 0),
    tool_calls: toolCalls,
  };
  const isError = Boolean(final.is_error) || (final.subtype !== undefined && final.subtype !== "success");
  await log(db, {
    endpoint: opts.purpose,
    model,
    model_id: modelId,
    tokens_in: result.tokens_in,
    tokens_out: result.tokens_out,
    cost: result.cost_usd,
    latency: result.latency_ms,
    cache_hit: false,
    ok: !isError,
    error: isError ? String(final.subtype ?? result.text).slice(0, 300) : undefined,
  });
  if (isError) throw new Error(final.subtype === "error_max_turns" ? `Agent vượt ${AGENT_MAX_TURNS} lượt` : result.text || "Claude CLI báo lỗi");
  yield { type: "done", result };
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
