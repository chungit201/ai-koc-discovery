import "server-only";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";
import { scoreCampaign } from "../scoring/run";
import { runS3 } from "./s3-content";
import { prefetchS4Frames, runS4 } from "./s4-video";
import { runS5 } from "./s5-recommend";
import { defaultPlan, type BriefPlan, type Capability } from "../plan";
import { writeOpeningAnswer } from "../chat";

/**
 * Resumable campaign pipeline S2 → S3 → S4 → S5.
 * - Progress lives in the DB: each stage writes its summary (`scoring`, `s3`, `s4`, `s5`) when done,
 *   so a restart skips finished stages. Inside a stage, AI results are saved per batch/video
 *   (`ai_assessments`) and keyframes on disk, so a half-done stage only redoes the missing items.
 * - A lease (`pipeline.lease_until`, renewed every minute) stops two runners working on one campaign.
 *   If the process dies the lease simply expires and the campaign can be resumed.
 */
const LEASE_MS = 3 * 60_000;
const running = new Set<string>();

type Stage = "s2" | "s3" | "s4" | "s5" | "answering";

export async function runPipeline(campaignId: string, opts: { force?: boolean } = {}) {
  if (running.has(campaignId)) return;
  const db = await getDb();
  const col = db.collection(C.campaigns);
  const now = new Date();
  const claim = await col.updateOne(
    opts.force
      ? { _id: campaignId as never }
      : { _id: campaignId as never, $or: [{ "pipeline.lease_until": { $exists: false } }, { "pipeline.lease_until": { $lt: now } }] },
    { $set: { "pipeline.lease_until": new Date(Date.now() + LEASE_MS), "pipeline.runs_started_at": now }, $unset: { pipeline_error: "" }, $inc: { "pipeline.attempts": 1 } },
  );
  if (!claim.matchedCount) return; // someone else holds the lease
  running.add(campaignId);
  const beat = setInterval(() => {
    void col.updateOne({ _id: campaignId as never }, { $set: { "pipeline.lease_until": new Date(Date.now() + LEASE_MS) } });
  }, 60_000);

  const mark = (stage: Stage) => col.updateOne({ _id: campaignId as never }, { $set: { "pipeline.stage": stage, "pipeline.stage_at": new Date() } });
  try {
    let c = await col.findOne({ _id: campaignId as never });
    if (!c) return;
    // Chỉ chạy các bước AI đã lập kế hoạch (chiến dịch cũ không có plan → chạy đủ như trước)
    const planned = new Set<Capability>(((c.plan as BriefPlan | undefined)?.steps ?? defaultPlan(c.criteria ?? {}).steps).map((s) => s.capability));
    if (!c.scoring) {
      await mark("s2");
      await scoreCampaign(campaignId);
    }
    c = await col.findOne({ _id: campaignId as never });
    if (planned.has("analyse_videos") && !c?.s4) void prefetchS4Frames(campaignId).catch(() => undefined); // keyframes download alongside S3
    if (planned.has("screen_content") && !c?.s3) {
      await mark("s3");
      await runS3(campaignId);
    }
    if (planned.has("analyse_videos") && !c?.s4) {
      await mark("s4");
      await runS4(campaignId);
    }
    if (planned.has("recommend") && !c?.s5) {
      await mark("s5");
      await runS5(campaignId);
    }
    // Câu trả lời mở đầu do agent viết (xem `chat.ts`). Đặt sau cùng và có stage riêng để trang
    // tiếp tục tự làm mới và hiện "đang viết" thay vì nhảy sang trạng thái xong rồi mới đổi nội dung.
    await mark("answering");
    try {
      await writeOpeningAnswer(campaignId);
    } catch (err) {
      // Hỏng bước này thì chiến dịch vẫn dùng được: trang rơi về danh sách KOC như cũ
      console.error("[pipeline] không viết được câu trả lời mở đầu", campaignId, err);
    }
    await col.updateOne({ _id: campaignId as never }, { $set: { "pipeline.stage": "done", "pipeline.finished_at": new Date() } });
  } catch (err) {
    console.error("campaign pipeline failed", campaignId, err);
    await col.updateOne({ _id: campaignId as never }, { $set: { pipeline_error: String((err as Error)?.message ?? err).slice(0, 200) } });
  } finally {
    clearInterval(beat);
    running.delete(campaignId);
    await col.updateOne({ _id: campaignId as never }, { $unset: { "pipeline.lease_until": "" } });
  }
}

/**
 * Called once at server start: continue every campaign that stopped mid-way (no S5 yet, no error).
 * A fresh process means the previous runner is gone, so stale leases are taken over (single-instance MVP).
 */
export async function resumeUnfinished() {
  const db = await getDb();
  const since = new Date(Date.now() - 7 * 86_400_000);
  const todo = await db
    .collection(C.campaigns)
    // "xong" = pipeline chạy hết kế hoạch, không phải "có s5" — kế hoạch có thể không gồm bước đề xuất
    .find({ "pipeline.stage": { $ne: "done" }, pipeline_error: { $exists: false }, created_at: { $gte: since } }, { projection: { _id: 1 } })
    .toArray();
  if (todo.length) console.log(`[pipeline] tiếp tục ${todo.length} chiến dịch dở dang`);
  for (const c of todo) await runPipeline(String(c._id), { force: true });
}
