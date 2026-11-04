/**
 * MCP server "koc" (docs/02-tola-ai.md): đưa các công cụ đọc DB trong `koc-data/tools.ts` cho
 * Claude CLI ở chế độ agent. JSON-RPC 2.0 qua stdio, mỗi thông điệp một dòng — tự viết, không thêm
 * dependency.
 *
 * Phiên và KOC do tiến trình cha cố định qua biến môi trường, **agent không chọn được**: nó chỉ đọc
 * được đúng KOC đang hỏi, và mọi bằng chứng rơi vào đúng phiên để validator đối chiếu.
 *   KOC_SESSION=<id> KOC_CREATOR=<creator_id>
 *   node --conditions=react-server --env-file=.env.local --import tsx scripts/koc-mcp.ts
 *
 * stdout chỉ dành cho JSON-RPC — mọi log ra stderr.
 */
import { createInterface } from "node:readline";
import { closeDb } from "../src/lib/db/mongo";
import { KOC_TOOLS, runKocTool, type ToolResult } from "../src/lib/koc-data/tools";

const SESSION = process.env.KOC_SESSION ?? "";
/**
 * KOC được nhắc tới trong câu hỏi (`KOC_CREATORS`, phân cách dấu phẩy) — dùng làm **mặc định** khi
 * agent gọi công cụ mà không truyền `creator_id`, và để tiêu đề thẻ ghi rõ đang đọc dữ liệu của ai.
 *
 * KHÔNG còn là danh sách cho phép: từ khi có `search_creators`, agent tự tìm được KOC ngoài danh
 * sách, nên chặn cứng `creator_id` ở đây sẽ khoá luôn những câu hỏi so sánh hợp lệ ("so KOC này với
 * Châu Lười Makeup"). Công cụ nào nhận id không có thật thì tự ném lỗi "Không có KOC <id>".
 */
