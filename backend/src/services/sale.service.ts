import { Types } from 'mongoose';
import {
  BrandModel,
  CustomerModel,
  CustomerPaymentModel,
  DeviceCategoryModel,
  DeviceModelModel,
  ProductModel,
  SaleModel,
  SalesReturnModel,
  SerialNumberModel,
  VendorModel,
} from '../models';
import { can, type AuthUser } from '../types';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { add, gt, min, percentOf, round, sub } from '../utils/money';
import { escapeRegex } from '../utils/pagination';
import { isDuplicateKeyError, withTransaction, type Session } from '../utils/transaction';
import { calculateSale, paymentStatus } from './calc.service';
import { isCashMethod, normaliseMethods, recordRefund, type MethodSplit } from './customerPayment.service';
import { normaliseSerials, sellSerials, stockIn, stockOut } from './inventory.service';
import { postCustomer } from './ledger.service';
import { getSettings, nextNumber } from './settings.service';

export interface SaleItemInput {
  itemType: 'PRODUCT' | 'SERVICE';
  productId?: string;
  name?: string;
  description?: string;
  qty: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
  serials?: string[];
  device?: { deviceCategoryId?: string; brandId?: string; deviceModelId?: string; imei?: string };
  complaint?: string;
  sparePart?: { productId: string; qty: number; dealerId?: string };
  warranty?: { status: 'NONE' | 'IN_WARRANTY' | 'OUT_OF_WARRANTY' | 'NEW_WARRANTY'; startDate?: Date; expiryDate?: Date };
  /** Internal use (repair completion) */
  internal?: { revenueType: 'PRODUCT' | 'SPARE_PART' | 'LABOR'; isRepairPart?: boolean };
}

export interface CreateSaleInput {
  clientRequestId?: string;
  date?: Date;
  customerId?: string;
  items: SaleItemInput[];
  billDiscount?: number;
  payments?: MethodSplit[];
  dueDate?: Date;
  notes?: string;
  allowStockOverride?: boolean;
}

interface CoreOptions {
  repairJobId?: Types.ObjectId;
  /** Advance receipts (unallocated) to apply to this invoice first. */
  advanceIds?: Types.ObjectId[];
  skipDiscountCheck?: boolean;
}

function addMonths(d: Date, months: number) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

async function resolveDevice(device: SaleItemInput['device'], session: Session) {
  if (!device) return undefined;
  const [cat, brand, model] = await Promise.all([
    device.deviceCategoryId ? DeviceCategoryModel.findById(device.deviceCategoryId).session(session ?? null).lean() : null,
    device.brandId ? BrandModel.findById(device.brandId).session(session ?? null).lean() : null,
    device.deviceModelId ? DeviceModelModel.findById(device.deviceModelId).session(session ?? null).lean() : null,
  ]);
  return {
    deviceCategory: cat?._id,
    deviceCategoryName: cat?.name,
    brand: brand?._id,
    brandName: brand?.name,
    deviceModel: model?._id,
    deviceModelName: model?.name,
    imei: device.imei?.trim() || undefined,
  };
}

/**
 * Creates an invoice and all of its effects. Must be called inside a transaction:
 *  - stock deduction (+ IMEI status) with movement records, at weighted-average cost
 *  - spare consumption on service lines
 *  - payment receipt allocated to the invoice (change due for cash overpayment)
 *  - customer ledger: invoice debit, payment credit
 */
