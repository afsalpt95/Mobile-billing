import { Types } from 'mongoose';
import { ProductModel, PurchaseModel, PurchaseReturnModel, SerialNumberModel, VendorModel, VendorPaymentModel } from '../models';
import type { AuthUser } from '../types';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { gt, round, sub } from '../utils/money';
import { escapeRegex } from '../utils/pagination';
import { isDuplicateKeyError, withTransaction, type Session } from '../utils/transaction';
import { calculatePurchase, paymentStatus } from './calc.service';
import { normaliseSerials, stockIn, stockOutAtCost } from './inventory.service';
import { postVendor } from './ledger.service';
import { getSettings, nextNumber } from './settings.service';
import { createVendorPaymentCore } from './vendorPayment.service';

export interface PurchaseItemInput {
  productId: string;
  qty: number;
  freeQty?: number;
  unitCost: number;
  discount?: number;
  taxRate?: number;
  serials?: string[];
}

export interface PurchaseInput {
  clientRequestId?: string;
  vendorId: string;
  vendorInvoiceNo?: string;
  date?: Date;
  dueDate?: Date;
  items: PurchaseItemInput[];
  shippingCharges?: number;
  otherCharges?: number;
  paymentTerms?: string;
  notes?: string;
  attachmentRef?: string;
  initialPayment?: { amount: number; method?: string; reference?: string };
  /** Receive immediately (stock + payable) instead of saving a draft. */
  receive?: boolean;
}

async function buildPurchaseData(input: PurchaseInput, session: Session) {
  const settings = await getSettings();
  const vendor = await VendorModel.findById(input.vendorId).session(session ?? null).lean();
  if (!vendor || !vendor.isActive) throw ApiError.validation('Vendor not found or inactive');
  if (!input.items?.length) throw ApiError.validation('Add at least one item');

  const products = await ProductModel.find({ _id: { $in: input.items.map((i) => i.productId) } })
    .session(session ?? null)
    .lean();
  const map = new Map(products.map((p) => [String(p._id), p]));
  const allSerials: string[] = [];
  input.items.forEach((it, i) => {
    const p = map.get(it.productId);
    if (!p) throw ApiError.validation(`Line ${i + 1}: product not found`);
    if (!p.trackInventory || p.productType === 'SERVICE') throw ApiError.validation(`${p.name} is a service item and cannot be purchased into stock`);
    if (!(it.qty > 0)) throw ApiError.validation(`Line ${i + 1}: quantity must be greater than zero`);
    const serials = normaliseSerials(it.serials);
    const units = it.qty + (it.freeQty ?? 0);
    if (p.trackSerial) {
      if (!Number.isInteger(units)) throw ApiError.validation(`${p.name}: serial-tracked quantity must be a whole number`);
      if (serials.length && serials.length !== units) throw ApiError.validation(`${p.name}: enter ${units} IMEI/serial numbers (got ${serials.length})`);
    } else if (serials.length) {
      throw ApiError.validation(`${p.name} does not track IMEI/serial numbers`);
    }
    allSerials.push(...serials);
  });
  if (new Set(allSerials).size !== allSerials.length) throw ApiError.validation('Duplicate IMEI/serial numbers in this purchase');

  const totals = calculatePurchase(
    input.items.map((i) => ({ qty: i.qty, freeQty: i.freeQty, unitCost: i.unitCost, discount: i.discount, taxRate: i.taxRate })),
    input.shippingCharges ?? 0,
    input.otherCharges ?? 0,
    settings.tax?.purchaseTaxInCost ?? true,
  );

  const date = input.date ?? new Date();
  const initialAmount = round(input.initialPayment?.amount ?? 0);
  if (initialAmount < 0) throw ApiError.validation('Amount paid cannot be negative');
  if (gt(initialAmount, totals.grandTotal)) throw ApiError.validation('Amount paid cannot exceed the purchase total');
  if (initialAmount > 0 && !input.initialPayment?.method) throw ApiError.validation('Select the payment method for the amount paid');

  return {
    vendor,
    date,
    data: {
      vendor: vendor._id,
      vendorName: vendor.name,
      vendorInvoiceNo: input.vendorInvoiceNo,
      date,
      dueDate: input.dueDate ?? (vendor.paymentTermsDays ? new Date(date.getTime() + vendor.paymentTermsDays * 86400000) : undefined),
      items: input.items.map((it, i) => {
        const p = map.get(it.productId)!;
        return {
          product: p._id,
          name: p.name,
          sku: p.sku,
          qty: it.qty,
          freeQty: it.freeQty ?? 0,
          unitCost: round(it.unitCost),
          discount: round(it.discount ?? 0),
          taxRate: it.taxRate ?? 0,
          lineTotal: totals.lines[i].lineTotal,
          taxAmount: totals.lines[i].taxAmount,
          chargesShare: totals.lines[i].chargesShare,
          landedUnitCost: totals.lines[i].landedUnitCost,
          serials: normaliseSerials(it.serials),
        };
      }),
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxAmount: totals.taxAmount,
      shippingCharges: round(input.shippingCharges ?? 0),
      otherCharges: round(input.otherCharges ?? 0),
      grandTotal: totals.grandTotal,
      amountPaid: 0,
      balanceDue: totals.grandTotal,
      paymentStatus: 'UNPAID' as const,
      paymentTerms: input.paymentTerms,
      initialPayment: { amount: initialAmount, method: input.initialPayment?.method, reference: input.initialPayment?.reference },
      notes: input.notes,
      attachmentRef: input.attachmentRef,
    },
  };
}

