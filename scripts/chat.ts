/**
 * Thử một lượt chat từ dòng lệnh (không cần mở UI):
 *   npm run chat -- <campaignId> "<câu của người dùng>" [--save]
 * Mặc định là CHẠY THỬ: không lưu tin nhắn và không đụng vào chiến dịch (dryRun), chỉ xem AI
 * phân loại ra sao và sẽ chạy lại những bước nào. Thêm `--save` để áp thật.
 */
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";
import { handleTurn } from "../src/lib/chat";

const args = process.argv.slice(2);
const save = args.includes("--save");
const [id, text] = args.filter((a) => !a.startsWith("--"));
if (!id || !text) {
  console.error('Dùng: npm run chat -- <campaignId> "<câu hỏi>" [--save]');
  process.exit(1);
}

const db = await getDb();
const started = Date.now();
if (save) await db.collection(C.campaigns).updateOne({ _id: id as never }, { $push: { messages: { id: randomUUID(), role: "user", text, created_at: new Date() } } as never });

const out = await handleTurn(id, text, { dryRun: !save });
if (save)
  await db
    .collection(C.campaigns)
    .updateOne(
      { _id: id as never },
      { $push: { messages: { id: randomUUID(), role: "assistant", text: out.reply, intent: out.intent, reruns: out.reruns, reasons: out.reasons, created_at: new Date() } } as never },
    );

const camp = await db.collection(C.campaigns).findOne({ _id: id as never });
console.log(
  JSON.stringify(
    {
      ms: Date.now() - started,
      intent: out.intent,
      reply: out.reply,
      reruns: out.reruns,
      reasons: out.reasons.map((r) => r.text),
      unverified: out.unverified,
      steps: out.steps?.map((s) => s.title),
      follow_ups: out.follow_ups,
      cost_usd: Math.round(out.cost_usd * 1e5) / 1e5,
      campaign: { budget: camp?.criteria?.budget_total, excluded: camp?.excluded_creator_ids, deep: camp?.deep_creator_ids, plan: camp?.plan?.steps?.map((s: { capability: string }) => s.capability) },
    },
    null,
    1,
  ),
);
if (out.markdown) console.log(`\n──────── CÂU TRẢ LỜI ────────\n${out.markdown}\n`);
await closeDb();
process.exit(0);