export async function createSaleCore(input: CreateSaleInput, user: AuthUser, session: Session, opts: CoreOptions = {}) {
  const settings = await getSettings();
  const date = input.date ?? new Date();
  if (!input.items?.length) throw ApiError.validation('Add at least one item to the bill');

  // ---- customer ----
  let customerId = input.customerId;
  if (!customerId) {
    if (!settings.billing?.walkInEnabled || !settings.billing?.walkInCustomer) {
      throw ApiError.validation('Select a customer for this bill');
    }
    customerId = String(settings.billing.walkInCustomer);
  }
  const customer = await CustomerModel.findById(customerId).session(session ?? null);
  if (!customer || !customer.isActive) throw ApiError.validation('Selected customer was not found or is inactive');

  // ---- products ----
  const productIds = new Set<string>();
  for (const it of input.items) {
    if (it.productId) productIds.add(it.productId);
    if (it.sparePart?.productId) productIds.add(it.sparePart.productId);
  }
  const products = await ProductModel.find({ _id: { $in: [...productIds] } })
    .populate<{ category: { name: string } | null }>('category', 'name')
    .session(session ?? null)
    .lean();
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  const taxEnabled = Boolean(settings.tax?.enabled);
  const defaultTax = settings.tax?.defaultRate ?? 0;

  const prepared = input.items.map((it, idx) => {
    if (!(it.qty > 0)) throw ApiError.validation(`Line ${idx + 1}: quantity must be greater than zero`);
    if (it.unitPrice < 0) throw ApiError.validation(`Line ${idx + 1}: price cannot be negative`);
    const product = it.productId ? productMap.get(it.productId) : undefined;
    if (it.productId && !product) throw ApiError.validation(`Line ${idx + 1}: product not found`);
    if (product && !product.isActive) throw ApiError.validation(`${product.name} is inactive`);
    if (it.itemType === 'PRODUCT' && !product) throw ApiError.validation(`Line ${idx + 1}: select a product`);
    if (!product && !(it.name && it.name.trim())) throw ApiError.validation(`Line ${idx + 1}: enter a description`);
    if (!product && !can(user.role, 'sales.manualItem')) throw ApiError.forbidden('You are not allowed to add manual service items');
    const isService = it.itemType === 'SERVICE' || product?.productType === 'SERVICE' || product?.trackInventory === false;
    if (isService && it.serials?.length) throw ApiError.validation('Service lines cannot carry IMEI/serial numbers');
    const revenueType = it.internal?.revenueType ?? (isService ? 'LABOR' : 'PRODUCT');
    const taxRate = it.taxRate ?? product?.taxRate ?? defaultTax;
    return { input: it, product, isService, revenueType, taxRate };
  });

  const totals = calculateSale(
    prepared.map((p) => ({ qty: p.input.qty, unitPrice: p.input.unitPrice, discount: p.input.discount, taxRate: p.taxRate })),
    input.billDiscount ?? 0,
    taxEnabled,
  );

  // ---- discount authorisation ----
  if (!opts.skipDiscountCheck && !can(user.role, 'sales.unlimitedDiscount')) {
    const maxPct = settings.billing?.maxCashierDiscountPercent ?? 0;
    totals.lines.forEach((l, i) => {
      if (gt(prepared[i].input.discount ?? 0, percentOf(l.gross, maxPct))) {
        throw ApiError.forbidden(`Discount on line ${i + 1} exceeds your limit of ${maxPct}%`);
      }
    });
    const afterItems = sub(totals.subtotal, totals.itemDiscount);
    if (gt(totals.billDiscount, percentOf(afterItems, maxPct))) {
      throw ApiError.forbidden(`Bill discount exceeds your limit of ${maxPct}%`);
    }
  }

  const allowNegative = Boolean(input.allowStockOverride && settings.billing?.allowStockOverride && can(user.role, 'sales.stockOverride'));

  const saleId = new Types.ObjectId();
  const invoiceNo = await nextNumber('invoice', session);
  const ref = { refType: 'Sale', refId: saleId, refNo: invoiceNo, date, userId: user.id };

  // ---- build lines + stock effects ----
  const items = [];
  for (let i = 0; i < prepared.length; i++) {
    const { input: it, product, isService, revenueType, taxRate } = prepared[i];
    const calc = totals.lines[i];
    let unitCost = 0;
    let costTotal = 0;
    let serials: string[] = [];

    if (product && !isService) {
      serials = normaliseSerials(it.serials);
      if (product.trackSerial) {
        await sellSerials(product._id, product.name, serials, it.qty, { id: saleId, invoiceNo, date }, session);
      } else if (serials.length) {
        throw ApiError.validation(`${product.name} does not track IMEI/serial numbers`);
      }
      const out = await stockOut(
        product._id,
        it.qty,
        it.internal?.isRepairPart ? 'REPAIR_CONSUMPTION' : 'SALE',
        { ...ref, serials },
        session,
        { allowNegative },
      );
      unitCost = out.unitCost;
      costTotal = out.costTotal;
    }

    let sparePart;
    if (it.sparePart?.productId && it.sparePart.qty > 0) {
      const spare = productMap.get(it.sparePart.productId);
      if (!spare) throw ApiError.validation('Spare part not found');
      if (spare.trackSerial) throw ApiError.validation(`${spare.name} is serial-tracked; bill it as a separate product line`);
      const out = await stockOut(spare._id, it.sparePart.qty, 'REPAIR_CONSUMPTION', { ...ref, notes: `Used in service: ${it.name ?? product?.name ?? ''}` }, session, {
        allowNegative,
      });
      const dealer = it.sparePart.dealerId ? await VendorModel.findById(it.sparePart.dealerId).session(session ?? null).lean() : null;
      sparePart = {
        product: spare._id,
        name: spare.name,
        qty: it.sparePart.qty,
        unitCost: out.unitCost,
        costTotal: out.costTotal,
        dealer: dealer?._id,
        dealerName: dealer?.name,
      };
      costTotal = add(costTotal, out.costTotal);
    }

    let warranty = it.warranty;
    if ((!warranty || warranty.status === 'NONE') && product?.warrantyMonths) {
      warranty = { status: 'NEW_WARRANTY', startDate: date, expiryDate: addMonths(date, product.warrantyMonths) };
    }

    items.push({
      itemType: isService ? 'SERVICE' : 'PRODUCT',
      product: product?._id,
      name: (it.name?.trim() || product?.name) as string,
      category: product?.category?.name ?? (isService ? 'Service' : undefined),
      description: it.description,
      revenueType,
      isRepairPart: Boolean(it.internal?.isRepairPart),
      qty: it.qty,
      unitPrice: round(it.unitPrice),
      discount: round(it.discount ?? 0),
      lineTotal: calc.lineTotal,
      billDiscountShare: calc.billDiscountShare,
      taxRate: taxEnabled ? taxRate : 0,
      taxableAmount: calc.taxableAmount,
      taxAmount: calc.taxAmount,
      netTotal: calc.netTotal,
      unitCost,
      costTotal,
      serials,
      device: await resolveDevice(it.device, session),
      complaint: it.complaint,
      sparePart,
      warranty,
    });
  }

  const grandTotal = totals.grandTotal;

  // ---- advances (repair) ----
  let advanceApplied = 0;
  const advanceAllocations: Array<{ paymentId: Types.ObjectId; amount: number }> = [];
  if (opts.advanceIds?.length) {
    const advances = await CustomerPaymentModel.find({ _id: { $in: opts.advanceIds }, status: 'ACTIVE', unallocated: { $gt: 0 } })
      .sort({ date: 1 })
      .session(session ?? null);
    for (const adv of advances) {
      const remaining = sub(grandTotal, advanceApplied);
      if (remaining <= 0) break;
      const take = min(adv.unallocated, remaining);
      adv.unallocated = sub(adv.unallocated, take);
      adv.allocations.push({ sale: saleId, invoiceNo, amount: take });
      await adv.save({ session });
      advanceAllocations.push({ paymentId: adv._id, amount: take });
      advanceApplied = add(advanceApplied, take);
    }
  }

  // ---- tendered payments ----
  const methods = await normaliseMethods(input.payments ?? [], session);
  const tendered = add(...methods.map((m) => m.amount));
  const due = sub(grandTotal, advanceApplied);
  let changeDue = 0;
  if (gt(tendered, due)) {
    changeDue = sub(tendered, due);
    // Change can only be given from cash
    let toReduce = changeDue;
    for (let i = methods.length - 1; i >= 0 && toReduce > 0; i--) {
      if (!(await isCashMethod(methods[i].method, session))) continue;
      const take = min(methods[i].amount, toReduce);
      methods[i].amount = sub(methods[i].amount, take);
      toReduce = sub(toReduce, take);
    }
    if (toReduce > 0) throw ApiError.validation('Card/UPI/bank payments cannot exceed the amount due');
  }
  const applied = add(...methods.map((m) => m.amount));
  const appliedMethods = methods.filter((m) => m.amount > 0);
  const amountPaid = add(applied, advanceApplied);
  const balanceDue = sub(grandTotal, amountPaid);

  if (balanceDue > 0 && customer.isWalkIn) {
    throw ApiError.validation('Credit / partial payment requires a registered customer. Select or add the customer.');
  }

  const creditDueDays = settings.billing?.creditDueDays ?? 0;
  const sale = await new SaleModel({
    _id: saleId,
    invoiceNo,
    clientRequestId: input.clientRequestId,
    date,
    customer: customer._id,
    customerName: customer.name,
    customerMobile: customer.mobile,
    items,
    subtotal: totals.subtotal,
    itemDiscount: totals.itemDiscount,
    billDiscount: totals.billDiscount,
    taxableAmount: totals.taxableAmount,
    taxAmount: totals.taxAmount,
    grandTotal,
    costTotal: add(...items.map((i) => i.costTotal)),
    amountPaid,
    balanceDue,
    changeDue,
    tendered: methods.map((m) => ({ method: m.method, amount: m.amount, reference: m.reference })).filter((m) => m.amount > 0),
    paymentStatus: paymentStatus(grandTotal, balanceDue),
    dueDate: balanceDue > 0 ? input.dueDate ?? new Date(date.getTime() + creditDueDays * 86400000) : undefined,
    repairJob: opts.repairJobId,
    notes: input.notes,
    createdBy: user.id,
  }).save({ session });

  // ---- ledger ----
  await postCustomer(
    {
      customerId: customer._id,
      date,
      type: 'SALE',
      refType: 'Sale',
      refId: sale._id,
      refNo: invoiceNo,
      debit: grandTotal,
      narration: `Invoice ${invoiceNo}${advanceApplied > 0 ? ` (advance applied ${advanceApplied})` : ''}`,
      userId: user.id,
      totals: { totalSales: grandTotal },
      lastPurchaseAt: date,
    },
    session,
  );

  if (applied > 0) {
    const receiptNo = await nextNumber('receipt', session);
    const receipt = await new CustomerPaymentModel({
      receiptNo,
      type: 'RECEIPT',
      customer: customer._id,
      customerName: customer.name,
      date,
      amount: applied,
      methods: appliedMethods,
      allocations: [{ sale: sale._id, invoiceNo, amount: applied }],
      source: 'SALE',
      refId: sale._id,
      repairJob: opts.repairJobId,
      createdBy: user.id,
    }).save({ session });
    await postCustomer(
      {
        customerId: customer._id,
        date,
        type: 'PAYMENT',
        refType: 'CustomerPayment',
        refId: receipt._id,
        refNo: receiptNo,
        credit: applied,
        narration: `Payment for ${invoiceNo} (${appliedMethods.map((m) => m.method).join(' + ')})`,
        userId: user.id,
        totals: { totalPaid: applied },
      },
      session,
    );
  }

  await audit(user, 'CREATE', 'Sale', sale._id, invoiceNo, `Invoice ${invoiceNo} total ${grandTotal}`, { balanceDue }, session);
  return sale;
}

