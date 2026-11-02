import { Types } from 'mongoose';
import { ProductModel, StockMovementModel, SerialNumberModel, type MovementType } from '../models';
import { ApiError } from '../utils/ApiError';
import { round, unitCost as perUnit } from '../utils/money';
import type { Session } from '../utils/transaction';

export interface StockRef {
  refType: string;
  refId: Types.ObjectId;
  refNo?: string;
  date?: Date;
  userId?: string;
  notes?: string;
  serials?: string[];
}

const costRound = (n: number) => Number(Math.max(0, n).toFixed(4));

/**
 * Adds stock at `unitCost` and recomputes the weighted-average cost:
 *   newAvg = (onHand * avg + qty * unitCost) / (onHand + qty)
 * Uses an optimistic filter on the previous qty/avg so a concurrent change is detected
 * (inside a transaction the write conflict is retried automatically).
 */
export async function stockIn(
  productId: Types.ObjectId | string,
  qty: number,
  unitCost: number,
  type: MovementType,
  ref: StockRef,
  session: Session,
  opts: { updatePurchaseCost?: boolean } = {},
) {
  if (qty <= 0) throw ApiError.badRequest('Quantity must be positive');
  const product = await ProductModel.findById(productId).session(session ?? null);
  if (!product) throw ApiError.notFound('Product');
  if (!product.trackInventory) throw ApiError.badRequest(`${product.name} is a service item and has no stock`);
  const onHand = product.stockQty ?? 0;
  const newQty = onHand + qty;
  // Negative on-hand (oversold with override) is valued at zero for averaging purposes.
  const basisQty = Math.max(onHand, 0);
  const newAvg =
    newQty > 0 ? costRound((basisQty * (product.avgCost ?? 0) + qty * unitCost) / (basisQty + qty)) : product.avgCost ?? 0;

  const set: Record<string, unknown> = { stockQty: newQty, avgCost: newAvg };
  if (opts.updatePurchaseCost) set.purchaseCost = costRound(unitCost);
  const res = await ProductModel.updateOne({ _id: product._id, stockQty: onHand, avgCost: product.avgCost }, { $set: set }, { session });
  if (res.modifiedCount !== 1 && res.matchedCount !== 1) throw ApiError.conflict('Stock changed concurrently, please retry', 'STOCK_CONFLICT');

  await new StockMovementModel({
    product: product._id,
    productName: product.name,
    date: ref.date ?? new Date(),
    type,
    qty,
    unitCost: costRound(unitCost),
    value: round(qty * unitCost),
    balanceAfter: newQty,
    avgCostAfter: newAvg,
    refType: ref.refType,
    refId: ref.refId,
    refNo: ref.refNo,
    serials: ref.serials,
    notes: ref.notes,
    createdBy: ref.userId,
  }).save({ session });
  return { unitCost: costRound(unitCost), avgCost: newAvg, balanceAfter: newQty };
}

/**
 * Removes stock at the current weighted-average cost (sales, consumption, write-offs).
 * The conditional `$gte` filter makes the check-and-decrement atomic, so concurrent sales can
 * never take stock below zero unless `allowNegative` (authorised override) is set.
 */
export async function stockOut(
  productId: Types.ObjectId | string,
  qty: number,
  type: MovementType,
  ref: StockRef,
  session: Session,
  opts: { allowNegative?: boolean; toDamaged?: boolean } = {},
) {
  if (qty <= 0) throw ApiError.badRequest('Quantity must be positive');
  const filter: Record<string, unknown> = { _id: productId, trackInventory: true };
  if (!opts.allowNegative) filter.stockQty = { $gte: qty };
  const inc: Record<string, number> = { stockQty: -qty };
  if (opts.toDamaged) inc.damagedQty = qty;
  const product = await ProductModel.findOneAndUpdate(filter, { $inc: inc }, { new: true, session });
  if (!product) {
    const current = await ProductModel.findById(productId).session(session ?? null).lean();
    if (!current) throw ApiError.notFound('Product');
    if (!current.trackInventory) throw ApiError.badRequest(`${current.name} is a service item and has no stock`);
    throw ApiError.conflict(
      `Insufficient stock for ${current.name}: available ${current.stockQty}, requested ${qty}`,
      'INSUFFICIENT_STOCK',
      { productId: String(productId), available: current.stockQty, requested: qty },
    );
  }
  const cost = product.avgCost ?? 0;
  await new StockMovementModel({
    product: product._id,
    productName: product.name,
    date: ref.date ?? new Date(),
    type,
    qty: -qty,
    damagedQty: opts.toDamaged ? qty : 0,
    unitCost: cost,
    value: round(qty * cost),
    balanceAfter: product.stockQty,
    avgCostAfter: cost,
    refType: ref.refType,
    refId: ref.refId,
    refNo: ref.refNo,
    serials: ref.serials,
    notes: ref.notes,
    createdBy: ref.userId,
  }).save({ session });
  return { unitCost: cost, costTotal: round(qty * cost), balanceAfter: product.stockQty };
}

