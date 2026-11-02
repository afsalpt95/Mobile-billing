import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

let transactionsSupported = false;

export function supportsTransactions(): boolean {
  return transactionsSupported;
}

/** Detects whether the connected deployment is a replica set / sharded cluster (required for transactions). */
async function detectTransactionSupport(): Promise<boolean> {
  const admin = mongoose.connection.db?.admin();
  if (!admin) return false;
  const hello = (await admin.command({ hello: 1 })) as { setName?: string; msg?: string };
  return Boolean(hello.setName) || hello.msg === 'isdbgrid';
}

export async function connectDatabase(uri = env.MONGODB_URI, dbName = env.MONGODB_DB_NAME): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 8000 });
  transactionsSupported = await detectTransactionSupport();
  logger.info(`MongoDB connected: ${mongoose.connection.host}:${mongoose.connection.port}/${dbName}`);
  if (transactionsSupported) {
    logger.info('MongoDB replica set detected - multi-document transactions enabled.');
  } else if (env.MONGODB_REQUIRE_TRANSACTIONS) {
    logger.warn(
      'MongoDB is running as a STANDALONE server. Multi-document transactions are unavailable, so ' +
        'sales, purchases, payments and stock postings will be refused (HTTP 503). ' +
        'Configure a single-node replica set (see README "MongoDB replica set") or set ' +
        'MONGODB_REQUIRE_TRANSACTIONS=false for development only.',
    );
  } else {
    logger.warn(
      'MongoDB standalone server: running WITHOUT transactions (MONGODB_REQUIRE_TRANSACTIONS=false). Development use only.',
    );
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
