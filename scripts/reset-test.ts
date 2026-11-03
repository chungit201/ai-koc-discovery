// Xóa dữ liệu test: campaigns + cache LLM + chat KOC.  Dùng: npm run reset:test -- --yes
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";

const TARGETS = [
  C.campaigns,
  C.campaignScores,
  C.evidence,
  C.stageItems,
  C.llmCache,
  C.aiAssessments,
  C.creatorChats,
  C.tolaChats,
];

const apply = process.argv.includes("--yes");
const db = await getDb();
for (const name of TARGETS) {
  const n = await db.collection(name).countDocuments();
  if (apply) {
    await db.collection(name).deleteMany({});
    console.log(`${name.padEnd(18)} đã xóa ${n}`);
  } else {
    console.log(`${name.padEnd(18)} ${n} (dry-run)`);
  }
}
if (!apply) console.log("\nChạy lại với --yes để xóa thật.");
await closeDb();
