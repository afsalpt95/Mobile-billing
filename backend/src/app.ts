import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { connectDatabase } from './config/db';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';
import routes from './routes';
import { getSettings } from './services/settings.service';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow non-browser clients (curl, tests) which send no Origin header.
        if (!origin || env.CORS_ORIGINS.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['Content-Disposition'],
      maxAge: 600,
    }),
  );
  // 512kb accommodates a small logo data-URL in settings.
  app.use(express.json({ limit: '512kb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.get('/', (_req, res) => res.json({ name: 'Mobile Shop POS API', api: env.API_PREFIX }));
  app.use(env.API_PREFIX, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/**
 * Vercel entrypoint: zero-config Express deployment picks up this file's default export (server.ts is used
 * everywhere else). There is no startup hook, so each instance connects to MongoDB on its first request.
 */
let ready: Promise<void> | undefined;
const vercelApp = express();
vercelApp.use((_req, _res, next) => {
  ready ??= connectDatabase().then(async () => {
    await getSettings(); // loads currency precision
  });
  ready.then(
    () => next(),
    (err) => {
      ready = undefined; // retry on the next request
      next(err);
    },
  );
});
vercelApp.use(createApp());
export default vercelApp;
