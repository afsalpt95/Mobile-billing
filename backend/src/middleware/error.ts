import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND'));
}

/** Centralised error handler - never leaks stack traces or internal messages to clients. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let apiError: ApiError;

  if (err instanceof ApiError) {
    apiError = err;
  } else if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    apiError = ApiError.validation(details[0]?.message ?? 'Validation failed', details);
  } else if (err instanceof mongoose.Error.CastError) {
    apiError = ApiError.badRequest(`Invalid value for ${err.path}`);
  } else if ((err as { code?: number })?.code === 11000) {
    const key = Object.keys((err as { keyPattern?: object }).keyPattern ?? {})[0] ?? 'field';
    apiError = ApiError.conflict(`A record with this ${key} already exists`, 'DUPLICATE');
  } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
    apiError = ApiError.badRequest('Malformed JSON body');
  } else if ((err as { type?: string })?.type === 'entity.too.large') {
    apiError = new ApiError(413, 'Request body too large', 'PAYLOAD_TOO_LARGE');
  } else {
    logger.error(`${req.method} ${req.originalUrl}`, err);
    apiError = new ApiError(500, 'An unexpected error occurred', 'INTERNAL_ERROR');
  }

  if (apiError.statusCode >= 500 && err instanceof ApiError) logger.error(`${req.method} ${req.originalUrl}`, err.message);

  res.status(apiError.statusCode).json({
    success: false,
    error: { code: apiError.code, message: apiError.message, details: apiError.details },
  });
}
