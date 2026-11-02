import { Types } from 'mongoose';
import { PaymentMethodModel, PurchaseModel, PurchaseReturnModel, SaleModel, SalesReturnModel, SerialNumberModel } from '../models';
import type { AuthUser } from '../types';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { add, min, round, sub } from '../utils/money';
import { escapeRegex } from '../utils/pagination';
import { isDuplicateKeyError, withTransaction } from '../utils/transaction';
import { paymentStatus, proportionalValue } from './calc.service';
import { recordRefund } from './customerPayment.service';
import { normaliseSerials, receiveDamaged, stockIn, stockOutAtCost } from './inventory.service';
import { postCustomer, postVendor } from './ledger.service';
import { getSettings, nextNumber } from './settings.service';

export interface SalesReturnInput {
  clientRequestId?: string;
  date?: Date;
  items: Array<{ saleItemId: string; qty: number; restock: boolean; serials?: string[] }>;
  reason: string;
  refundMethod?: string;
  notes?: string;
}

/**
 * Customer return. Value returned = the line's net value (after line + bill discount, incl. tax)
 * pro-rata; the final units of a line take the exact remainder.
 * The value first reduces the invoice's outstanding balance; the rest is refunded.
 * Revenue and inventory cost (COGS) are reversed; damaged items go to damaged stock.
 */
