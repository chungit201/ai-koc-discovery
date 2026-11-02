/**
 * Thử hỏi đáp về một KOC từ dòng lệnh (không cần mở UI):
 *   npm run koc:chat -- <handle hoặc creatorId> "<câu hỏi>"
 * Chỉ đọc dữ liệu đã thu thập; không ghi tin nhắn, không chạy pipeline.
 */
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";
import { handleCreatorTurn } from "../src/lib/chat-creator";

const [who, text] = process.argv.slice(2);
if (!who || !text) {
  console.error('Dùng: npm run koc:chat -- <handle|creatorId> "<câu hỏi>"');
  process.exit(1);
}

const db = await getDb();
// `creators.handle` được lưu kèm "@", nên thử cả hai dạng
const bare = who.replace(/^@/, "");
const creator =
  (await db.collection(C.creators).findOne({ _id: bare as never })) ?? (await db.collection(C.creators).findOne({ handle: { $in: [bare, `@${bare}`] } }));
if (!creator) {
  console.error(`Không tìm thấy KOC "${who}"`);
  process.exit(1);
}

const started = Date.now();
const out = await handleCreatorTurn(String(creator._id), text);
console.log(
  JSON.stringify(
    {
      koc: `${creator.nickname ?? ""} (${creator.handle})`,
      ms: Date.now() - started,
      reply: out.reply,
      steps: (out.steps ?? []).map((s) => `${s.title} — ${s.detail}`),
      peers: (out.peers ?? []).map((p) => p.name),
      points: out.reasons.map((r) => r.text),
      products: (out.products ?? []).map((p) => `${p.name.slice(0, 40)} · ${Math.round(p.share * 100)}%`),
      videos: (out.videos ?? []).map((v) => `${v.title.slice(0, 40)} · demo ${v.demo} · khung ${v.times.join("/")}s`),
      cost_usd: Math.round(out.cost_usd * 1e5) / 1e5,
    },
    null,
    1,
  ),
);
await closeDb();
process.exit(0);
