// Quick look at crawled data: npm run db:inspect
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";

const db = await getDb();
for (const name of Object.values(C)) {
  console.log(`${name.padEnd(18)} ${await db.collection(name).countDocuments()}`);
}

const detailRaw = await db
  .collection(C.rawResponses)
  .findOne({ endpoint: "/openapi/v1/tiktok/creator/detail" }, { sort: { fetched_at: -1 } });
console.log("\ncreator/detail response keys:", Object.keys((detailRaw?.response as { data?: object })?.data ?? {}).join(", "));

const productRaw = await db.collection(C.rawResponses).findOne({ endpoint: "/openapi/v1/tiktok/product/rank" });
const firstProduct = ((productRaw?.response as { data?: object[] })?.data ?? [])[0] ?? {};
console.log("\nproduct/rank row keys:", Object.keys(firstProduct).join(", "));

console.log("\nsample creator:", await db.collection(C.creators).findOne({ bio: { $exists: true } }));
console.log("\nsample skincare metrics:", await db.collection(C.creatorMetrics).findOne({ category_scope: "848776" }));
console.log("\nsample product:", await db.collection(C.creatorProducts).findOne({}, { sort: { revenue: -1 } }));
console.log("\nsample video:", await db.collection(C.videos).findOne({}, { sort: { views: -1 } }));
await closeDb();
