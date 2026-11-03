import type { Db } from "mongodb";
import { C, type StageItem } from "../db/collections";

const MAX_ATTEMPTS = 3;

/**
 * Per-item checkpoint for a crawl/pipeline stage. Items already `done` are skipped,
 * so re-running a run after a crash only redoes unfinished work.
 */
export class Checkpoint {
  constructor(
    private readonly db: Db,
    private readonly runId: string,
    private readonly stage: string,
  ) {}

  private get col() {
    return this.db.collection<StageItem>(C.stageItems);
  }

  async register(itemIds: string[]): Promise<void> {
    if (!itemIds.length) return;
    await this.col.bulkWrite(
      itemIds.map((item_id) => ({
        updateOne: {
          filter: { run_id: this.runId, stage: this.stage, item_id },
          update: { $setOnInsert: { status: "pending", attempts: 0, updated_at: new Date() } },
          upsert: true,
        },
      })),
    );
  }

  /** Items still to do: pending, interrupted (`running`), or failed with retries left. */
  async todo(): Promise<string[]> {
    const rows = await this.col
      .find({
        run_id: this.runId,
        stage: this.stage,
        $or: [{ status: { $in: ["pending", "running"] } }, { status: "failed", attempts: { $lt: MAX_ATTEMPTS } }],
      })
      .project<{ item_id: string }>({ item_id: 1 })
      .toArray();
    return rows.map((r) => r.item_id);
  }

  async run(itemId: string, fn: () => Promise<void>): Promise<boolean> {
    const filter = { run_id: this.runId, stage: this.stage, item_id: itemId };
    await this.col.updateOne(filter, { $set: { status: "running", updated_at: new Date() }, $inc: { attempts: 1 } });
    try {
      await fn();
      await this.col.updateOne(filter, { $set: { status: "done", updated_at: new Date() }, $unset: { error: "" } });
      return true;
    } catch (err) {
      await this.col.updateOne(filter, {
        $set: { status: "failed", error: err instanceof Error ? err.message : String(err), updated_at: new Date() },
      });
      // Fatal errors (e.g. account locked) abort the whole run instead of moving to the next item
      const kind = (err as { kind?: string }).kind;
      if (kind === "locked" || kind === "daily_cap" || kind === "quota" || kind === "session") throw err; // quota/limit: dừng cả lượt, không bỏ qua sang item sau
      return false;
    }
  }

  async summary(): Promise<Record<string, number>> {
    const rows = await this.col
      .aggregate<{ _id: string; n: number }>([
        { $match: { run_id: this.runId, stage: this.stage } },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ])
      .toArray();
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
  }
}
