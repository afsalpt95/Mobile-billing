/* eslint-disable no-console */
import { connectDatabase, disconnectDatabase } from '../config/db';
import { env } from '../config/env';
import { syncIndexes } from './indexes';
import { seedDefaults } from './seed-data';

(async () => {
  await connectDatabase();
  await syncIndexes();
  const result = await seedDefaults({ username: env.SEED_ADMIN_USERNAME, password: env.SEED_ADMIN_PASSWORD });
  console.log('Seed complete: default categories, brands, device models, expense categories, payment methods, vendor types, walk-in customer.');
  if (result.adminCreated) {
    console.log(`Development admin created -> username: ${env.SEED_ADMIN_USERNAME}  password: ${env.SEED_ADMIN_PASSWORD}`);
    console.log('Change this password after first login (Settings > Users).');
  } else {
    console.log(`Admin user "${env.SEED_ADMIN_USERNAME}" already exists - password unchanged.`);
  }
  await disconnectDatabase();
})().catch(async (err) => {
  console.error('Seed failed:', err.message);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
