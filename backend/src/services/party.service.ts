import { Types } from 'mongoose';
import { CustomerModel, PurchaseModel, SaleModel, VendorModel, RepairJobModel } from '../models';
import type { AuthUser } from '../types';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { round } from '../utils/money';
import { escapeRegex } from '../utils/pagination';

export interface CustomerInput {
  name: string;
  mobile?: string;
  altMobile?: string;
  email?: string;
  address?: string;
  notes?: string;
  isActive?: boolean;
  /** Set after the user confirms the duplicate-mobile warning. */
  allowDuplicate?: boolean;
}

function normaliseMobile(m?: string) {
  return m?.replace(/[\s-]/g, '') || undefined;
}

export async function findCustomersByMobile(mobile: string, excludeId?: string) {
  const m = normaliseMobile(mobile);
  if (!m) return [];
  return CustomerModel.find({ mobile: m, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .select('name mobile balance')
    .limit(5)
    .lean();
}

export async function createCustomer(input: CustomerInput, user: AuthUser) {
  const mobile = normaliseMobile(input.mobile);
  if (!mobile) throw ApiError.validation('Mobile number is required');
  if (!input.allowDuplicate) {
    const dups = await findCustomersByMobile(mobile);
    if (dups.length) {
      throw ApiError.conflict(`A customer with mobile ${mobile} already exists: ${dups.map((d) => d.name).join(', ')}`, 'DUPLICATE_MOBILE', { matches: dups });
    }
  }
  const doc = await CustomerModel.create({
    name: input.name,
    mobile,
    altMobile: normaliseMobile(input.altMobile),
    email: input.email || undefined,
    address: input.address,
    notes: input.notes,
    createdBy: user.id,
  });
  await audit(user, 'CREATE', 'Customer', doc._id, mobile, doc.name);
  return doc.toObject();
}

export async function updateCustomer(id: string, input: Partial<CustomerInput>, user: AuthUser) {
  const doc = await CustomerModel.findById(id);
  if (!doc) throw ApiError.notFound('Customer');
  if (doc.isWalkIn && input.isActive === false) throw ApiError.conflict('The walk-in customer cannot be deactivated');
  if (input.mobile !== undefined) {
    const mobile = normaliseMobile(input.mobile);
    if (!mobile && !doc.isWalkIn) throw ApiError.validation('Mobile number is required');
    if (mobile && mobile !== doc.mobile && !input.allowDuplicate) {
      const dups = await findCustomersByMobile(mobile, id);
      if (dups.length) throw ApiError.conflict(`Mobile ${mobile} is already used by ${dups.map((d) => d.name).join(', ')}`, 'DUPLICATE_MOBILE', { matches: dups });
    }
    doc.mobile = mobile;
  }
  for (const f of ['name', 'email', 'address', 'notes', 'isActive'] as const) if (input[f] !== undefined) doc.set(f, input[f]);
  if (input.altMobile !== undefined) doc.altMobile = normaliseMobile(input.altMobile);
  await doc.save();
  await audit(user, 'UPDATE', 'Customer', doc._id, doc.mobile ?? undefined, doc.name);
  return doc.toObject();
}

export async function listCustomers(f: { page: number; limit: number; q?: string; withBalance?: boolean; active?: string; sort?: string; includeWalkIn?: boolean }) {
  const query: Record<string, unknown> = {};
  if (f.active !== 'all') query.isActive = f.active !== 'false';
  if (!f.includeWalkIn) query.isWalkIn = { $ne: true };
  if (f.withBalance) query.balance = { $gt: 0 };
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q.slice(0, 100)), 'i');
    query.$or = [{ name: rx }, { mobile: rx }, { altMobile: rx }, { email: rx }];
  }
  const sortMap: Record<string, Record<string, 1 | -1>> = {
    name: { name: 1 },
    '-balance': { balance: -1 },
    '-lastPurchase': { lastPurchaseAt: -1 },
    '-totalSales': { totalSales: -1 },
  };
  const sort = sortMap[f.sort ?? 'name'] ?? { name: 1 };
  const [items, total] = await Promise.all([
    CustomerModel.find(query).sort({ isWalkIn: -1, ...sort, _id: 1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    CustomerModel.countDocuments(query),
  ]);
  return { items, total };
}

export async function getCustomer(id: string) {
  const c = await CustomerModel.findById(id).lean();
  if (!c) throw ApiError.notFound('Customer');
  const now = new Date();
  const [open, repairsCount] = await Promise.all([
    SaleModel.aggregate([
      { $match: { customer: c._id, status: 'COMPLETED', balanceDue: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          due: { $sum: '$balanceDue' },
          overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] }, '$balanceDue', 0] } },
        },
      },
    ]),
    RepairJobModel.countDocuments({ customer: c._id }),
  ]);
  return {
    ...c,
    stats: { openInvoices: open[0]?.count ?? 0, outstanding: round(open[0]?.due ?? 0), overdue: round(open[0]?.overdue ?? 0), repairs: repairsCount },
  };
}

