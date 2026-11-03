import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const bool = (def: 'true' | 'false') =>
  z
    .string()
    .default(def)
    .transform((v) => v.toLowerCase() === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  API_PREFIX: z.string().default('/api/v1'),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/mobile_shop_pos'),
  MONGODB_DB_NAME: z.string().min(1).default('mobile_shop_pos'),
  MONGODB_REQUIRE_TRANSACTIONS: bool('true'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  COOKIE_NAME: z.string().default('pos_token'),
  COOKIE_SECURE: bool('false'),
  /** IANA time zone of the shop, e.g. Asia/Kolkata. Required when hosted (servers run in UTC); defaults to the machine's zone. */
  SHOP_TIMEZONE: z.string().optional(),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  SEED_ADMIN_USERNAME: z.string().default('admin'),
  SEED_ADMIN_PASSWORD: z.string().default('Admin@12345'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
