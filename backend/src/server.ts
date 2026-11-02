import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/db';
import { env } from './config/env';
import { getSettings } from './services/settings.service';
import { syncIndexes } from './scripts/indexes';
import { logger } from './utils/logger';

async function main() {
  try {
    await connectDatabase();
  } catch (err) {
    logger.error(
      `Could not connect to MongoDB at ${env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}.\n` +
        '  - Is the MongoDB service running? (Windows: `net start MongoDB`; or `npm run db:local`)\n' +
        '  - Check MONGODB_URI in backend/.env\n',
      (err as Error).message,
    );
    process.exit(1);
  }
  await syncIndexes();
  await getSettings(); // loads currency precision

  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}${env.API_PREFIX}`));
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') logger.error(`Port ${env.PORT} is already in use. Change PORT in backend/.env or stop the other process.`);
    else logger.error(err);
    process.exit(1);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
