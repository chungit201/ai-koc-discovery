/**
 * Thử một công cụ của agent KOC (docs/10-koc-agent.md, P2) trên dữ liệu thật, không qua LLM.
 *   npm run koc:tool -- <tool|all> <creator_id|@handle> ['{"limit":5}'] [--rows]
 * Phiên mặc định "cli"; bằng chứng ghi vào `evidence` với session_id này.
 */
import { getDb, closeDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";
import { KOC_TOOLS, runKocTool } from "../src/lib/koc-data/tools";

async function main() {
  const argv = process.argv.slice(2);
  const showRows = argv.includes("--rows");
  const [tool, who, json] = argv.filter((a) => a !== "--rows");
  if (!tool || !who) {
    console.log(`Dùng: npm run koc:tool -- <${KOC_TOOLS.map((t) => t.name).join("|")}|all> <creator_id|@handle> ['{json args}'] [--rows]`);
    process.exit(1);
  }
  const db = await getDb();
  const handle = who.startsWith("@") ? who : `@${who}`;
  const creator = await db.collection(C.creators).findOne({ $or: [{ _id: who as never }, { handle }] }, { projection: { _id: 1, handle: 1 } });
  if (!creator) throw new Error(`Không tìm thấy KOC ${who}`);
  const ctx = { creatorId: String(creator._id), sessionId: "cli" };
  const names = tool === "all" ? KOC_TOOLS.filter((t) => t.name !== "calc").map((t) => t.name) : [tool];
  for (const name of names) {
    const t0 = Date.now();
    try {
      const r = await runKocTool(name, ctx, json ? JSON.parse(json) : {});
      console.log(`\n── ${name} (${Date.now() - t0} ms) ${r.evidence_id}\n${r.summary}`);
      console.log("numbers:", JSON.stringify(r.numbers));
      if (showRows) console.log(JSON.stringify(r.rows, null, 1));
    } catch (e) {
      console.log(`\n── ${name} LỖI: ${(e as Error).message}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
