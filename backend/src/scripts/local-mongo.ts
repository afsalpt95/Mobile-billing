/* eslint-disable no-console */
/**
 * Development helper: runs a PERSISTENT single-node MongoDB replica set (rs0) on 127.0.0.1:27017
 * using the mongod binary downloaded by mongodb-memory-server, storing data in backend/.mongo-data.
 *
 * Use this when MongoDB Community Server is not installed. For production / daily shop use,
 * install MongoDB Community Server as a Windows service (see README).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const port = Number(process.env.LOCAL_MONGO_PORT ?? 27017);
const dbPath = path.resolve(__dirname, '../../.mongo-data');

(async () => {
  fs.mkdirSync(dbPath, { recursive: true });
  const replSet = await MongoMemoryReplSet.create({
    replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ port, dbPath }],
    binary: { version: process.env.MONGOMS_VERSION ?? '7.0.14' },
  });
  // Keep data on shutdown.
  const uri = replSet.getUri();
  console.log(`\nLocal MongoDB replica set running (data: ${dbPath})`);
  console.log(`  URI: ${uri}`);
  console.log('  Set MONGODB_URI=mongodb://127.0.0.1:27017/mobile_shop_pos?replicaSet=rs0 in backend/.env');
  console.log('  Press Ctrl+C to stop.\n');
  const stop = async () => {
    await replSet.stop({ doCleanup: false, force: false });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((err) => {
  console.error('Failed to start local MongoDB:', err.message);
  if (String(err.message).includes('EADDRINUSE') || String(err.message).includes('port')) {
    console.error(`Port ${port} is busy - is another MongoDB already running?`);
  }
  process.exit(1);
});