/** Public entry point with idempotency (clientRequestId) and a transaction. */
export async function createSale(input: CreateSaleInput, user: AuthUser) {
  if (input.clientRequestId) {
    const existing = await SaleModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { sale: existing, duplicate: true };
  }
  try {
    const sale = await withTransaction((session) => createSaleCore(input, user, session));
    return { sale: sale.toObject(), duplicate: false };
  } catch (err) {
    if (input.clientRequestId && isDuplicateKeyError(err, 'clientRequestId')) {
      const existing = await SaleModel.findOne({ clientRequestId: input.clientRequestId }).lean();
      if (existing) return { sale: existing, duplicate: true };
    }
    throw err;
  }
}

/**
 * Cancels an invoice by posting reversals (never deletes):
 * stock returned at the recorded cost, IMEIs back in stock, invoice reversed on the ledger
 * and everything the customer paid refunded.
 */
export async function cancelSale(id: string, input: { reason: string; refundMethod?: string }, user: AuthUser) {
  return withTransaction(async (session) => {
    const sale = await SaleModel.findOne({ _id: id }).session(session ?? null);
    if (!sale) throw ApiError.notFound('Invoice');
    if (sale.status === 'CANCELLED') throw ApiError.conflict('Invoice is already cancelled', 'ALREADY_CANCELLED');
    if (sale.repairJob) throw ApiError.conflict('Repair invoices cannot be cancelled. Use a sales return instead.');
    const hasReturns = await SalesReturnModel.exists({ sale: sale._id }).session(session ?? null);
    if (hasReturns) throw ApiError.conflict('Invoice has returns and cannot be cancelled. Return the remaining items instead.');

    const settings = await getSettings();
    const date = new Date();
    const ref = { refType: 'Sale', refId: sale._id, refNo: sale.invoiceNo, date, userId: user.id, notes: `Cancelled: ${input.reason}` };

    for (const item of sale.items) {
      if (item.itemType === 'PRODUCT' && item.product) {
        await stockIn(item.product, item.qty, item.unitCost ?? 0, 'SALE_CANCEL', { ...ref, serials: item.serials }, session);
        if (item.serials?.length) {
          await SerialNumberModel.updateMany(
            { serial: { $in: item.serials }, sale: sale._id },
            { $set: { status: 'IN_STOCK' }, $unset: { sale: 1, invoiceNo: 1, soldAt: 1 } },
            { session },
          );
        }
      }
      if (item.sparePart?.product && item.sparePart.qty) {
        await stockIn(item.sparePart.product, item.sparePart.qty, item.sparePart.unitCost ?? 0, 'SALE_CANCEL', ref, session);
      }
    }

    await postCustomer(
      {
        customerId: sale.customer,
        date,
        type: 'SALE_CANCEL',
        refType: 'Sale',
        refId: sale._id,
        refNo: sale.invoiceNo,
        credit: sale.grandTotal,
        narration: `Invoice ${sale.invoiceNo} cancelled: ${input.reason}`,
        userId: user.id,
        totals: { totalSales: -sale.grandTotal },
      },
      session,
    );

    const toRefund = sub(sale.amountPaid, sale.refundedAmount ?? 0);
    if (toRefund > 0) {
      await recordRefund(
        {
          customerId: sale.customer,
          customerName: sale.customerName,
          date,
          amount: toRefund,
          method: input.refundMethod || settings.billing?.defaultPaymentMethod || 'Cash',
          source: 'SALE_CANCEL',
          refId: sale._id,
          refNo: sale.invoiceNo,
        },
        user,
        session,
      );
    }

    sale.status = 'CANCELLED';
    sale.refundedAmount = add(sale.refundedAmount ?? 0, toRefund);
    sale.balanceDue = 0;
    sale.cancelledAt = date;
    sale.cancelledBy = new Types.ObjectId(user.id);
    sale.cancelReason = input.reason;
    await sale.save({ session });
    await audit(user, 'CANCEL', 'Sale', sale._id, sale.invoiceNo, input.reason, { refunded: toRefund }, session);
    return sale.toObject();
  });
}

