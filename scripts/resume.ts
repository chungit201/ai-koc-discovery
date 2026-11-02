/** Resume interrupted campaigns (same as server start does): npm run resume [-- <campaignId>] */
import { resumeUnfinished, runPipeline } from "../src/lib/pipeline/run";
import { getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";

const id = process.argv[2];
const t = Date.now();
if (id) await runPipeline(id, { force: true });
else await resumeUnfinished();
if (id) {
  const c = await (await getDb()).collection(C.campaigns).findOne({ _id: id as never });
  console.log(JSON.stringify({ ms: Date.now() - t, stage: c?.pipeline?.stage, error: c?.pipeline_error ?? null, s4: c?.s4 && { from_cache: c.s4.from_cache, analysed: c.s4.analysed, cost: c.s4.cost_usd, ms: c.s4.duration_ms }, s5: c?.s5 && { picks: c.s5.picks.length, cost: c.s5.cost_usd } }));
}
process.exit(0);