/** Customer credit list: customers with balances + overdue amounts. */
export async function customerCreditSummary(q?: string) {
  const match: Record<string, unknown> = { balance: { $ne: 0 } };
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 100)), 'i');
    match.$or = [{ name: rx }, { mobile: rx }];
  }
  const customers = await CustomerModel.find(match).sort({ balance: -1 }).limit(500).lean();
  const now = new Date();
  const agg = await SaleModel.aggregate([
    { $match: { customer: { $in: customers.map((c) => c._id) }, status: 'COMPLETED', balanceDue: { $gt: 0 } } },
    {
      $group: {
        _id: '$customer',
        openInvoices: { $sum: 1 },
        overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] }, '$balanceDue', 0] } },
        oldest: { $min: '$date' },
      },
    },
  ]);
  return customers.map((c) => {
    const a = agg.find((x) => String(x._id) === String(c._id));
    return {
      _id: c._id,
      name: c.name,
      mobile: c.mobile,
      totalSales: c.totalSales,
      totalPaid: c.totalPaid,
      balance: c.balance,
      openInvoices: a?.openInvoices ?? 0,
      overdue: round(a?.overdue ?? 0),
      oldestInvoiceDate: a?.oldest ?? null,
      lastPurchaseAt: c.lastPurchaseAt,
    };
  });
}

export async function openInvoices(customerId: string) {
  return SaleModel.find({ customer: new Types.ObjectId(customerId), status: 'COMPLETED', balanceDue: { $gt: 0 } })
    .select('invoiceNo date dueDate grandTotal amountPaid returnedAmount balanceDue paymentStatus')
    .sort({ date: 1 })
    .lean();
}

/** Items sold / repairs done for the customer that carry a warranty. */
export async function customerWarranties(customerId: string) {
  const id = new Types.ObjectId(customerId);
  const now = new Date();
  const sales = await SaleModel.aggregate([
    { $match: { customer: id, status: 'COMPLETED' } },
    { $unwind: '$items' },
    { $match: { 'items.warranty.expiryDate': { $ne: null } } },
    {
      $project: {
        invoiceNo: 1,
        date: 1,
        saleId: '$_id',
        name: '$items.name',
        serials: '$items.serials',
        status: '$items.warranty.status',
        startDate: '$items.warranty.startDate',
        expiryDate: '$items.warranty.expiryDate',
        returnedQty: '$items.returnedQty',
        qty: '$items.qty',
      },
    },
    { $sort: { expiryDate: -1 } },
  ]);
  return sales.map((s) => ({ ...s, active: s.expiryDate && new Date(s.expiryDate) >= now && s.returnedQty < s.qty }));
}

// ---------------- vendors ----------------

export interface VendorInput {
  name: string;
  contactPerson?: string;
  mobile?: string;
  altMobile?: string;
  email?: string;
  address?: string;
  taxId?: string;
  vendorTypeId?: string | null;
  paymentTermsDays?: number;
  notes?: string;
  isActive?: boolean;
  allowDuplicate?: boolean;
}

