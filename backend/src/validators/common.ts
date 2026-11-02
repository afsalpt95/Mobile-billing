import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const idParam = z.object({ id: objectId });

/** Empty strings from forms become undefined. */
export const optStr = (max = 500) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

export const reqStr = (max = 200, label = 'This field') => z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

export const optId = z.preprocess((v) => (v === '' ? undefined : v), objectId.optional());
export const nullableId = z.preprocess((v) => (v === '' ? null : v), objectId.nullable().optional());

export const money = z.coerce.number({ invalid_type_error: 'Enter a valid amount' }).min(0, 'Amount cannot be negative').max(1e11);
export const qty = z.coerce.number({ invalid_type_error: 'Enter a valid quantity' }).positive('Quantity must be greater than zero').max(1e7);
export const percent = z.coerce.number().min(0).max(100);
export const optDate = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.date().optional());

export const clientRequestId = z.string().trim().min(8).max(64).optional();

export const methodSplit = z.object({
  method: reqStr(50, 'Payment method'),
  amount: money,
  reference: optStr(100),
});

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  q: optStr(100),
  sort: optStr(30),
  from: optDate,
  to: optDate,
});

export const dateRangeQuery = z.object({
  from: optStr(10),
  to: optStr(10),
});

export const reasonBody = z.object({ reason: reqStr(500, 'Reason') });

/** Query-string boolean: only "true"/"1" are true (z.coerce.boolean would turn "false" into true). */
export const qBool = z
  .preprocess((v) => (v === undefined || v === '' ? undefined : String(v)), z.enum(['true', 'false', '1', '0']).optional())
  .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1'));