export interface SaleListFilter {
  page: number;
  limit: number;
  q?: string;
  customer?: string;
  status?: string;
  paymentStatus?: string;
  from?: Date;
  to?: Date;
  repairOnly?: boolean;
}

export async function listSales(f: SaleListFilter) {
  const query: Record<string, unknown> = {};
  if (f.customer) query.customer = new Types.ObjectId(f.customer);
  if (f.status) query.status = f.status;
  if (f.paymentStatus) query.paymentStatus = { $in: f.paymentStatus.split(',') };
  if (f.from || f.to) query.date = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q.slice(0, 100)), 'i');
    query.$or = [{ invoiceNo: rx }, { customerName: rx }, { customerMobile: rx }, { 'items.serials': f.q.trim().toUpperCase() }];
  }
  const [items, total] = await Promise.all([
    SaleModel.find(query)
      .select('-items.device -items.sparePart')
      .sort({ date: -1, _id: -1 })
      .skip((f.page - 1) * f.limit)
      .limit(f.limit)
      .lean(),
    SaleModel.countDocuments(query),
  ]);
  return { items, total };
}

export async function getSale(id: string) {
  const sale = await SaleModel.findById(id).populate('createdBy', 'name').lean();
  if (!sale) throw ApiError.notFound('Invoice');
  const [payments, returns, customer] = await Promise.all([
    CustomerPaymentModel.find({ $or: [{ 'allocations.sale': sale._id }, { refId: sale._id }] })
      .sort({ date: 1 })
      .lean(),
    SalesReturnModel.find({ sale: sale._id }).sort({ date: 1 }).lean(),
    CustomerModel.findById(sale.customer).lean(),
  ]);
  return { ...sale, payments, returns, customerDetails: customer };
}
