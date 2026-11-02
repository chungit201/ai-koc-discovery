import { closeDb, getDb } from "../src/lib/db/mongo";
import { ensureIndexes } from "../src/lib/db/collections";

const db = await getDb();
await ensureIndexes(db);
const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
console.log("indexes ensured; collections:", names.join(", "));
await closeDb();
