import type { Response } from 'express';
import { paged } from './pagination';

export function ok(res: Response, data: unknown, status = 200, meta?: Record<string, unknown>) {
  return res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function okList(res: Response, result: { items: unknown[]; total: number; summary?: unknown }, page: number, limit: number) {
  return res.json({ success: true, data: { ...paged(result.items, result.total, page, limit), ...(result.summary ? { summary: result.summary } : {}) } });
}

/** 201 for a new record, 200 (+ meta.duplicate) when an idempotent retry returned the existing one. */
export function created(res: Response, data: unknown, duplicate: boolean) {
  return ok(res, data, duplicate ? 200 : 201, duplicate ? { duplicate: true } : undefined);
}
