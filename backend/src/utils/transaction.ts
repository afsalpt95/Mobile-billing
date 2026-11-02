import mongoose, { type ClientSession } from 'mongoose';
import { supportsTransactions } from '../config/db';
import { env } from '../config/env';
import { ApiError } from './ApiError';

export type Session = ClientSession | undefined;

/**
 * Runs `fn` inside a MongoDB multi-document transaction.
 *
 * - On a replica set the whole unit of work commits or aborts together, and transient
 *   write conflicts (e.g. two cashiers selling the last unit) are retried automatically.
 * - On a standalone server postings are refused unless MONGODB_REQUIRE_TRANSACTIONS=false.
 */
export async function withTransaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  if (!supportsTransactions()) {
    if (env.MONGODB_REQUIRE_TRANSACTIONS) {
      throw ApiError.unavailable(
        'Database transactions are not available. Run MongoDB as a replica set (see README) to record financial and stock postings.',
      );
    }
    return fn(undefined);
  }
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' },
    );
    return result as T;
  } finally {
    await session.endSession();
  }
}

export function isDuplicateKeyError(err: unknown, field?: string): boolean {
  const e = err as { code?: number; keyPattern?: Record<string, unknown>; message?: string };
  if (e?.code !== 11000) return false;
  if (!field) return true;
  return Boolean(e.keyPattern?.[field]) || Boolean(e.message?.includes(field));
}
