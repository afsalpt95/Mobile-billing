import { Types } from 'mongoose';
import { CustomerModel, CustomerLedgerModel, VendorModel, VendorLedgerModel, type CustomerLedgerEntry, type VendorLedgerEntry } from '../models';
import { ApiError } from '../utils/ApiError';
import { round, sub } from '../utils/money';
import type { Session } from '../utils/transaction';

type Id = Types.ObjectId | string;

/**
 * $inc on decimal values can accumulate binary noise (0.1 + 0.2); after incrementing we
 * write back the rounded values. Both happen inside the caller's transaction.
 */
async function incAndRound<T extends { _id: unknown }>(
  model: { findByIdAndUpdate: (...a: any[]) => any; updateOne: (...a: any[]) => any },
  id: Id,
  inc: Record<string, number>,
  set: Record<string, unknown>,
  session: Session,
): Promise<T> {
  const update: Record<string, unknown> = { $inc: inc };
  if (Object.keys(set).length) update.$set = set;
  const doc = await model.findByIdAndUpdate(id, update, { new: true, session }).lean();
  if (!doc) throw ApiError.notFound('Account');
  const fix: Record<string, number> = {};
  for (const k of Object.keys(inc)) {
    const v = (doc as Record<string, number>)[k];
    if (round(v) !== v) fix[k] = round(v);
  }
  if (Object.keys(fix).length) {
    await model.updateOne({ _id: id }, { $set: fix }, { session });
    Object.assign(doc, fix);
  }
  return doc as T;
}

export interface CustomerPosting {
  customerId: Id;
  date: Date;
  type: CustomerLedgerEntry['type'];
  refType: string;
  refId: Types.ObjectId;
  refNo?: string;
  debit?: number;
  credit?: number;
  narration?: string;
  userId?: string;
  /** Changes to the customer's cumulative statistics */
  totals?: { totalSales?: number; totalPaid?: number };
  lastPurchaseAt?: Date;
}

/** The only place Customer.balance changes: always paired with a ledger entry. */
export async function postCustomer(p: CustomerPosting, session: Session) {
  const debit = round(p.debit ?? 0);
  const credit = round(p.credit ?? 0);
  const inc: Record<string, number> = { balance: sub(debit, credit) };
  if (p.totals?.totalSales) inc.totalSales = p.totals.totalSales;
  if (p.totals?.totalPaid) inc.totalPaid = p.totals.totalPaid;
  const set: Record<string, unknown> = {};
  if (p.lastPurchaseAt) set.lastPurchaseAt = p.lastPurchaseAt;
  const customer = await incAndRound<{ _id: unknown; balance: number }>(CustomerModel, p.customerId, inc, set, session);
  await new CustomerLedgerModel({
    customer: p.customerId,
    date: p.date,
    type: p.type,
    refType: p.refType,
    refId: p.refId,
    refNo: p.refNo,
    debit,
    credit,
    balanceAfter: customer.balance,
    narration: p.narration,
    createdBy: p.userId,
  }).save({ session });
  return customer;
}

export interface VendorPosting {
  vendorId: Id;
  date: Date;
  type: VendorLedgerEntry['type'];
  refType: string;
  refId: Types.ObjectId;
  refNo?: string;
  /** Reduces what we owe (payment, return, cancellation) */
  debit?: number;
  /** Increases what we owe (purchase, refund received) */
  credit?: number;
  /** Change to outstanding payable (sum of purchase balances) */
  payableDelta?: number;
  /** Change to advances / credit notes held with the vendor */
  advanceDelta?: number;
  totals?: { totalPurchases?: number; totalPaid?: number };
  lastPaymentAt?: Date;
  narration?: string;
  userId?: string;
}

/**
 * The only place Vendor.balance / advanceBalance change. The ledger running balance is
 * payable - advance, which always equals the cumulative (credit - debit).
 */
export async function postVendor(p: VendorPosting, session: Session) {
  const inc: Record<string, number> = {};
  if (p.payableDelta) inc.balance = round(p.payableDelta);
  if (p.advanceDelta) inc.advanceBalance = round(p.advanceDelta);
  if (p.totals?.totalPurchases) inc.totalPurchases = p.totals.totalPurchases;
  if (p.totals?.totalPaid) inc.totalPaid = p.totals.totalPaid;
  const set: Record<string, unknown> = {};
  if (p.lastPaymentAt) set.lastPaymentAt = p.lastPaymentAt;
  const vendor = await incAndRound<{ _id: unknown; balance: number; advanceBalance: number }>(VendorModel, p.vendorId, inc, set, session);
  if (vendor.advanceBalance < 0) throw ApiError.conflict('Vendor advance balance cannot go negative', 'INSUFFICIENT_ADVANCE');
  await new VendorLedgerModel({
    vendor: p.vendorId,
    date: p.date,
    type: p.type,
    refType: p.refType,
    refId: p.refId,
    refNo: p.refNo,
    debit: round(p.debit ?? 0),
    credit: round(p.credit ?? 0),
    balanceAfter: sub(vendor.balance, vendor.advanceBalance),
    narration: p.narration,
    createdBy: p.userId,
  }).save({ session });
  return vendor;
}

/** Statement for a date range: opening balance + entries + closing balance. */
export async function customerStatement(customerId: Id, from?: Date, to?: Date) {
  const match: Record<string, unknown> = { customer: customerId };
  let opening = 0;
  if (from) {
    const agg = await CustomerLedgerModel.aggregate([
      { $match: { customer: new Types.ObjectId(String(customerId)), date: { $lt: from } } },
      { $group: { _id: null, d: { $sum: '$debit' }, c: { $sum: '$credit' } } },
    ]);
    opening = round((agg[0]?.d ?? 0) - (agg[0]?.c ?? 0));
  }
  if (from || to) match.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const entries = await CustomerLedgerModel.find(match).sort({ date: 1, _id: 1 }).lean();
  let running = opening;
  const rows = entries.map((e) => {
    running = round(running + (e.debit ?? 0) - (e.credit ?? 0));
    return { ...e, runningBalance: running };
  });
  const totalDebit = round(entries.reduce((a, e) => a + (e.debit ?? 0), 0));
  const totalCredit = round(entries.reduce((a, e) => a + (e.credit ?? 0), 0));
  return { opening, entries: rows, totalDebit, totalCredit, closing: running };
}

export async function vendorStatement(vendorId: Id, from?: Date, to?: Date) {
  const vid = new Types.ObjectId(String(vendorId));
  let opening = 0;
  if (from) {
    const agg = await VendorLedgerModel.aggregate([
      { $match: { vendor: vid, date: { $lt: from } } },
      { $group: { _id: null, d: { $sum: '$debit' }, c: { $sum: '$credit' } } },
    ]);
    opening = round((agg[0]?.c ?? 0) - (agg[0]?.d ?? 0));
  }
  const match: Record<string, unknown> = { vendor: vid };
  if (from || to) match.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const entries = await VendorLedgerModel.find(match).sort({ date: 1, _id: 1 }).lean();
  let running = opening;
  const rows = entries.map((e) => {
    running = round(running + (e.credit ?? 0) - (e.debit ?? 0));
    return { ...e, runningBalance: running };
  });
  const totalDebit = round(entries.reduce((a, e) => a + (e.debit ?? 0), 0));
  const totalCredit = round(entries.reduce((a, e) => a + (e.credit ?? 0), 0));
  return { opening, entries: rows, totalDebit, totalCredit, closing: running };
}
