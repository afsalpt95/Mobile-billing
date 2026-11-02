import { Types } from 'mongoose';
import { CustomerModel, CustomerPaymentModel, PaymentMethodModel, SaleModel } from '../models';
import type { AuthUser } from '../types';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { add, gt, isZero, min, round, sub } from '../utils/money';
import { isDuplicateKeyError, withTransaction, type Session } from '../utils/transaction';
import { paymentStatus } from './calc.service';
import { postCustomer } from './ledger.service';
import { nextNumber } from './settings.service';

export interface MethodSplit {
  method: string;
  amount: number;
  reference?: string;
}

/** Validates payment method names against the PaymentMethod master and normalises amounts. */
export async function normaliseMethods(methods: MethodSplit[], session?: Session): Promise<MethodSplit[]> {
  const clean = methods.map((m) => ({ method: m.method.trim(), amount: round(m.amount), reference: m.reference?.trim() || undefined })).filter((m) => !isZero(m.amount));
  if (clean.some((m) => m.amount < 0)) throw ApiError.validation('Payment amounts cannot be negative');
  if (!clean.length) return [];
  const names = [...new Set(clean.map((m) => m.method))];
  const found = await PaymentMethodModel.find({ name: { $in: names }, isActive: true })
    .collation({ locale: 'en', strength: 2 })
    .session(session ?? null)
    .lean();
  for (const m of clean) {
    const match = found.find((f) => f.name.toLowerCase() === m.method.toLowerCase());
    if (!match) throw ApiError.validation(`Unknown or inactive payment method: ${m.method}`);
    m.method = match.name;
  }
  return clean;
}

export async function isCashMethod(name: string, session?: Session): Promise<boolean> {
  const pm = await PaymentMethodModel.findOne({ name }).collation({ locale: 'en', strength: 2 }).session(session ?? null).lean();
  return (pm as { kind?: string } | null)?.kind === 'CASH';
}

/** Applies an amount to an invoice's outstanding balance. Never allows over-settlement. */
export async function settleSale(saleId: Types.ObjectId | string, amount: number, session: Session) {
  const sale = await SaleModel.findById(saleId).session(session ?? null);
  if (!sale) throw ApiError.notFound('Invoice');
  if (sale.status !== 'COMPLETED') throw ApiError.conflict(`Invoice ${sale.invoiceNo} is cancelled`);
  if (gt(amount, sale.balanceDue)) {
    throw ApiError.validation(`Amount ${amount} exceeds the balance due (${sale.balanceDue}) on ${sale.invoiceNo}`);
  }
  sale.amountPaid = add(sale.amountPaid, amount);
  sale.balanceDue = sub(sale.balanceDue, amount);
  sale.paymentStatus = paymentStatus(sub(sale.grandTotal, sale.returnedAmount), sale.balanceDue);
  await sale.save({ session });
  return sale;
}

/** Reverses a previous settlement (payment cancellation). */
async function unsettleSale(saleId: Types.ObjectId | string, amount: number, session: Session) {
  const sale = await SaleModel.findById(saleId).session(session ?? null);
  if (!sale) throw ApiError.notFound('Invoice');
  if (sale.status !== 'COMPLETED') throw ApiError.conflict(`Invoice ${sale.invoiceNo} is cancelled; its payments were already refunded`);
  sale.amountPaid = sub(sale.amountPaid, amount);
  sale.balanceDue = add(sale.balanceDue, amount);
  sale.paymentStatus = paymentStatus(sub(sale.grandTotal, sale.returnedAmount), sale.balanceDue);
  await sale.save({ session });
}

