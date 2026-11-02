import { z } from 'zod';

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  sort: z.string().optional(),
  q: z.string().trim().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;

/** Parses `sort` like "-date" or "name" against an allow-list. */
export function buildSort(sort: string | undefined, allowed: string[], fallback: Record<string, 1 | -1>) {
  if (!sort) return fallback;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  if (!allowed.includes(field)) return fallback;
  return { [field]: desc ? -1 : 1, _id: desc ? -1 : 1 } as Record<string, 1 | -1>;
}

export function paged<T>(items: T[], total: number, page: number, limit: number) {
  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Escape user input for safe use in a RegExp (prevents ReDoS / regex injection). */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function searchRegex(q?: string): RegExp | undefined {
  if (!q) return undefined;
  return new RegExp(escapeRegex(q.slice(0, 100)), 'i');
}