export async function createVendor(input: VendorInput, user: AuthUser) {
  const mobile = normaliseMobile(input.mobile);
  if (mobile && !input.allowDuplicate) {
    const dup = await VendorModel.findOne({ mobile }).lean();
    if (dup) throw ApiError.conflict(`Vendor ${dup.name} already uses mobile ${mobile}`, 'DUPLICATE_MOBILE', { matches: [dup] });
  }
  const doc = await VendorModel.create({
    name: input.name,
    contactPerson: input.contactPerson,
    mobile,
    altMobile: normaliseMobile(input.altMobile),
    email: input.email || undefined,
    address: input.address,
    taxId: input.taxId,
    vendorType: input.vendorTypeId || undefined,
    paymentTermsDays: input.paymentTermsDays ?? 0,
    notes: input.notes,
    createdBy: user.id,
  });
  await audit(user, 'CREATE', 'Vendor', doc._id, mobile, doc.name);
  return doc.toObject();
}

export async function updateVendor(id: string, input: Partial<VendorInput>, user: AuthUser) {
  const doc = await VendorModel.findById(id);
  if (!doc) throw ApiError.notFound('Vendor');
  if (input.mobile !== undefined) {
    const mobile = normaliseMobile(input.mobile);
    if (mobile && mobile !== doc.mobile && !input.allowDuplicate) {
      const dup = await VendorModel.findOne({ mobile, _id: { $ne: id } }).lean();
      if (dup) throw ApiError.conflict(`Vendor ${dup.name} already uses mobile ${mobile}`, 'DUPLICATE_MOBILE');
    }
    doc.mobile = mobile;
  }
  for (const f of ['name', 'contactPerson', 'email', 'address', 'taxId', 'paymentTermsDays', 'notes', 'isActive'] as const) {
    if (input[f] !== undefined) doc.set(f, input[f]);
  }
  if (input.altMobile !== undefined) doc.altMobile = normaliseMobile(input.altMobile);
  if (input.vendorTypeId !== undefined) doc.set('vendorType', input.vendorTypeId || undefined);
  await doc.save();
  await audit(user, 'UPDATE', 'Vendor', doc._id, doc.mobile ?? undefined, doc.name);
  return doc.toObject();
}

export async function listVendors(f: { page: number; limit: number; q?: string; active?: string; withBalance?: boolean }) {
  const query: Record<string, unknown> = {};
  if (f.active !== 'all') query.isActive = f.active !== 'false';
  if (f.withBalance) query.balance = { $gt: 0 };
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q.slice(0, 100)), 'i');
    query.$or = [{ name: rx }, { mobile: rx }, { contactPerson: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([
    VendorModel.find(query).populate('vendorType', 'name').sort({ name: 1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    VendorModel.countDocuments(query),
  ]);
  return { items, total };
}

export async function getVendor(id: string) {
  const v = await VendorModel.findById(id).populate('vendorType', 'name').lean();
  if (!v) throw ApiError.notFound('Vendor');
  const now = new Date();
  const open = await PurchaseModel.aggregate([
    { $match: { vendor: v._id, status: 'RECEIVED', balanceDue: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        due: { $sum: '$balanceDue' },
        overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] }, '$balanceDue', 0] } },
      },
    },
  ]);
  return { ...v, stats: { openInvoices: open[0]?.count ?? 0, outstanding: round(open[0]?.due ?? 0), overdue: round(open[0]?.overdue ?? 0) } };
}

export async function vendorOpenPurchases(vendorId: string) {
  return PurchaseModel.find({ vendor: new Types.ObjectId(vendorId), status: 'RECEIVED', balanceDue: { $gt: 0 } })
    .select('purchaseNo vendorInvoiceNo date dueDate grandTotal amountPaid returnedAmount balanceDue paymentStatus')
    .sort({ dueDate: 1, date: 1 })
    .lean();
}