export async function createSalesReturn(saleId: string, input: SalesReturnInput, user: AuthUser) {
  if (input.clientRequestId) {
    const existing = await SalesReturnModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { salesReturn: existing, duplicate: true };
  }
  try {
    const result = await withTransaction(async (session) => {
      const settings = await getSettings();
      const sale = await SaleModel.findById(saleId).session(session ?? null);
      if (!sale) throw ApiError.notFound('Invoice');
      if (sale.status !== 'COMPLETED') throw ApiError.conflict('Cancelled invoices cannot be returned');
      const date = input.date ?? new Date();
      const returnId = new Types.ObjectId();
      const returnNo = await nextNumber('salesReturn', session);
      const ref = { refType: 'SalesReturn', refId: returnId, refNo: returnNo, date, userId: user.id, notes: input.reason };

      const lines = input.items.filter((i) => i.qty > 0);
      if (!lines.length) throw ApiError.validation('Enter a quantity to return');
      if (new Set(lines.map((l) => l.saleItemId)).size !== lines.length) throw ApiError.validation('Each invoice line can appear once');

      const items = [];
      for (const l of lines) {
        const item = sale.items.id(l.saleItemId);
        if (!item) throw ApiError.validation('Return line does not belong to this invoice');
        const eligible = item.qty - (item.returnedQty ?? 0);
        if (l.qty > eligible) {
          throw ApiError.validation(`${item.name}: only ${eligible} unit(s) can still be returned`, { saleItemId: l.saleItemId, eligible });
        }
        const amount = proportionalValue(item.netTotal, item.returnedAmount ?? 0, item.qty, item.returnedQty ?? 0, l.qty);
        const taxable = proportionalValue(item.taxableAmount, item.returnedTaxable ?? 0, item.qty, item.returnedQty ?? 0, l.qty);
        const tax = sub(amount, taxable);
        const cost = proportionalValue(item.costTotal ?? 0, item.returnedCost ?? 0, item.qty, item.returnedQty ?? 0, l.qty);
        const unitCostReturned = l.qty ? Number((cost / l.qty).toFixed(4)) : 0;

        let serials: string[] = [];
        if (item.itemType === 'PRODUCT' && item.product) {
          if (item.serials?.length) {
            serials = normaliseSerials(l.serials);
            if (serials.length !== l.qty) throw ApiError.validation(`${item.name}: select the ${l.qty} IMEI/serial number(s) being returned`);
            const res = await SerialNumberModel.updateMany(
              { serial: { $in: serials }, sale: sale._id, status: 'SOLD' },
              { $set: { status: l.restock ? 'IN_STOCK' : 'DAMAGED' }, $unset: { sale: 1, invoiceNo: 1, soldAt: 1 } },
              { session },
            );
            if (res.modifiedCount !== serials.length) throw ApiError.validation(`${item.name}: IMEI/serial not sold on this invoice or already returned`);
          }
          if (l.restock) {
            await stockIn(item.product, l.qty, unitCostReturned, 'SALE_RETURN', { ...ref, serials }, session);
          } else {
            await receiveDamaged(item.product, l.qty, unitCostReturned, { ...ref, serials }, session);
          }
        }
        // Spare consumed inside a service line is not returned to stock (it was used up).

        item.returnedQty = (item.returnedQty ?? 0) + l.qty;
        item.returnedAmount = add(item.returnedAmount ?? 0, amount);
        item.returnedTaxable = add(item.returnedTaxable ?? 0, taxable);
        item.returnedTax = add(item.returnedTax ?? 0, tax);
        item.returnedCost = add(item.returnedCost ?? 0, cost);

        items.push({
          saleItemId: item._id,
          product: item.product,
          name: item.name,
          itemType: item.itemType,
          revenueType: item.revenueType,
          isRepairPart: item.isRepairPart,
          qty: l.qty,
          taxableAmount: taxable,
          taxAmount: tax,
          amount,
          unitCost: unitCostReturned,
          costTotal: cost,
          restock: item.itemType === 'PRODUCT' ? l.restock : false,
          serials,
        });
      }

      const total = add(...items.map((i) => i.amount));
      const adjusted = min(total, sale.balanceDue);
      const refund = sub(total, adjusted);

      sale.returnedAmount = add(sale.returnedAmount ?? 0, total);
      sale.balanceDue = sub(sale.balanceDue, adjusted);
      sale.refundedAmount = add(sale.refundedAmount ?? 0, refund);
      sale.paymentStatus = paymentStatus(sub(sale.grandTotal, sale.returnedAmount), sale.balanceDue);
      sale.returnStatus = sale.items.every((i) => (i.returnedQty ?? 0) >= i.qty) ? 'FULL' : 'PARTIAL';
      await sale.save({ session });

      await postCustomer(
        {
          customerId: sale.customer,
          date,
          type: 'SALE_RETURN',
          refType: 'SalesReturn',
          refId: returnId,
          refNo: returnNo,
          credit: total,
          narration: `Return against ${sale.invoiceNo}: ${input.reason}`,
          userId: user.id,
          totals: { totalSales: -total },
        },
        session,
      );

      let refundPayment;
      if (refund > 0) {
        refundPayment = await recordRefund(
          {
            customerId: sale.customer,
            customerName: sale.customerName,
            date,
            amount: refund,
            method: input.refundMethod || settings.billing?.defaultPaymentMethod || 'Cash',
            source: 'SALE_RETURN',
            refId: returnId,
            refNo: returnNo,
          },
          user,
          session,
        );
      }

      const doc = await new SalesReturnModel({
        _id: returnId,
        returnNo,
        clientRequestId: input.clientRequestId,
        date,
        sale: sale._id,
        invoiceNo: sale.invoiceNo,
        customer: sale.customer,
        customerName: sale.customerName,
        items,
        reason: input.reason,
        totalAmount: total,
        adjustedAgainstDue: adjusted,
        refundAmount: refund,
        refundMethod: refund > 0 ? refundPayment?.methods?.[0]?.method : undefined,
        refundPayment: refundPayment?._id,
        notes: input.notes,
        createdBy: user.id,
      }).save({ session });
      await audit(user, 'CREATE', 'SalesReturn', doc._id, returnNo, `Return ${total} on ${sale.invoiceNo}`, { adjusted, refund }, session);
      return doc.toObject();
    });
    return { salesReturn: result, duplicate: false };
  } catch (err) {
    if (input.clientRequestId && isDuplicateKeyError(err, 'clientRequestId')) {
      const existing = await SalesReturnModel.findOne({ clientRequestId: input.clientRequestId }).lean();
      if (existing) return { salesReturn: existing, duplicate: true };
    }
    throw err;
  }
}

export interface PurchaseReturnInput {
  clientRequestId?: string;
  date?: Date;
  items: Array<{ purchaseItemId: string; qty: number; serials?: string[] }>;
  reason: string;
  settlement: 'REFUND' | 'CREDIT_NOTE';
  refundMethod?: string;
  notes?: string;
}

