import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { ApiError } from '../utils/ApiError';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** Validates and replaces req.body / req.query / req.params with the parsed (coerced, stripped) values. */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key] ?? {});
      if (!result.success) {
        const fieldErrors = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        return next(ApiError.validation(fieldErrors[0]?.message ?? 'Invalid request', fieldErrors));
      }
      (req as unknown as Record<string, unknown>)[key] = result.data;
    }
    next();
  };
}
