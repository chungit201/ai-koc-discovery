/** Run S5 (final picks + budget + evidence-cited reasons) for one campaign: npm run s5 -- <campaignId> */
import { runS5 } from "../src/lib/pipeline/s5-recommend";
import { getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";

const id = process.argv[2];
const db = await getDb();
const ids = id ? [id] : (await db.collection(C.campaigns).find({ s4: { $exists: true } }).toArray()).map((c) => String(c._id));
for (const cid of ids) {
  const r = await runS5(cid);
  console.log(cid, JSON.stringify({ picks: r?.picks.length, allocated: r?.allocated, budget: r?.budget_total, dropped: r?.dropped_reasons, cost: r?.cost_usd, ms: r?.duration_ms }));
  for (const p of r?.picks ?? []) console.log(" ", p.creator_id, p.budget, p.reasons.map((x) => x.text), p.caution?.text ?? "");
}
process.exit(0);