/** Records a refund paid out to a customer (debit to the customer ledger). */
export async function recordRefund(
  args: {
    customerId: Types.ObjectId;
    customerName: string;
    date: Date;
    amount: number;
    method: string;
    reference?: string;
    source: 'SALE_CANCEL' | 'SALE_RETURN' | 'REPAIR_CANCEL';
    refId: Types.ObjectId;
    refNo: string;
    repairJob?: Types.ObjectId;
    notes?: string;
  },
  user: AuthUser,
  session: Session,
) {
  const amount = round(args.amount);
  if (amount <= 0) return null;
  const [method] = await normaliseMethods([{ method: args.method, amount, reference: args.reference }], session);
  const receiptNo = await nextNumber('receipt', session);
  const refund = await new CustomerPaymentModel({
    receiptNo,
    type: 'REFUND',
    customer: args.customerId,
    customerName: args.customerName,
    date: args.date,
    amount,
    methods: [method],
    source: args.source,
    refId: args.refId,
    repairJob: args.repairJob,
    notes: args.notes,
    createdBy: user.id,
  }).save({ session });
  await postCustomer(
    {
      customerId: args.customerId,
      date: args.date,
      type: 'REFUND',
      refType: 'CustomerPayment',
      refId: refund._id,
      refNo: receiptNo,
      debit: amount,
      narration: `Refund for ${args.refNo}`,
      userId: user.id,
      totals: { totalPaid: -amount },
    },
    session,
  );
  return refund;
}

export interface CreateCustomerPaymentInput {
  clientRequestId?: string;
  customerId: string;
  date?: Date;
  methods: MethodSplit[];
  allocationMode: 'OLDEST_FIRST' | 'MANUAL';
  allocations?: Array<{ saleId: string; amount: number }>;
  notes?: string;
}

/** Customer credit payment ("Pay Customer Credit") allocated to outstanding invoices. */
export async function createCustomerPayment(input: CreateCustomerPaymentInput, user: AuthUser) {
  if (input.clientRequestId) {
    const existing = await CustomerPaymentModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { payment: existing, duplicate: true };
  }
  try {
    const payment = await withTransaction(async (session) => {
      const customer = await CustomerModel.findById(input.customerId).session(session ?? null);
      if (!customer) throw ApiError.notFound('Customer');
      const methods = await normaliseMethods(input.methods, session);
      const amount = add(...methods.map((m) => m.amount));
      if (amount <= 0) throw ApiError.validation('Payment amount must be greater than zero');
      const date = input.date ?? new Date();

      const open = await SaleModel.find({ customer: customer._id, status: 'COMPLETED', balanceDue: { $gt: 0 } })
        .sort({ date: 1, _id: 1 })
        .session(session ?? null);
      const totalDue = add(...open.map((s) => s.balanceDue));
      if (gt(amount, totalDue)) {
        throw ApiError.validation(`Payment (${amount}) exceeds the customer's total outstanding (${totalDue})`);
      }

      let allocations: Array<{ sale: Types.ObjectId; invoiceNo: string; amount: number }> = [];
      if (input.allocationMode === 'MANUAL') {
        const allocs = (input.allocations ?? []).filter((a) => a.amount > 0);
        const allocTotal = add(...allocs.map((a) => a.amount));
        if (round(allocTotal) !== amount) throw ApiError.validation('Allocated amounts must equal the payment amount');
        const seen = new Set<string>();
        for (const a of allocs) {
          if (seen.has(a.saleId)) throw ApiError.validation('Each invoice can be allocated only once');
          seen.add(a.saleId);
          const sale = open.find((s) => String(s._id) === a.saleId);
          if (!sale) throw ApiError.validation('Allocation refers to an invoice that is not outstanding for this customer');
          if (gt(a.amount, sale.balanceDue)) throw ApiError.validation(`Allocation exceeds balance due on ${sale.invoiceNo}`);
          allocations.push({ sale: sale._id, invoiceNo: sale.invoiceNo, amount: round(a.amount) });
        }
      } else {
        let remaining = amount;
        for (const sale of open) {
          if (remaining <= 0) break;
          const take = min(remaining, sale.balanceDue);
          allocations.push({ sale: sale._id, invoiceNo: sale.invoiceNo, amount: take });
          remaining = sub(remaining, take);
        }
      }
      allocations = allocations.filter((a) => a.amount > 0);
      for (const a of allocations) await settleSale(a.sale, a.amount, session);

      const receiptNo = await nextNumber('receipt', session);
      const doc = await new CustomerPaymentModel({
        receiptNo,
        clientRequestId: input.clientRequestId,
        type: 'RECEIPT',
        customer: customer._id,
        customerName: customer.name,
        date,
        amount,
        methods,
        allocations,
        source: 'CREDIT_PAYMENT',
        notes: input.notes,
        createdBy: user.id,
      }).save({ session });

      await postCustomer(
        {
          customerId: customer._id,
          date,
          type: 'PAYMENT',
          refType: 'CustomerPayment',
          refId: doc._id,
          refNo: receiptNo,
          credit: amount,
          narration: `Payment against ${allocations.map((a) => a.invoiceNo).join(', ')}`,
          userId: user.id,
          totals: { totalPaid: amount },
        },
        session,
      );
      await audit(user, 'CREATE', 'CustomerPayment', doc._id, receiptNo, `Customer payment ${amount}`, { allocations }, session);
      return doc.toObject();
    });
    return { payment, duplicate: false };
  } catch (err) {
    if (input.clientRequestId && isDuplicateKeyError(err, 'clientRequestId')) {
      const existing = await CustomerPaymentModel.findOne({ clientRequestId: input.clientRequestId }).lean();
      if (existing) return { payment: existing, duplicate: true };
    }
    throw err;
  }
}

