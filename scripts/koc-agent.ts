/**
 * Thử chế độ agent (docs/10-koc-agent.md, P4): Claude CLI + MCP "koc", in từng lần gọi công cụ.
 *   npm run koc:agent -- <creator_id|@handle> "<câu hỏi>" [--haiku]
 * Prompt hệ thống ở đây chỉ để thử luồng; prompt thật + validator nằm ở chat-creator (P5).
 */
import { randomUUID } from "node:crypto";
import { getDb, closeDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";
import { claudeAgent } from "../src/lib/llm/claude";

const SYSTEM = `Bạn là chuyên viên phân tích KOC TikTok Shop. Trả lời bằng tiếng Việt, chỉ dựa trên kết quả công cụ mcp__koc__*.
Lập kế hoạch ngắn, gọi công cụ để lấy dữ liệu (gọi song song khi được), thấy thiếu thì gọi tiếp. Mọi phép tính tự làm phải qua công cụ calc.
Mọi con số trong câu trả lời phải lấy từ kết quả công cụ và ghi kèm [evidence_id] ngay sau câu chứa số.`;

async function main() {
  const argv = process.argv.slice(2);
  const [who, question] = argv.filter((a) => !a.startsWith("--"));
  if (!who || !question) throw new Error('Dùng: npm run koc:agent -- @handle "câu hỏi" [--haiku]');
  const db = await getDb();
  const handle = who.startsWith("@") ? who : `@${who}`;
  const creator = await db.collection(C.creators).findOne({ $or: [{ _id: who as never }, { handle }] }, { projection: { _id: 1, nickname: 1 } });
  if (!creator) throw new Error(`Không tìm thấy KOC ${who}`);
  const session = `cli-${randomUUID().slice(0, 8)}`;
  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  for await (const ev of claudeAgent({
    system: SYSTEM,
    prompt: `KOC: ${String(creator.nickname)} (creator_id ${String(creator._id)}).\nCâu hỏi: ${question}`,
    mcp: { name: "koc", script: "scripts/koc-mcp.ts", env: { KOC_SESSION: session, KOC_CREATOR: String(creator._id) } },
    model: argv.includes("--haiku") ? "haiku" : "sonnet",
    purpose: "koc_agent_cli",
  })) {
    if (ev.type === "tool_use") console.log(`[${at()}] → ${ev.name} ${JSON.stringify(ev.input)}`);
    else if (ev.type === "tool_result") console.log(`[${at()}] ← ${ev.name}${ev.is_error ? " LỖI" : ""}: ${ev.text.split("\n").slice(0, 2).join(" | ").slice(0, 160)}`);
    else if (ev.type === "text") console.log(`[${at()}] … ${ev.text.slice(0, 300)}`);
    else {
      const r = ev.result;
      console.log(`\n══ Trả lời (${at()}, ${r.turns} lượt, ${r.tool_calls} lần gọi công cụ, $${r.cost_usd.toFixed(4)}, ${r.model_id}) ══\n${r.text}`);
    }
  }
  console.log(`\nsession: ${session}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
