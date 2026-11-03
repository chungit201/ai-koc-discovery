import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";

/**
 * Campaign-independent AI analyses of one KOC (or video), cached by
 * (subject_id, content_hash, model_id, prompt_version) — docs/02-tola-ai.md.
 * Same content + same model + same prompt → reuse (0 tokens). Anything changes → new row; old rows stay.
 */
export interface Assessment<T> {
  _id: string;
  kind: string; // e.g. "content_screen"
  subject_id: string; // creator_id or video_id
  content_hash: string;
  model_id: string;
  prompt_version: string;
  result: T;
  created_at: Date;
}

export const contentHash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16);

export const assessmentId = (kind: string, subject: string, hash: string, modelId: string, promptVersion: string) =>
  `${kind}:${subject}:${hash}:${modelId}:${promptVersion}`;

export async function getAssessments<T>(ids: string[]): Promise<Map<string, Assessment<T>>> {
  if (!ids.length) return new Map();
  const db = await getDb();
  const rows = await db.collection<Assessment<T>>(C.aiAssessments).find({ _id: { $in: ids } }).toArray();
  return new Map(rows.map((r) => [r._id, r]));
}

export async function saveAssessments<T>(rows: Assessment<T>[]) {
  if (!rows.length) return;
  const db = await getDb();
  await db.collection<Assessment<T>>(C.aiAssessments).bulkWrite(
    rows.map((r) => ({ replaceOne: { filter: { _id: r._id }, replacement: r, upsert: true } })),
  );
}