/**
 * Vendor return. Credit value = billed value (line after discount + tax) pro-rata over all received units.
 * Stock is removed at its landed cost (weighted average backed out). The credit first reduces the
 * purchase's balance; any remainder is refunded in cash or kept as a vendor credit note (advance).
 */
export async function createPurchaseReturn(purchaseId: string, input: PurchaseReturnInput, user: AuthUser) {
  if (input.clientRequestId) {
    const existing = await PurchaseReturnModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { purchaseReturn: existing, duplicate: true };
  }
  try {
    const result = await withTransaction(async (session) => {
      const settings = await getSettings();
      const taxInCost = settings.tax?.purchaseTaxInCost ?? true;
      const p = await PurchaseModel.findById(purchaseId).session(session ?? null);
      if (!p) throw ApiError.notFound('Purchase');
      if (p.status !== 'RECEIVED') throw ApiError.conflict('Only received purchases can be returned');
      const date = input.date ?? new Date();
      const returnId = new Types.ObjectId();
      const returnNo = await nextNumber('purchaseReturn', session);
      const ref = { refType: 'PurchaseReturn', refId: returnId, refNo: returnNo, date, userId: user.id, notes: input.reason };

      const lines = input.items.filter((i) => i.qty > 0);
      if (!lines.length) throw ApiError.validation('Enter a quantity to return');
      if (new Set(lines.map((l) => l.purchaseItemId)).size !== lines.length) throw ApiError.validation('Each purchase line can appear once');

      const items = [];
      let costVariance = 0;
      for (const l of lines) {
        const item = p.items.id(l.purchaseItemId);
        if (!item) throw ApiError.validation('Return line does not belong to this purchase');
        const units = item.receivedQty || item.qty + (item.freeQty ?? 0);
        const eligible = units - (item.returnedQty ?? 0);
        if (l.qty > eligible) throw ApiError.validation(`${item.name}: only ${eligible} unit(s) can still be returned`);
        const lineValue = add(item.lineTotal, item.taxAmount ?? 0);
        const amount = proportionalValue(lineValue, item.returnedAmount ?? 0, units, item.returnedQty ?? 0, l.qty);
        const landedTotal = round(item.landedUnitCost * units);
        const cost = proportionalValue(landedTotal, item.returnedCost ?? 0, units, item.returnedQty ?? 0, l.qty);

        let serials: string[] = [];
        if (item.serials?.length) {
          serials = normaliseSerials(l.serials);
          if (serials.length !== l.qty) throw ApiError.validation(`${item.name}: select the ${l.qty} IMEI/serial number(s) being returned`);
          const res = await SerialNumberModel.updateMany(
            { serial: { $in: serials }, purchase: p._id, status: 'IN_STOCK' },
            { $set: { status: 'RETURNED_TO_VENDOR' } },
            { session },
          );
          if (res.modifiedCount !== serials.length) throw ApiError.validation(`${item.name}: IMEI/serial not in stock from this purchase`);
        }
        await stockOutAtCost(item.product, l.qty, item.landedUnitCost, 'PURCHASE_RETURN', { ...ref, serials }, session);

        // Loss (+) / gain (-) when the inventory cost removed differs from what the vendor credits
        // (e.g. freight allocated into landed cost is not refunded). Recoverable tax is excluded.
        const creditBase = taxInCost ? amount : sub(amount, proportionalValue(item.taxAmount ?? 0, 0, units, 0, l.qty));
        costVariance = add(costVariance, sub(cost, creditBase));

        item.returnedQty = (item.returnedQty ?? 0) + l.qty;
        item.returnedAmount = add(item.returnedAmount ?? 0, amount);
        item.returnedCost = add(item.returnedCost ?? 0, cost);
        items.push({ purchaseItemId: item._id, product: item.product, name: item.name, qty: l.qty, amount, landedUnitCost: item.landedUnitCost, costTotal: cost, serials });
      }

      const total = add(...items.map((i) => i.amount));
      const adjusted = min(total, p.balanceDue);
      const remainder = sub(total, adjusted);
      if (remainder > 0 && input.settlement === 'REFUND' && !input.refundMethod) {
        throw ApiError.validation('Select how the vendor refund was received');
      }
      let refundMethod: string | undefined;
      if (remainder > 0 && input.settlement === 'REFUND') {
        const pm = await PaymentMethodModel.findOne({ name: input.refundMethod, isActive: true }).collation({ locale: 'en', strength: 2 }).session(session ?? null).lean();
        if (!pm) throw ApiError.validation(`Unknown payment method: ${input.refundMethod}`);
        refundMethod = pm.name;
      }

      p.returnedAmount = add(p.returnedAmount ?? 0, total);
      p.balanceDue = sub(p.balanceDue, adjusted);
      if (input.settlement === 'REFUND') p.refundReceived = add(p.refundReceived ?? 0, remainder);
      p.paymentStatus = paymentStatus(sub(p.grandTotal, p.returnedAmount), p.balanceDue);
      p.returnStatus = p.items.every((i) => (i.returnedQty ?? 0) >= (i.receivedQty || i.qty + (i.freeQty ?? 0))) ? 'FULL' : 'PARTIAL';
      await p.save({ session });

      await postVendor(
        {
          vendorId: p.vendor,
          date,
          type: 'PURCHASE_RETURN',
          refType: 'PurchaseReturn',
          refId: returnId,
          refNo: returnNo,
          debit: total,
          payableDelta: -adjusted,
          advanceDelta: input.settlement === 'CREDIT_NOTE' ? remainder : 0,
          totals: { totalPurchases: -total },
          narration: `Return against ${p.purchaseNo}: ${input.reason}`,
          userId: user.id,
        },
        session,
      );
      if (remainder > 0 && input.settlement === 'REFUND') {
        await postVendor(
          {
            vendorId: p.vendor,
            date,
            type: 'REFUND_RECEIVED',
            refType: 'PurchaseReturn',
            refId: returnId,
            refNo: returnNo,
            credit: remainder,
            narration: `Refund received for return ${returnNo} (${refundMethod})`,
            userId: user.id,
          },
          session,
        );
      }

      const doc = await new PurchaseReturnModel({
        _id: returnId,
        returnNo,
        clientRequestId: input.clientRequestId,
        date,
        purchase: p._id,
        purchaseNo: p.purchaseNo,
        vendor: p.vendor,
        vendorName: p.vendorName,
        items,
        reason: input.reason,
        totalAmount: total,
        adjustedAgainstDue: adjusted,
        settlement: input.settlement,
        refundAmount: input.settlement === 'REFUND' ? remainder : 0,
        refundMethod,
        creditNoteAmount: input.settlement === 'CREDIT_NOTE' ? remainder : 0,
        costVariance,
        notes: input.notes,
        createdBy: user.id,
      }).save({ session });
      await audit(user, 'CREATE', 'PurchaseReturn', doc._id, returnNo, `Vendor return ${total} on ${p.purchaseNo}`, { adjusted, remainder }, session);
      return doc.toObject();
    });
    return { purchaseReturn: result, duplicate: false };
  } catch (err) {
    if (input.clientRequestId && isDuplicateKeyError(err, 'clientRequestId')) {
      const existing = await PurchaseReturnModel.findOne({ clientRequestId: input.clientRequestId }).lean();
      if (existing) return { purchaseReturn: existing, duplicate: true };
    }
    throw err;
  }
}

export async function listReturns(kind: 'sales' | 'purchases', f: { page: number; limit: number; q?: string; from?: Date; to?: Date }) {
  const query: Record<string, unknown> = {};
  if (f.from || f.to) query.date = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q.slice(0, 100)), 'i');
    query.$or = kind === 'sales' ? [{ returnNo: rx }, { invoiceNo: rx }, { customerName: rx }] : [{ returnNo: rx }, { purchaseNo: rx }, { vendorName: rx }];
  }
  const model = (kind === 'sales' ? SalesReturnModel : PurchaseReturnModel) as typeof SalesReturnModel;
  const [items, total] = await Promise.all([
    model.find(query).sort({ date: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    model.countDocuments(query),
  ]);
  return { items, total };
}
