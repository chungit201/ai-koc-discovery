// Verify the MongoDB connection (requires `npm run db:tunnel` in another terminal)
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);
  const { ok } = await db.command({ ping: 1 });
  const collections = await db.listCollections().toArray();
  console.log(`MongoDB ok=${ok} db=${db.databaseName} collections=${collections.length}`);
} finally {
  await client.close();
}
