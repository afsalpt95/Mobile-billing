import { Types } from 'mongoose';
import { PaymentMethodModel, PurchaseModel, VendorModel, VendorPaymentModel } from '../models';
import type { AuthUser } from '../types';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { add, gt, min, round, sub } from '../utils/money';
import { escapeRegex } from '../utils/pagination';
import { isDuplicateKeyError, withTransaction, type Session } from '../utils/transaction';
import { paymentStatus } from './calc.service';
import { postVendor } from './ledger.service';
import { nextNumber } from './settings.service';

async function assertMethod(method: string, session: Session) {
  const pm = await PaymentMethodModel.findOne({ name: method, isActive: true })
    .collation({ locale: 'en', strength: 2 })
    .session(session ?? null)
    .lean();
  if (!pm) throw ApiError.validation(`Unknown or inactive payment method: ${method}`);
  return pm.name;
}

/** Applies an amount to a purchase's outstanding balance; never over-settles. */
async function settlePurchase(purchaseId: Types.ObjectId | string, amount: number, session: Session) {
  const p = await PurchaseModel.findById(purchaseId).session(session ?? null);
  if (!p) throw ApiError.notFound('Purchase');
  if (p.status !== 'RECEIVED') throw ApiError.conflict(`Purchase ${p.purchaseNo} is not an open received purchase`);
  if (gt(amount, p.balanceDue)) throw ApiError.validation(`Amount ${amount} exceeds the balance due (${p.balanceDue}) on ${p.purchaseNo}`);
  p.amountPaid = add(p.amountPaid, amount);
  p.balanceDue = sub(p.balanceDue, amount);
  p.paymentStatus = paymentStatus(sub(p.grandTotal, p.returnedAmount), p.balanceDue);
  await p.save({ session });
  return p;
}

async function unsettlePurchase(purchaseId: Types.ObjectId | string, amount: number, session: Session) {
  const p = await PurchaseModel.findById(purchaseId).session(session ?? null);
  if (!p) throw ApiError.notFound('Purchase');
  if (p.status !== 'RECEIVED') throw ApiError.conflict(`Purchase ${p.purchaseNo} is cancelled; its payments were moved to vendor advance`);
  p.amountPaid = sub(p.amountPaid, amount);
  p.balanceDue = add(p.balanceDue, amount);
  p.paymentStatus = paymentStatus(sub(p.grandTotal, p.returnedAmount), p.balanceDue);
  await p.save({ session });
}

type Allocation = { purchase: Types.ObjectId; purchaseNo: string; amount: number };

async function buildAllocations(
  vendorId: Types.ObjectId,
  amount: number,
  mode: 'OLDEST_FIRST' | 'MANUAL',
  manual: Array<{ purchaseId: string; amount: number }> | undefined,
  session: Session,
): Promise<{ allocations: Allocation[]; allocated: number }> {
  const open = await PurchaseModel.find({ vendor: vendorId, status: 'RECEIVED', balanceDue: { $gt: 0 } })
    .sort({ dueDate: 1, date: 1, _id: 1 })
    .session(session ?? null);
  const allocations: Allocation[] = [];
  if (mode === 'MANUAL') {
    const seen = new Set<string>();
    for (const a of (manual ?? []).filter((x) => x.amount > 0)) {
      if (seen.has(a.purchaseId)) throw ApiError.validation('Each purchase can be allocated only once');
      seen.add(a.purchaseId);
      const p = open.find((o) => String(o._id) === a.purchaseId);
      if (!p) throw ApiError.validation('Allocation refers to a purchase that is not outstanding for this vendor');
      if (gt(a.amount, p.balanceDue)) throw ApiError.validation(`Allocation exceeds balance due on ${p.purchaseNo}`);
      allocations.push({ purchase: p._id, purchaseNo: p.purchaseNo, amount: round(a.amount) });
    }
  } else {
    let remaining = amount;
    for (const p of open) {
      if (remaining <= 0) break;
      const take = min(remaining, p.balanceDue);
      allocations.push({ purchase: p._id, purchaseNo: p.purchaseNo, amount: take });
      remaining = sub(remaining, take);
    }
  }
  const allocated = add(...allocations.map((a) => a.amount));
  if (gt(allocated, amount)) throw ApiError.validation('Allocated amounts exceed the payment amount');
  return { allocations, allocated };
}

