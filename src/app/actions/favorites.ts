"use server";

import { getDb } from "@/lib/db/mongo";
import { C } from "@/lib/db/collections";

/** Save / unsave a KOC (single-workspace MVP: one shared list). Returns the new state. */
export async function toggleFavorite(creatorId: string): Promise<boolean> {
  if (!/^\d{5,25}$/.test(creatorId)) throw new Error("invalid creator id");
  const db = await getDb();
  const col = db.collection<{ _id: string; created_at: Date }>(C.favorites);
  const existing = await col.findOne({ _id: creatorId });
  if (existing) {
    await col.deleteOne({ _id: creatorId });
    return false;
  }
  await col.insertOne({ _id: creatorId, created_at: new Date() });
  return true;
}