const CREATORS = (process.env.KOC_CREATORS ?? process.env.KOC_CREATOR ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const CAMPAIGN = process.env.KOC_CAMPAIGN || undefined;
const MULTI = CREATORS.length !== 1;
const PROTOCOL = "2025-06-18";

console.log = console.info = (...a: unknown[]) => console.error(...a); // không để thư viện nào làm bẩn stdout

type Id = string | number | null;
interface Msg {
  jsonrpc: "2.0";
  id?: Id;
  method?: string;
  params?: Record<string, unknown>;
}

const send = (m: Record<string, unknown>): void => void process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const reply = (id: Id, result: unknown) => send({ id, result });
const fail = (id: Id, code: number, message: string) => send({ id, error: { code, message } });

/** Hàng tối đa trả cho model mỗi lần gọi — đủ dựng bảng, không làm phình ngữ cảnh. */
const MAX_ROWS = 30;

/**
 * Model nhận `evidence_id` trước tiên để trích dẫn, rồi tóm tắt (số đã định dạng) và các hàng chi
 * tiết. `numbers` thô không gửi: model cần chép số đã định dạng, còn số thô chỉ dùng để kiểm tra.
 */
function toText(r: ToolResult): string {
  /**
   * Trần ký tự cho MỘT kết quả công cụ. Quá dài thì Claude CLI không đưa kết quả vào ngữ cảnh nữa mà
   * đổ ra file kèm mấy dòng mô tả ("Format: Plain text") — agent coi như không nhận được gì và tự đi
   * tìm nguồn khác. Thà cắt bớt hàng chi tiết còn hơn mất cả tóm tắt: tóm tắt và `numbers` là phần
   * agent bắt buộc phải có, còn bảng trên giao diện lấy hàng từ bản ghi `evidence` trong DB chứ
   * không lấy từ đoạn chữ này.
   */
  const LIMIT = 24_000;
  const head = `evidence_id: ${r.evidence_id}\n${r.summary}`;
  const tail = `\nnumbers (dùng làm input cho calc): ${JSON.stringify(r.numbers)}`;
  let rows = r.rows.slice(0, MAX_ROWS);
  let json = rows.length ? JSON.stringify(rows) : "";
  while (rows.length > 1 && head.length + tail.length + json.length > LIMIT) {
    rows = rows.slice(0, Math.ceil(rows.length / 2));
    json = JSON.stringify(rows);
  }
  const rowsLine = rows.length ? `\nrows (${rows.length}${r.rows.length > rows.length ? `/${r.rows.length}, đã cắt cho gọn` : ""}): ${json}` : "";
  return head + rowsLine + tail;
}

/** Công cụ không đọc dữ liệu của riêng một KOC → không chèn `creator_id`. */
const GLOBAL_TOOLS = new Set(["search_creators", "search_products", "list_categories", "list_campaigns", "start_campaign_analysis"]);
/**
 * Mở phân tích sâu — ẩn khi đã có chiến dịch (sửa bằng các công cụ chiến dịch) hoặc khi hỏi từ trang
 * hồ sơ một KOC (`KOC_NO_DEEP=1`: câu hỏi là về người đó, không phải brief tuyển người mới).
 */
const DEEP_TOOLS = new Set(["start_campaign_analysis"]);
const NO_DEEP = Boolean(CAMPAIGN) || process.env.KOC_NO_DEEP === "1";
/**
 * Chỉ có nghĩa khi đang nói về một chiến dịch cụ thể — không có `KOC_CAMPAIGN` thì agent không
 * thấy chúng trong `tools/list`, nên không thể sửa một chiến dịch mà nó không đang xem.
 */
const CAMPAIGN_TOOLS = new Set(["campaign_context", "allocate_budget", "exclude_koc", "update_criteria", "deepen_koc"]);

/** Chat chiến dịch: thêm tham số `creator_id` cho các công cụ đọc dữ liệu một KOC. */
function withCreator(name: string, schema: Record<string, unknown>): Record<string, unknown> {
  if (!MULTI || name === "calc" || CAMPAIGN_TOOLS.has(name) || GLOBAL_TOOLS.has(name)) return schema;
  const props = (schema.properties as Record<string, unknown>) ?? {};
  return {
    ...schema,
    properties: { creator_id: { type: "string", description: "id KOC (lấy từ campaign_context). Bỏ trống = KOC đầu danh sách." }, ...props },
  };
}

async function handle(m: Msg): Promise<void> {
  const id = m.id ?? null;
  switch (m.method) {
    case "initialize":
      return reply(id, {
        protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "koc", version: "1.0.0" },
      });
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, {
        tools: KOC_TOOLS.filter((t) => (!CAMPAIGN_TOOLS.has(t.name) || CAMPAIGN) && !(DEEP_TOOLS.has(t.name) && NO_DEEP)).map((t) => ({ name: t.name, description: t.description, inputSchema: withCreator(t.name, t.input_schema) })),
      });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      const { creator_id, ...args } = (m.params?.arguments as Record<string, unknown>) ?? {};
      try {
        if (!SESSION) throw new Error("Thiếu KOC_SESSION");
        // Công cụ đọc dữ liệu một KOC mà không có id nào để mặc định → bảo agent đi tìm trước
        const creatorId = creator_id ? String(creator_id) : (CREATORS[0] ?? "");
        if (!creatorId && !GLOBAL_TOOLS.has(name) && !CAMPAIGN_TOOLS.has(name) && name !== "calc")
          throw new Error("Chưa biết hỏi về KOC nào — gọi search_creators để tìm rồi truyền creator_id");
        // creator_id nằm trong args để id bằng chứng khác nhau giữa các KOC
        const r = await runKocTool(name, { creatorId, sessionId: SESSION, campaignId: CAMPAIGN }, MULTI && creator_id ? { ...args, creator_id: creatorId } : args);
        return reply(id, { content: [{ type: "text", text: toText(r) }] });
      } catch (e) {
        // Lỗi công cụ trả về như kết quả (isError) để model đọc được và tự sửa tham số
        return reply(id, { content: [{ type: "text", text: `Lỗi: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      if (m.id === undefined) return; // notification (notifications/initialized, cancelled…) — không trả lời
      return fail(id, -32601, `Không hỗ trợ ${m.method}`);
  }
}

const rl = createInterface({ input: process.stdin });
const pending = new Set<Promise<void>>();
rl.on("line", (line) => {
  if (!line.trim()) return;
  let m: Msg;
  try {
    m = JSON.parse(line);
  } catch {
    return fail(null, -32700, "JSON không hợp lệ");
  }
  const p = handle(m).catch((e) => fail(m.id ?? null, -32603, (e as Error).message));
  pending.add(p);
  p.finally(() => pending.delete(p));
});
rl.on("close", async () => {
  await Promise.all(pending);
  await closeDb();
  process.exit(0);
});
