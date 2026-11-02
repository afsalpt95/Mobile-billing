import { Types } from 'mongoose';
import { ExpenseCategoryModel, ExpenseModel, PaymentMethodModel, VendorModel } from '../models';
import type { AuthUser } from '../types';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { add, gt, round, sub } from '../utils/money';
import { escapeRegex } from '../utils/pagination';
import { isDuplicateKeyError, withTransaction, type Session } from '../utils/transaction';
import { paymentStatus } from './calc.service';
import { nextNumber } from './settings.service';

export interface ExpenseInput {
  clientRequestId?: string;
  date?: Date;
  categoryId: string;
  description: string;
  amount: number;
  paidTo?: string;
  vendorId?: string;
  /** Amount paid now (0 = unpaid payable). */
  amountPaid?: number;
  method?: string;
  reference?: string;
  attachmentRef?: string;
  notes?: string;
}

async function methodName(method: string | undefined, session: Session) {
  if (!method) throw ApiError.validation('Select the payment method');
  const pm = await PaymentMethodModel.findOne({ name: method, isActive: true }).collation({ locale: 'en', strength: 2 }).session(session ?? null).lean();
  if (!pm) throw ApiError.validation(`Unknown payment method: ${method}`);
  return pm.name;
}

/**
 * Expenses are reported on the expense date (accrual). Unpaid / partly paid expenses remain
 * outstanding payables and are never treated as cash paid until a payment is recorded.
 */
export async function createExpense(input: ExpenseInput, user: AuthUser) {
  if (input.clientRequestId) {
    const existing = await ExpenseModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { expense: existing, duplicate: true };
  }
  try {
    const expense = await withTransaction(async (session) => {
      const category = await ExpenseCategoryModel.findById(input.categoryId).session(session ?? null).lean();
      if (!category) throw ApiError.validation('Expense category not found');
      const vendor = input.vendorId ? await VendorModel.findById(input.vendorId).session(session ?? null).lean() : null;
      const amount = round(input.amount);
      if (amount <= 0) throw ApiError.validation('Amount must be greater than zero');
      const paid = round(input.amountPaid ?? 0);
      if (paid < 0 || gt(paid, amount)) throw ApiError.validation('Amount paid must be between 0 and the expense amount');
      const date = input.date ?? new Date();
      const payments = paid > 0 ? [{ date, amount: paid, method: await methodName(input.method, session), reference: input.reference, createdBy: user.id }] : [];
      const expenseNo = await nextNumber('expense', session);
      const doc = await new ExpenseModel({
        expenseNo,
        clientRequestId: input.clientRequestId,
        date,
        category: category._id,
        categoryName: category.name,
        description: input.description,
        amount,
        paidTo: input.paidTo || vendor?.name,
        vendor: vendor?._id,
        payments,
        amountPaid: paid,
        balanceDue: sub(amount, paid),
        paymentStatus: paymentStatus(amount, sub(amount, paid)),
        attachmentRef: input.attachmentRef,
        notes: input.notes,
        createdBy: user.id,
        createdByName: user.name,
      }).save({ session });
      await audit(user, 'CREATE', 'Expense', doc._id, expenseNo, `${category.name}: ${amount}`, undefined, session);
      return doc.toObject();
    });
    return { expense, duplicate: false };
  } catch (err) {
    if (input.clientRequestId && isDuplicateKeyError(err, 'clientRequestId')) {
      const existing = await ExpenseModel.findOne({ clientRequestId: input.clientRequestId }).lean();
      if (existing) return { expense: existing, duplicate: true };
    }
    throw err;
  }
}

