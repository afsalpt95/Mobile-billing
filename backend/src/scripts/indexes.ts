import mongoose from 'mongoose';
import '../models';
import { logger } from '../utils/logger';

/**
 * Creates every collection and index declared on the schemas. Collections must exist before
 * they are used inside multi-document transactions, so this runs on every server start
 * (it is a no-op when everything already exists).
 */
export async function syncIndexes(): Promise<void> {
  for (const model of Object.values(mongoose.models)) {
    try {
      await model.createCollection();
    } catch (err) {
      if ((err as { codeName?: string }).codeName !== 'NamespaceExists') throw err;
    }
    await model.createIndexes();
  }
  logger.info(`Indexes verified for ${Object.keys(mongoose.models).length} collections`);
}
