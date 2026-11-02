import { connectDatabase, disconnectDatabase } from '../config/db';
import { syncIndexes } from './indexes';

(async () => {
  await connectDatabase();
  await syncIndexes();
  await disconnectDatabase();
  // eslint-disable-next-line no-console
  console.log('Done.');
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