export interface VendorPaymentInput {
  clientRequestId?: string;
  vendorId: string;
  date?: Date;
  amount: number;
  method: string;
  reference?: string;
  allocationMode: 'OLDEST_FIRST' | 'MANUAL';
  allocations?: Array<{ purchaseId: string; amount: number }>;
  /** Excess over allocations is recorded as a vendor advance only when explicitly requested. */
  recordExcessAsAdvance?: boolean;
  notes?: string;
}

/** Core (inside a transaction) - also used for the initial payment on a purchase. */
export async function createVendorPaymentCore(input: VendorPaymentInput, user: AuthUser, session: Session) {
  const vendor = await VendorModel.findById(input.vendorId).session(session ?? null);
  if (!vendor) throw ApiError.notFound('Vendor');
  const amount = round(input.amount);
  if (amount <= 0) throw ApiError.validation('Payment amount must be greater than zero');
  const method = await assertMethod(input.method, session);
  const date = input.date ?? new Date();

  const { allocations, allocated } = await buildAllocations(vendor._id, amount, input.allocationMode, input.allocations, session);
  const excess = sub(amount, allocated);
  if (excess > 0 && !input.recordExcessAsAdvance) {
    throw ApiError.validation(
      `Payment exceeds the selected outstanding by ${excess}. Reduce the amount or choose to record the excess as a vendor advance.`,
    );
  }
  for (const a of allocations) await settlePurchase(a.purchase, a.amount, session);

  const paymentNo = await nextNumber('vendorPayment', session);
  const doc = await new VendorPaymentModel({
    paymentNo,
    clientRequestId: input.clientRequestId,
    type: 'PAYMENT',
    vendor: vendor._id,
    vendorName: vendor.name,
    date,
    amount,
    method,
    reference: input.reference,
    allocationMode: input.allocationMode,
    allocations,
    advanceAmount: excess,
    notes: input.notes,
    createdBy: user.id,
  }).save({ session });

  await postVendor(
    {
      vendorId: vendor._id,
      date,
      type: 'PAYMENT',
      refType: 'VendorPayment',
      refId: doc._id,
      refNo: paymentNo,
      debit: amount,
      payableDelta: -allocated,
      advanceDelta: excess,
      totals: { totalPaid: amount },
      lastPaymentAt: date,
      narration:
        `Payment (${method})` +
        (allocations.length ? ` against ${allocations.map((a) => a.purchaseNo).join(', ')}` : '') +
        (excess > 0 ? `; advance ${excess}` : ''),
      userId: user.id,
    },
    session,
  );
  await audit(user, 'CREATE', 'VendorPayment', doc._id, paymentNo, `Vendor payment ${amount}`, { allocations, excess }, session);
  return doc;
}

export async function createVendorPayment(input: VendorPaymentInput, user: AuthUser) {
  if (input.clientRequestId) {
    const existing = await VendorPaymentModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { payment: existing, duplicate: true };
  }
  try {
    const payment = await withTransaction((session) => createVendorPaymentCore(input, user, session));
    return { payment: payment.toObject(), duplicate: false };
  } catch (err) {
    if (input.clientRequestId && isDuplicateKeyError(err, 'clientRequestId')) {
      const existing = await VendorPaymentModel.findOne({ clientRequestId: input.clientRequestId }).lean();
      if (existing) return { payment: existing, duplicate: true };
    }
    throw err;
  }
}

