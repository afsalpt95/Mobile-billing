import type { Request, Response } from 'express';
import type { Model } from 'mongoose';
import { MASTER_MODELS } from '../models';
import { can } from '../types';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { escapeRegex } from '../utils/pagination';
import { ok } from '../utils/respond';
import { isDuplicateKeyError } from '../utils/transaction';

function resolve(req: Request) {
  const entry = MASTER_MODELS[req.params.master];
  if (!entry) throw ApiError.notFound('Master list');
  return entry as { model: Model<any>; label: string; populate?: string[] };
}

export async function listMaster(req: Request, res: Response) {
  const { model, populate } = resolve(req);
  const q = req.query as unknown as { q?: string; active?: string; brand?: string; deviceCategory?: string; limit: number };
  const filter: Record<string, unknown> = {};
  if (q.active !== 'all') filter.isActive = q.active !== 'false';
  if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
  if (q.brand) filter.brand = q.brand;
  if (q.deviceCategory) filter.deviceCategory = q.deviceCategory;
  let query = model.find(filter).sort({ sortOrder: 1, name: 1 }).limit(q.limit).collation({ locale: 'en', strength: 2 });
  for (const p of populate ?? []) query = query.populate(p, 'name');
  ok(res, await query.lean());
}

export async function createMaster(req: Request, res: Response) {
  const { model, label } = resolve(req);
  if (req.params.master === 'device-models' && !req.body.brand) throw ApiError.validation('Select the brand for this model');
  if (req.params.master === 'payment-methods' && !can(req.user!.role, 'masters.manage')) throw ApiError.forbidden();
  try {
    const doc = await model.create(req.body);
    await audit(req.user, 'CREATE', label, doc._id, undefined, doc.name);
    ok(res, doc.toObject(), 201);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const existing = await model
        .findOne({ name: req.body.name, ...(req.body.brand ? { brand: req.body.brand } : {}) })
        .collation({ locale: 'en', strength: 2 })
        .lean();
      throw ApiError.conflict(`${label} "${req.body.name}" already exists`, 'DUPLICATE', { existing });
    }
    throw err;
  }
}

/** Renaming / (de)activating master data is an admin task; references keep pointing to the same record. */
export async function updateMaster(req: Request, res: Response) {
  const { model, label } = resolve(req);
  try {
    const doc = await model.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true }).lean();
    if (!doc) throw ApiError.notFound(label);
    await audit(req.user, 'UPDATE', label, req.params.id, undefined, (doc as { name?: string }).name);
    ok(res, doc);
  } catch (err) {
    if (isDuplicateKeyError(err)) throw ApiError.conflict(`${label} "${req.body.name}" already exists`, 'DUPLICATE');
    throw err;
  }
}
