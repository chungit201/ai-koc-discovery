/**
 * Download missing creator avatars into MongoDB (`avatars`) from Kalodata's public image CDN.
 * No API key, no credits, no login: https://img.kalocdn.com/tiktok.creator/<id>/avatar_medium.png
 *
 *   npm run avatars              # only creators in the DB that have no avatar yet
 */
import { Binary } from "mongodb";
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";

const CDN = (id: string) => `https://img.kalocdn.com/tiktok.creator/${id}/avatar_medium.png`;
const DELAY_MS = 500; // ~2 images/second, one at a time

const db = await getDb();
const avatars = db.collection<{ _id: string; content_type: string; data: Binary; bytes: number; source: string; fetched_at: Date }>(C.avatars);
const ids = (await db.collection(C.creators).find({}, { projection: { _id: 1 } }).toArray()).map((c) => String(c._id));
const have = new Set((await avatars.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((a) => a._id));
const todo = ids.filter((id) => !have.has(id));
console.log(`creators ${ids.length} · have avatar ${have.size} · to download ${todo.length}`);

let saved = 0;
let missing = 0;
let failed = 0;
for (const [i, id] of todo.entries()) {
  try {
    const r = await fetch(CDN(id), { signal: AbortSignal.timeout(20_000) });
    if (r.status === 404 || r.status === 403) {
      missing++;
    } else if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) {
      failed++;
    } else {
      const buf = Buffer.from(await r.arrayBuffer());
      await avatars.replaceOne(
        { _id: id },
        { content_type: r.headers.get("content-type")!, data: new Binary(buf), bytes: buf.length, source: "kalocdn", fetched_at: new Date() },
        { upsert: true },
      );
      saved++;
    }
  } catch {
    failed++;
  }
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${todo.length} · saved ${saved} · no image ${missing} · failed ${failed}`);
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.log(`✔ saved ${saved} · no image on CDN ${missing} · failed ${failed} (rerun to retry failures)`);
await closeDb();