/** Edits descriptive fields and the amount. Payments are separate records, so editing never re-posts them. */
export async function updateExpense(id: string, input: Partial<Omit<ExpenseInput, 'amountPaid' | 'method' | 'reference'>>, user: AuthUser) {
  return withTransaction(async (session) => {
    const doc = await ExpenseModel.findById(id).session(session ?? null);
    if (!doc) throw ApiError.notFound('Expense');
    if (doc.status === 'CANCELLED') throw ApiError.conflict('Cancelled expenses cannot be edited');
    const before = { amount: doc.amount, date: doc.date, category: doc.categoryName, description: doc.description };
    if (input.categoryId) {
      const c = await ExpenseCategoryModel.findById(input.categoryId).session(session ?? null).lean();
      if (!c) throw ApiError.validation('Expense category not found');
      doc.category = c._id;
      doc.categoryName = c.name;
    }
    if (input.vendorId !== undefined) {
      const v = input.vendorId ? await VendorModel.findById(input.vendorId).session(session ?? null).lean() : null;
      doc.vendor = v?._id;
    }
    if (input.amount !== undefined) {
      const amount = round(input.amount);
      if (amount <= 0) throw ApiError.validation('Amount must be greater than zero');
      if (gt(doc.amountPaid, amount)) throw ApiError.validation(`Amount cannot be less than the ${doc.amountPaid} already paid`);
      doc.amount = amount;
      doc.balanceDue = sub(amount, doc.amountPaid);
      doc.paymentStatus = paymentStatus(amount, doc.balanceDue);
    }
    for (const f of ['date', 'description', 'paidTo', 'attachmentRef', 'notes'] as const) {
      if (input[f] !== undefined) (doc as unknown as Record<string, unknown>)[f] = input[f];
    }
    await doc.save({ session });
    await audit(user, 'UPDATE', 'Expense', doc._id, doc.expenseNo, 'Expense edited', { before, after: { amount: doc.amount, date: doc.date, category: doc.categoryName } }, session);
    return doc.toObject();
  });
}

export async function payExpense(id: string, input: { amount: number; method: string; reference?: string; date?: Date }, user: AuthUser) {
  return withTransaction(async (session) => {
    const doc = await ExpenseModel.findById(id).session(session ?? null);
    if (!doc) throw ApiError.notFound('Expense');
    if (doc.status === 'CANCELLED') throw ApiError.conflict('Expense is cancelled');
    const amount = round(input.amount);
    if (amount <= 0) throw ApiError.validation('Amount must be greater than zero');
    if (gt(amount, doc.balanceDue)) throw ApiError.validation(`Only ${doc.balanceDue} is outstanding on this expense`);
    doc.payments.push({ date: input.date ?? new Date(), amount, method: await methodName(input.method, session), reference: input.reference, createdBy: new Types.ObjectId(user.id) });
    doc.amountPaid = add(doc.amountPaid, amount);
    doc.balanceDue = sub(doc.amount, doc.amountPaid);
    doc.paymentStatus = paymentStatus(doc.amount, doc.balanceDue);
    await doc.save({ session });
    await audit(user, 'PAY', 'Expense', doc._id, doc.expenseNo, `Paid ${amount}`, undefined, session);
    return doc.toObject();
  });
}

export async function cancelExpense(id: string, reason: string, user: AuthUser) {
  return withTransaction(async (session) => {
    const doc = await ExpenseModel.findOneAndUpdate(
      { _id: id, status: 'ACTIVE' },
      { $set: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } },
      { new: true, session },
    );
    if (!doc) throw ApiError.conflict('Expense not found or already cancelled');
    await audit(user, 'CANCEL', 'Expense', doc._id, doc.expenseNo, reason, undefined, session);
    return doc.toObject();
  });
}

export async function listExpenses(f: { page: number; limit: number; q?: string; category?: string; status?: string; paymentStatus?: string; method?: string; from?: Date; to?: Date }) {
  const query: Record<string, unknown> = { status: f.status ?? 'ACTIVE' };
  if (f.status === 'ALL') delete query.status;
  if (f.category) query.category = new Types.ObjectId(f.category);
  if (f.paymentStatus) query.paymentStatus = { $in: f.paymentStatus.split(',') };
  if (f.method) query['payments.method'] = f.method;
  if (f.from || f.to) query.date = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q.slice(0, 100)), 'i');
    query.$or = [{ expenseNo: rx }, { description: rx }, { paidTo: rx }, { categoryName: rx }];
  }
  const [items, total, sums] = await Promise.all([
    ExpenseModel.find(query).sort({ date: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    ExpenseModel.countDocuments(query),
    ExpenseModel.aggregate([{ $match: query }, { $group: { _id: null, amount: { $sum: '$amount' }, paid: { $sum: '$amountPaid' }, due: { $sum: '$balanceDue' } } }]),
  ]);
  return { items, total, summary: { amount: round(sums[0]?.amount ?? 0), paid: round(sums[0]?.paid ?? 0), due: round(sums[0]?.due ?? 0) } };
}