/** Cancels a receipt: reverses its invoice allocations and posts a reversing ledger entry. */
export async function cancelCustomerPayment(id: string, reason: string, user: AuthUser) {
  return withTransaction(async (session) => {
    const payment = await CustomerPaymentModel.findOne({ _id: id, status: 'ACTIVE' }).session(session ?? null);
    if (!payment) throw ApiError.conflict('Payment not found or already cancelled');
    if (payment.type === 'REFUND') throw ApiError.badRequest('Refunds cannot be cancelled; record a new receipt instead');
    if (payment.type === 'ADVANCE') throw ApiError.badRequest('Advances are reversed by cancelling the repair job');
    for (const a of payment.allocations) await unsettleSale(a.sale, a.amount, session);
    payment.status = 'CANCELLED';
    payment.cancelledAt = new Date();
    payment.cancelReason = reason;
    await payment.save({ session });
    await postCustomer(
      {
        customerId: payment.customer,
        date: new Date(),
        type: 'PAYMENT_CANCEL',
        refType: 'CustomerPayment',
        refId: payment._id,
        refNo: payment.receiptNo,
        debit: payment.amount,
        narration: `Cancelled receipt ${payment.receiptNo}: ${reason}`,
        userId: user.id,
        totals: { totalPaid: -payment.amount },
      },
      session,
    );
    await audit(user, 'CANCEL', 'CustomerPayment', payment._id, payment.receiptNo, reason, undefined, session);
    return payment.toObject();
  });
}

export async function listCustomerPayments(filter: {
  customer?: string;
  type?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
  q?: string;
}) {
  const query: Record<string, unknown> = {};
  if (filter.customer) query.customer = new Types.ObjectId(filter.customer);
  if (filter.type) query.type = filter.type;
  if (filter.from || filter.to) query.date = { ...(filter.from ? { $gte: filter.from } : {}), ...(filter.to ? { $lte: filter.to } : {}) };
  if (filter.q) query.$or = [{ receiptNo: new RegExp(filter.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { customerName: new RegExp(filter.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
  const [items, total] = await Promise.all([
    CustomerPaymentModel.find(query).sort({ date: -1, _id: -1 }).skip((filter.page - 1) * filter.limit).limit(filter.limit).lean(),
    CustomerPaymentModel.countDocuments(query),
  ]);
  return { items, total };
}
