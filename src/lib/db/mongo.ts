import { MongoClient, type Db } from "mongodb";

const globalForMongo = globalThis as unknown as { _mongo?: MongoClient };

export function getMongoClient(): MongoClient {
  if (!globalForMongo._mongo) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");
    globalForMongo._mongo = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  }
  return globalForMongo._mongo;
}

export async function getDb(): Promise<Db> {
  const client = getMongoClient();
  await client.connect();
  return client.db(process.env.MONGODB_DB ?? "detola");
}

export async function closeDb(): Promise<void> {
  await globalForMongo._mongo?.close();
  globalForMongo._mongo = undefined;
}
