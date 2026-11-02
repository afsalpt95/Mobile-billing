import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet: MongoMemoryReplSet | undefined;

/** One in-memory single-node replica set for the whole run, so multi-document transactions are exercised for real. */
export async function setup() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: { version: process.env.MONGOMS_VERSION ?? '7.0.14' },
  });
  process.env.TEST_MONGODB_URI = replSet.getUri();
}

export async function teardown() {
  await replSet?.stop();
}