/**
 * Removes stock at a specific historical cost (purchase cancellation / vendor return) and
 * backs that cost out of the weighted average:
 *   newAvg = (onHand * avg - qty * unitCost) / (onHand - qty)
 */
export async function stockOutAtCost(
  productId: Types.ObjectId | string,
  qty: number,
  unitCost: number,
  type: MovementType,
  ref: StockRef,
  session: Session,
) {
  const product = await ProductModel.findById(productId).session(session ?? null);
  if (!product) throw ApiError.notFound('Product');
  const onHand = product.stockQty ?? 0;
  if (onHand < qty) {
    throw ApiError.conflict(
      `Cannot remove ${qty} x ${product.name}: only ${onHand} in stock (already sold or consumed)`,
      'INSUFFICIENT_STOCK',
    );
  }
  const newQty = onHand - qty;
  const newAvg = newQty > 0 ? costRound((onHand * (product.avgCost ?? 0) - qty * unitCost) / newQty) : product.avgCost ?? 0;
  const res = await ProductModel.updateOne(
    { _id: product._id, stockQty: onHand, avgCost: product.avgCost },
    { $set: { stockQty: newQty, avgCost: newAvg } },
    { session },
  );
  if (res.matchedCount !== 1) throw ApiError.conflict('Stock changed concurrently, please retry', 'STOCK_CONFLICT');
  await new StockMovementModel({
    product: product._id,
    productName: product.name,
    date: ref.date ?? new Date(),
    type,
    qty: -qty,
    unitCost: costRound(unitCost),
    value: round(qty * unitCost),
    balanceAfter: newQty,
    avgCostAfter: newAvg,
    refType: ref.refType,
    refId: ref.refId,
    refNo: ref.refNo,
    serials: ref.serials,
    notes: ref.notes,
    createdBy: ref.userId,
  }).save({ session });
  return { unitCost, costTotal: round(qty * unitCost) };
}

/** Records damaged stock received back (customer return not fit for resale) without touching sellable qty. */
export async function receiveDamaged(productId: Types.ObjectId | string, qty: number, unitCost: number, ref: StockRef, session: Session) {
  const product = await ProductModel.findByIdAndUpdate(productId, { $inc: { damagedQty: qty } }, { new: true, session });
  if (!product) throw ApiError.notFound('Product');
  await new StockMovementModel({
    product: product._id,
    productName: product.name,
    date: ref.date ?? new Date(),
    type: 'SALE_RETURN_DAMAGED',
    qty: 0,
    damagedQty: qty,
    unitCost,
    value: round(qty * unitCost),
    balanceAfter: product.stockQty,
    avgCostAfter: product.avgCost,
    refType: ref.refType,
    refId: ref.refId,
    refNo: ref.refNo,
    serials: ref.serials,
    notes: ref.notes,
    createdBy: ref.userId,
  }).save({ session });
}

export function normaliseSerials(serials: string[] | undefined): string[] {
  return (serials ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/** Validates and marks serials as sold. */
export async function sellSerials(
  productId: Types.ObjectId,
  productName: string,
  serials: string[],
  qty: number,
  sale: { id: Types.ObjectId; invoiceNo: string; date: Date },
  session: Session,
) {
  if (!Number.isInteger(qty) || serials.length !== qty) {
    throw ApiError.validation(`${productName}: enter exactly ${qty} IMEI/serial number(s)`);
  }
  if (new Set(serials).size !== serials.length) throw ApiError.validation(`${productName}: duplicate IMEI/serial numbers`);
  const res = await SerialNumberModel.updateMany(
    { serial: { $in: serials }, product: productId, status: 'IN_STOCK' },
    { $set: { status: 'SOLD', sale: sale.id, invoiceNo: sale.invoiceNo, soldAt: sale.date } },
    { session },
  );
  if (res.modifiedCount !== serials.length) {
    const available = await SerialNumberModel.find({ serial: { $in: serials }, product: productId, status: 'IN_STOCK' })
      .session(session ?? null)
      .lean();
    const missing = serials.filter((s) => !available.some((a) => a.serial === s));
    throw ApiError.conflict(`${productName}: IMEI/serial not in stock: ${missing.join(', ')}`, 'SERIAL_UNAVAILABLE');
  }
}

export { perUnit };