/** Applies part of the vendor's advance / credit notes to outstanding purchases (no cash moves). */
export async function applyVendorAdvance(
  input: { clientRequestId?: string; vendorId: string; amount: number; allocationMode: 'OLDEST_FIRST' | 'MANUAL'; allocations?: Array<{ purchaseId: string; amount: number }>; notes?: string },
  user: AuthUser,
) {
  if (input.clientRequestId) {
    const existing = await VendorPaymentModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { payment: existing, duplicate: true };
  }
  const payment = await withTransaction(async (session) => {
    const vendor = await VendorModel.findById(input.vendorId).session(session ?? null);
    if (!vendor) throw ApiError.notFound('Vendor');
    const amount = round(input.amount);
    if (amount <= 0) throw ApiError.validation('Amount must be greater than zero');
    if (gt(amount, vendor.advanceBalance)) throw ApiError.validation(`Available vendor advance is only ${vendor.advanceBalance}`);
    const { allocations, allocated } = await buildAllocations(vendor._id, amount, input.allocationMode, input.allocations, session);
    if (round(allocated) !== amount) throw ApiError.validation('The full amount must be allocated to outstanding purchases');
    for (const a of allocations) await settlePurchase(a.purchase, a.amount, session);
    const paymentNo = await nextNumber('vendorPayment', session);
    const date = new Date();
    const doc = await new VendorPaymentModel({
      paymentNo,
      clientRequestId: input.clientRequestId,
      type: 'ADVANCE_APPLIED',
      vendor: vendor._id,
      vendorName: vendor.name,
      date,
      amount,
      method: 'Advance',
      allocationMode: input.allocationMode,
      allocations,
      notes: input.notes,
      createdBy: user.id,
    }).save({ session });
    await postVendor(
      {
        vendorId: vendor._id,
        date,
        type: 'ADVANCE_APPLIED',
        refType: 'VendorPayment',
        refId: doc._id,
        refNo: paymentNo,
        payableDelta: -amount,
        advanceDelta: -amount,
        narration: `Advance ${amount} applied to ${allocations.map((a) => a.purchaseNo).join(', ')}`,
        userId: user.id,
      },
      session,
    );
    await audit(user, 'CREATE', 'VendorPayment', doc._id, paymentNo, `Advance applied ${amount}`, { allocations }, session);
    return doc.toObject();
  });
  return { payment, duplicate: false };
}

/** Cash refund received from a vendor against their advance / credit note balance. */
export async function recordVendorRefund(
  input: { clientRequestId?: string; vendorId: string; amount: number; method: string; reference?: string; notes?: string; date?: Date },
  user: AuthUser,
) {
  if (input.clientRequestId) {
    const existing = await VendorPaymentModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { payment: existing, duplicate: true };
  }
  const payment = await withTransaction(async (session) => {
    const vendor = await VendorModel.findById(input.vendorId).session(session ?? null);
    if (!vendor) throw ApiError.notFound('Vendor');
    const amount = round(input.amount);
    if (amount <= 0) throw ApiError.validation('Amount must be greater than zero');
    if (gt(amount, vendor.advanceBalance)) throw ApiError.validation(`Vendor advance / credit balance is only ${vendor.advanceBalance}`);
    const method = await assertMethod(input.method, session);
    const paymentNo = await nextNumber('vendorPayment', session);
    const date = input.date ?? new Date();
    const doc = await new VendorPaymentModel({
      paymentNo,
      clientRequestId: input.clientRequestId,
      type: 'REFUND_RECEIVED',
      vendor: vendor._id,
      vendorName: vendor.name,
      date,
      amount,
      method,
      reference: input.reference,
      notes: input.notes,
      createdBy: user.id,
    }).save({ session });
    await postVendor(
      {
        vendorId: vendor._id,
        date,
        type: 'REFUND_RECEIVED',
        refType: 'VendorPayment',
        refId: doc._id,
        refNo: paymentNo,
        credit: amount,
        advanceDelta: -amount,
        totals: { totalPaid: -amount },
        narration: `Refund received from vendor (${method})`,
        userId: user.id,
      },
      session,
    );
    await audit(user, 'CREATE', 'VendorPayment', doc._id, paymentNo, `Vendor refund ${amount}`, undefined, session);
    return doc.toObject();
  });
  return { payment, duplicate: false };
}