async function assertUniqueVendorInvoice(vendorId: Types.ObjectId, vendorInvoiceNo: string | undefined, excludeId: Types.ObjectId | undefined, session: Session) {
  if (!vendorInvoiceNo) return;
  const dup = await PurchaseModel.findOne({
    vendor: vendorId,
    vendorInvoiceNo,
    status: { $ne: 'CANCELLED' },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .session(session ?? null)
    .lean();
  if (dup) throw ApiError.conflict(`Vendor invoice ${vendorInvoiceNo} is already recorded as ${dup.purchaseNo}`, 'DUPLICATE_VENDOR_INVOICE');
}

/**
 * Receives a draft purchase. The DRAFT -> RECEIVED status transition is a conditional update,
 * so a retried or concurrent "receive" can never add the stock twice.
 */
async function receiveCore(purchaseId: Types.ObjectId, user: AuthUser, session: Session) {
  const now = new Date();
  const p = await PurchaseModel.findOneAndUpdate(
    { _id: purchaseId, status: 'DRAFT' },
    { $set: { status: 'RECEIVED', receivedAt: now, receivedBy: user.id } },
    { new: true, session },
  );
  if (!p) {
    const existing = await PurchaseModel.findById(purchaseId).session(session ?? null).lean();
    if (!existing) throw ApiError.notFound('Purchase');
    throw ApiError.conflict(`Purchase ${existing.purchaseNo} is already ${existing.status.toLowerCase()}`, 'ALREADY_RECEIVED');
  }
  const ref = { refType: 'Purchase', refId: p._id, refNo: p.purchaseNo, date: p.date, userId: user.id };

  for (const item of p.items) {
    const product = await ProductModel.findById(item.product).session(session ?? null).lean();
    if (!product) throw ApiError.notFound('Product');
    const units = item.qty + (item.freeQty ?? 0);
    if (product.trackSerial) {
      if ((item.serials ?? []).length !== units) {
        throw ApiError.validation(`${product.name}: enter ${units} IMEI/serial numbers before receiving`);
      }
      for (const serial of item.serials) {
        const existing = await SerialNumberModel.findOne({ serial }).session(session ?? null);
        if (existing && !['CANCELLED', 'RETURNED_TO_VENDOR'].includes(existing.status)) {
          throw ApiError.conflict(`IMEI/serial ${serial} already exists in stock records`, 'DUPLICATE_SERIAL');
        }
        const data = { serial, product: product._id, status: 'IN_STOCK', unitCost: item.landedUnitCost, purchase: p._id, purchaseNo: p.purchaseNo };
        if (existing) {
          existing.set({ ...data, sale: undefined, invoiceNo: undefined, soldAt: undefined });
          await existing.save({ session });
        } else {
          await new SerialNumberModel(data).save({ session });
        }
      }
    }
    await stockIn(product._id, units, item.landedUnitCost, 'PURCHASE', { ...ref, serials: item.serials }, session, { updatePurchaseCost: true });
    item.receivedQty = units;
    if (!product.preferredVendor) await ProductModel.updateOne({ _id: product._id }, { $set: { preferredVendor: p.vendor } }, { session });
  }
  p.balanceDue = p.grandTotal;
  p.paymentStatus = paymentStatus(p.grandTotal, p.balanceDue);
  await p.save({ session });

  await postVendor(
    {
      vendorId: p.vendor,
      date: p.date,
      type: 'PURCHASE',
      refType: 'Purchase',
      refId: p._id,
      refNo: p.purchaseNo,
      credit: p.grandTotal,
      payableDelta: p.grandTotal,
      totals: { totalPurchases: p.grandTotal },
      narration: `Purchase ${p.purchaseNo}${p.vendorInvoiceNo ? ` (vendor inv ${p.vendorInvoiceNo})` : ''}`,
      userId: user.id,
    },
    session,
  );

  const initial = p.initialPayment;
  if (initial?.amount && initial.amount > 0) {
    await createVendorPaymentCore(
      {
        vendorId: String(p.vendor),
        date: p.date,
        amount: initial.amount,
        method: initial.method ?? 'Cash',
        reference: initial.reference ?? undefined,
        allocationMode: 'MANUAL',
        allocations: [{ purchaseId: String(p._id), amount: initial.amount }],
        notes: `Paid with purchase ${p.purchaseNo}`,
      },
      user,
      session,
    );
  }
  await audit(user, 'RECEIVE', 'Purchase', p._id, p.purchaseNo, `Received purchase total ${p.grandTotal}`, undefined, session);
  return PurchaseModel.findById(p._id).session(session ?? null);
}

export async function createPurchase(input: PurchaseInput, user: AuthUser) {
  if (input.clientRequestId) {
    const existing = await PurchaseModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { purchase: existing, duplicate: true };
  }
  try {
    const purchase = await withTransaction(async (session) => {
      const { vendor, data } = await buildPurchaseData(input, session);
      await assertUniqueVendorInvoice(vendor._id, input.vendorInvoiceNo, undefined, session);
      const purchaseNo = await nextNumber('purchase', session);
      const doc = await new PurchaseModel({ ...data, purchaseNo, clientRequestId: input.clientRequestId, status: 'DRAFT', createdBy: user.id }).save({
        session,
      });
      await audit(user, 'CREATE', 'Purchase', doc._id, purchaseNo, `Purchase draft ${data.grandTotal}`, undefined, session);
      if (input.receive) return receiveCore(doc._id, user, session);
      return doc;
    });
    return { purchase: purchase!.toObject(), duplicate: false };
  } catch (err) {
    if (input.clientRequestId && isDuplicateKeyError(err, 'clientRequestId')) {
      const existing = await PurchaseModel.findOne({ clientRequestId: input.clientRequestId }).lean();
      if (existing) return { purchase: existing, duplicate: true };
    }
    throw err;
  }
}

/** Drafts are freely editable. Received purchases must be cancelled (reversed) and re-entered. */
export async function updateDraftPurchase(id: string, input: PurchaseInput, user: AuthUser) {
  return withTransaction(async (session) => {
    const existing = await PurchaseModel.findById(id).session(session ?? null);
    if (!existing) throw ApiError.notFound('Purchase');
    if (existing.status !== 'DRAFT') {
      throw ApiError.conflict('Only draft purchases can be edited. Cancel the received purchase and create a corrected one.', 'NOT_DRAFT');
    }
    const { vendor, data } = await buildPurchaseData(input, session);
    await assertUniqueVendorInvoice(vendor._id, input.vendorInvoiceNo, existing._id, session);
    existing.set(data);
    await existing.save({ session });
    await audit(user, 'UPDATE', 'Purchase', existing._id, existing.purchaseNo, 'Draft updated', undefined, session);
    if (input.receive) return (await receiveCore(existing._id, user, session))!.toObject();
    return existing.toObject();
  });
}

export async function receivePurchase(id: string, user: AuthUser) {
  return withTransaction(async (session) => (await receiveCore(new Types.ObjectId(id), user, session))!.toObject());
}

/**
 * Cancels a purchase with full reversal: stock removed at the landed cost it was received at
 * (weighted average backed out), IMEIs voided, payable reversed and any amount already paid
 * moved to the vendor advance balance (to be applied or refunded later).
 */
export async function cancelPurchase(id: string, reason: string, user: AuthUser) {
  return withTransaction(async (session) => {
    const p = await PurchaseModel.findById(id).session(session ?? null);
    if (!p) throw ApiError.notFound('Purchase');
    if (p.status === 'CANCELLED') throw ApiError.conflict('Purchase is already cancelled', 'ALREADY_CANCELLED');
    const now = new Date();
    if (p.status === 'RECEIVED') {
      if (await PurchaseReturnModel.exists({ purchase: p._id }).session(session ?? null)) {
        throw ApiError.conflict('Purchase has vendor returns and cannot be cancelled. Return the remaining items instead.');
      }
      const ref = { refType: 'Purchase', refId: p._id, refNo: p.purchaseNo, date: now, userId: user.id, notes: `Cancelled: ${reason}` };
      for (const item of p.items) {
        if (item.serials?.length) {
          const res = await SerialNumberModel.updateMany(
            { serial: { $in: item.serials }, purchase: p._id, status: 'IN_STOCK' },
            { $set: { status: 'CANCELLED' } },
            { session },
          );
          if (res.modifiedCount !== item.serials.length) {
            throw ApiError.conflict(`Some IMEI/serials of ${item.name} are already sold; the purchase cannot be cancelled`);
          }
        }
        const units = item.receivedQty || item.qty + (item.freeQty ?? 0);
        await stockOutAtCost(item.product, units, item.landedUnitCost, 'PURCHASE_CANCEL', { ...ref, serials: item.serials }, session);
      }
      const paid = p.amountPaid;
      await postVendor(
        {
          vendorId: p.vendor,
          date: now,
          type: 'PURCHASE_CANCEL',
          refType: 'Purchase',
          refId: p._id,
          refNo: p.purchaseNo,
          debit: p.grandTotal,
          payableDelta: -p.balanceDue,
          advanceDelta: paid,
          totals: { totalPurchases: -p.grandTotal },
          narration: `Purchase ${p.purchaseNo} cancelled: ${reason}${paid > 0 ? `; ${paid} paid moved to vendor advance` : ''}`,
          userId: user.id,
        },
        session,
      );
      p.balanceDue = 0;
    }
    p.status = 'CANCELLED';
    p.cancelledAt = now;
    p.cancelledBy = new Types.ObjectId(user.id);
    p.cancelReason = reason;
    await p.save({ session });
    await audit(user, 'CANCEL', 'Purchase', p._id, p.purchaseNo, reason, undefined, session);
    return p.toObject();
  });
}

/** Creates a new draft copy - used to correct a cancelled / received purchase. */
export async function duplicatePurchase(id: string, user: AuthUser) {
  return withTransaction(async (session) => {
    const p = await PurchaseModel.findById(id).session(session ?? null).lean();
    if (!p) throw ApiError.notFound('Purchase');
    const purchaseNo = await nextNumber('purchase', session);
    const doc = await new PurchaseModel({
      ...p,
      _id: new Types.ObjectId(),
      purchaseNo,
      clientRequestId: undefined,
      status: 'DRAFT',
      returnStatus: 'NONE',
      vendorInvoiceNo: p.status === 'CANCELLED' ? p.vendorInvoiceNo : undefined,
      items: p.items.map((i) => ({ ...i, _id: new Types.ObjectId(), receivedQty: 0, returnedQty: 0, returnedAmount: 0, returnedCost: 0 })),
      amountPaid: 0,
      returnedAmount: 0,
      refundReceived: 0,
      balanceDue: p.grandTotal,
      paymentStatus: 'UNPAID',
      initialPayment: { amount: 0 },
      receivedAt: undefined,
      receivedBy: undefined,
      cancelledAt: undefined,
      cancelledBy: undefined,
      cancelReason: undefined,
      createdBy: user.id,
      createdAt: undefined,
      updatedAt: undefined,
    }).save({ session });
    await audit(user, 'DUPLICATE', 'Purchase', doc._id, purchaseNo, `Copied from ${p.purchaseNo}`, undefined, session);
    return doc.toObject();
  });
}

export async function listPurchases(f: {
  page: number;
  limit: number;
  q?: string;
  vendor?: string;
  status?: string;
  paymentStatus?: string;
  from?: Date;
  to?: Date;
}) {
  const query: Record<string, unknown> = {};
  if (f.vendor) query.vendor = new Types.ObjectId(f.vendor);
  if (f.status) query.status = { $in: f.status.split(',') };
  if (f.paymentStatus) query.paymentStatus = { $in: f.paymentStatus.split(',') };
  if (f.from || f.to) query.date = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q.slice(0, 100)), 'i');
    query.$or = [{ purchaseNo: rx }, { vendorName: rx }, { vendorInvoiceNo: rx }, { 'items.serials': f.q.trim().toUpperCase() }];
  }
  const [items, total] = await Promise.all([
    PurchaseModel.find(query).sort({ date: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    PurchaseModel.countDocuments(query),
  ]);
  return { items, total };
}

export async function getPurchase(id: string) {
  const p = await PurchaseModel.findById(id).populate('createdBy', 'name').lean();
  if (!p) throw ApiError.notFound('Purchase');
  const [payments, returns, vendor] = await Promise.all([
    VendorPaymentModel.find({ 'allocations.purchase': p._id }).sort({ date: 1 }).lean(),
    PurchaseReturnModel.find({ purchase: p._id }).sort({ date: 1 }).lean(),
    VendorModel.findById(p.vendor).lean(),
  ]);
  return { ...p, payments, returns, vendorDetails: vendor, outstanding: sub(p.balanceDue, 0) };
}