export async function cancelVendorPayment(id: string, reason: string, user: AuthUser) {
  return withTransaction(async (session) => {
    const payment = await VendorPaymentModel.findOne({ _id: id, status: 'ACTIVE' }).session(session ?? null);
    if (!payment) throw ApiError.conflict('Payment not found or already cancelled');
    if (payment.type !== 'PAYMENT') throw ApiError.badRequest('Only cash/bank payments can be cancelled');
    for (const a of payment.allocations) await unsettlePurchase(a.purchase, a.amount, session);
    const allocated = add(...payment.allocations.map((a) => a.amount));
    payment.status = 'CANCELLED';
    payment.cancelledAt = new Date();
    payment.cancelReason = reason;
    await payment.save({ session });
    await postVendor(
      {
        vendorId: payment.vendor,
        date: new Date(),
        type: 'PAYMENT_CANCEL',
        refType: 'VendorPayment',
        refId: payment._id,
        refNo: payment.paymentNo,
        credit: payment.amount,
        payableDelta: allocated,
        advanceDelta: -(payment.advanceAmount ?? 0),
        totals: { totalPaid: -payment.amount },
        narration: `Cancelled payment ${payment.paymentNo}: ${reason}`,
        userId: user.id,
      },
      session,
    );
    await audit(user, 'CANCEL', 'VendorPayment', payment._id, payment.paymentNo, reason, undefined, session);
    return payment.toObject();
  });
}

export async function listVendorPayments(f: { vendor?: string; from?: Date; to?: Date; page: number; limit: number; q?: string }) {
  const query: Record<string, unknown> = {};
  if (f.vendor) query.vendor = new Types.ObjectId(f.vendor);
  if (f.from || f.to) query.date = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q.slice(0, 100)), 'i');
    query.$or = [{ paymentNo: rx }, { vendorName: rx }, { reference: rx }];
  }
  const [items, total] = await Promise.all([
    VendorPaymentModel.find(query).sort({ date: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    VendorPaymentModel.countDocuments(query),
  ]);
  return { items, total };
}

/** Payables summary per vendor (Vendor Credit screen). */
export async function vendorCreditSummary(q?: string, onlyOutstanding = true) {
  const now = new Date();
  const vendorMatch: Record<string, unknown> = {};
  if (q) vendorMatch.name = new RegExp(escapeRegex(q.slice(0, 100)), 'i');
  if (onlyOutstanding) vendorMatch.$or = [{ balance: { $gt: 0 } }, { advanceBalance: { $gt: 0 } }];
  const vendors = await VendorModel.find(vendorMatch).sort({ balance: -1 }).lean();
  const ids = vendors.map((v) => v._id);
  const agg = await PurchaseModel.aggregate([
    { $match: { vendor: { $in: ids }, status: 'RECEIVED', balanceDue: { $gt: 0 } } },
    {
      $group: {
        _id: '$vendor',
        openInvoices: { $sum: 1 },
        overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] }, '$balanceDue', 0] } },
        oldestDate: { $min: '$date' },
        nextDue: { $min: { $cond: [{ $gte: ['$dueDate', now] }, '$dueDate', null] } },
      },
    },
  ]);
  const oldest = await PurchaseModel.aggregate([
    { $match: { vendor: { $in: ids }, status: 'RECEIVED', balanceDue: { $gt: 0 } } },
    { $sort: { date: 1 } },
    { $group: { _id: '$vendor', purchaseNo: { $first: '$purchaseNo' }, date: { $first: '$date' } } },
  ]);
  return vendors.map((v) => {
    const a = agg.find((x) => String(x._id) === String(v._id));
    const o = oldest.find((x) => String(x._id) === String(v._id));
    return {
      _id: v._id,
      name: v.name,
      mobile: v.mobile,
      totalPurchases: v.totalPurchases,
      totalPaid: v.totalPaid,
      outstanding: v.balance,
      advanceBalance: v.advanceBalance,
      overdue: round(a?.overdue ?? 0),
      openInvoices: a?.openInvoices ?? 0,
      oldestUnpaid: o ? { purchaseNo: o.purchaseNo, date: o.date } : null,
      nextDueDate: a?.nextDue ?? null,
      lastPaymentAt: v.lastPaymentAt,
    };
  });
}
