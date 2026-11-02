import { Types } from 'mongoose';
import {
  BrandModel,
  CustomerModel,
  CustomerPaymentModel,
  DeviceCategoryModel,
  DeviceModelModel,
  ProductModel,
  RepairJobModel,
  SaleModel,
  UserModel,
  type RepairStatus,
} from '../models';
import type { AuthUser } from '../types';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { add, mul, round, sub } from '../utils/money';
import { escapeRegex } from '../utils/pagination';
import { isDuplicateKeyError, withTransaction, type Session } from '../utils/transaction';
import { normaliseMethods, recordRefund, type MethodSplit } from './customerPayment.service';
import { postCustomer } from './ledger.service';
import { createSaleCore, type SaleItemInput } from './sale.service';
import { nextNumber } from './settings.service';

export interface RepairPartInput {
  productId: string;
  qty: number;
  unitPrice: number;
}

export interface RepairInput {
  clientRequestId?: string;
  customerId: string;
  contactNumber?: string;
  deviceCategoryId?: string;
  brandId?: string;
  deviceModelId?: string;
  imei?: string;
  conditionAtReceipt?: string;
  accessoriesReceived?: string;
  complaint: string;
  diagnosis?: string;
  estimatedCost?: number;
  approvedCost?: number;
  technicianId?: string;
  receivedAt?: Date;
  expectedDeliveryAt?: Date;
  parts?: RepairPartInput[];
  laborCharge?: number;
  discount?: number;
  warrantyType?: 'NONE' | 'PARTS' | 'LABOR' | 'FULL';
  warrantyDays?: number;
  internalNotes?: string;
  customerNotes?: string;
  advance?: { methods: MethodSplit[] };
}

const OPEN_STATUSES: RepairStatus[] = ['RECEIVED', 'DIAGNOSIS_PENDING', 'WAITING_APPROVAL', 'WAITING_PARTS', 'IN_PROGRESS'];

async function resolveRefs(input: Partial<RepairInput>, session: Session) {
  const out: Record<string, unknown> = {};
  if (input.deviceCategoryId !== undefined) {
    const c = input.deviceCategoryId ? await DeviceCategoryModel.findById(input.deviceCategoryId).session(session ?? null).lean() : null;
    out.deviceCategory = c?._id ?? null;
    out.deviceCategoryName = c?.name ?? null;
  }
  if (input.brandId !== undefined) {
    const b = input.brandId ? await BrandModel.findById(input.brandId).session(session ?? null).lean() : null;
    out.brand = b?._id ?? null;
    out.brandName = b?.name ?? null;
  }
  if (input.deviceModelId !== undefined) {
    const m = input.deviceModelId ? await DeviceModelModel.findById(input.deviceModelId).session(session ?? null).lean() : null;
    out.deviceModel = m?._id ?? null;
    out.deviceModelName = m?.name ?? null;
  }
  if (input.technicianId !== undefined) {
    const t = input.technicianId ? await UserModel.findById(input.technicianId).session(session ?? null).lean() : null;
    out.technician = t?._id ?? null;
    out.technicianName = t?.name ?? null;
  }
  if (input.parts !== undefined) {
    const products = await ProductModel.find({ _id: { $in: input.parts.map((p) => p.productId) } }).session(session ?? null).lean();
    out.parts = input.parts.map((p) => {
      const prod = products.find((x) => String(x._id) === p.productId);
      if (!prod) throw ApiError.validation('Spare part not found');
      if (!prod.trackInventory) throw ApiError.validation(`${prod.name} is a service item, not a spare part`);
      if (!(p.qty > 0)) throw ApiError.validation(`${prod.name}: quantity must be greater than zero`);
      return { product: prod._id, name: prod.name, qty: p.qty, unitPrice: round(p.unitPrice), consumed: false };
    });
  }
  return out;
}

async function recordAdvance(
  repair: { _id: Types.ObjectId; jobNo: string; customer: Types.ObjectId; customerName?: string | null },
  methodsIn: MethodSplit[],
  user: AuthUser,
  session: Session,
) {
  const methods = await normaliseMethods(methodsIn, session);
  const amount = add(...methods.map((m) => m.amount));
  if (amount <= 0) return 0;
  const receiptNo = await nextNumber('receipt', session);
  const date = new Date();
  const doc = await new CustomerPaymentModel({
    receiptNo,
    type: 'ADVANCE',
    customer: repair.customer,
    customerName: repair.customerName,
    date,
    amount,
    methods,
    unallocated: amount,
    repairJob: repair._id,
    source: 'REPAIR_ADVANCE',
    refId: repair._id,
    createdBy: user.id,
  }).save({ session });
  await postCustomer(
    {
      customerId: repair.customer,
      date,
      type: 'ADVANCE',
      refType: 'CustomerPayment',
      refId: doc._id,
      refNo: receiptNo,
      credit: amount,
      narration: `Advance for repair ${repair.jobNo}`,
      userId: user.id,
      totals: { totalPaid: amount },
    },
    session,
  );
  return amount;
}

export async function createRepair(input: RepairInput, user: AuthUser) {
  if (input.clientRequestId) {
    const existing = await RepairJobModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { repair: existing, duplicate: true };
  }
  try {
    const repair = await withTransaction(async (session) => {
      const customer = await CustomerModel.findById(input.customerId).session(session ?? null).lean();
      if (!customer) throw ApiError.validation('Customer not found');
      if (customer.isWalkIn) throw ApiError.validation('Repair jobs need a registered customer so the device can be returned to them');
      const refs = await resolveRefs({ ...input, parts: input.parts ?? [] }, session);
      const jobNo = await nextNumber('repair', session);
      const doc = await new RepairJobModel({
        ...refs,
        jobNo,
        clientRequestId: input.clientRequestId,
        customer: customer._id,
        customerName: customer.name,
        contactNumber: input.contactNumber || customer.mobile,
        imei: input.imei,
        conditionAtReceipt: input.conditionAtReceipt,
        accessoriesReceived: input.accessoriesReceived,
        complaint: input.complaint,
        diagnosis: input.diagnosis,
        estimatedCost: round(input.estimatedCost ?? 0),
        approvedCost: round(input.approvedCost ?? 0),
        receivedAt: input.receivedAt ?? new Date(),
        expectedDeliveryAt: input.expectedDeliveryAt,
        laborCharge: round(input.laborCharge ?? 0),
        discount: round(input.discount ?? 0),
        warrantyType: input.warrantyType ?? 'NONE',
        warrantyDays: input.warrantyDays ?? 0,
        internalNotes: input.internalNotes,
        customerNotes: input.customerNotes,
        status: 'RECEIVED',
        statusHistory: [{ status: 'RECEIVED', at: new Date(), by: user.id, byName: user.name, note: 'Job created' }],
        createdBy: user.id,
      }).save({ session });
      if (input.advance?.methods?.length) {
        doc.advancePaid = await recordAdvance(doc, input.advance.methods, user, session);
        await doc.save({ session });
      }
      await audit(user, 'CREATE', 'RepairJob', doc._id, jobNo, `Repair job for ${customer.name}`, undefined, session);
      return doc.toObject();
    });
    return { repair, duplicate: false };
  } catch (err) {
    if (input.clientRequestId && isDuplicateKeyError(err, 'clientRequestId')) {
      const existing = await RepairJobModel.findOne({ clientRequestId: input.clientRequestId }).lean();
      if (existing) return { repair: existing, duplicate: true };
    }
    throw err;
  }
}

export async function updateRepair(id: string, input: Partial<RepairInput>, user: AuthUser) {
  return withTransaction(async (session) => {
    const repair = await RepairJobModel.findById(id).session(session ?? null);
    if (!repair) throw ApiError.notFound('Repair job');
    if (repair.sale || !OPEN_STATUSES.includes(repair.status as RepairStatus)) {
      throw ApiError.conflict('Completed, delivered or cancelled jobs cannot be edited');
    }
    const refs = await resolveRefs(input, session);
    const fields: Array<keyof RepairInput> = [
      'contactNumber',
      'imei',
      'conditionAtReceipt',
      'accessoriesReceived',
      'complaint',
      'diagnosis',
      'expectedDeliveryAt',
      'warrantyType',
      'warrantyDays',
      'internalNotes',
      'customerNotes',
    ];
    const patch: Record<string, unknown> = { ...refs };
    for (const f of fields) if (input[f] !== undefined) patch[f] = input[f];
    for (const f of ['estimatedCost', 'approvedCost', 'laborCharge', 'discount'] as const) if (input[f] !== undefined) patch[f] = round(input[f]);
    repair.set(patch);
    await repair.save({ session });
    await audit(user, 'UPDATE', 'RepairJob', repair._id, repair.jobNo, 'Job updated', Object.keys(patch), session);
    return repair.toObject();
  });
}

export async function addRepairAdvance(id: string, methods: MethodSplit[], user: AuthUser) {
  return withTransaction(async (session) => {
    const repair = await RepairJobModel.findById(id).session(session ?? null);
    if (!repair) throw ApiError.notFound('Repair job');
    if (repair.sale || !OPEN_STATUSES.includes(repair.status as RepairStatus)) {
      throw ApiError.conflict('Advance can only be taken on an open job. Collect the balance on the invoice instead.');
    }
    const amount = await recordAdvance(repair, methods, user, session);
    if (amount <= 0) throw ApiError.validation('Advance amount must be greater than zero');
    repair.advancePaid = add(repair.advancePaid, amount);
    await repair.save({ session });
    await audit(user, 'ADVANCE', 'RepairJob', repair._id, repair.jobNo, `Advance ${amount}`, undefined, session);
    return repair.toObject();
  });
}

async function cancelRepairCore(repairId: string, reason: string, refundMethod: string | undefined, user: AuthUser, session: Session) {
  const repair = await RepairJobModel.findById(repairId).session(session ?? null);
  if (!repair) throw ApiError.notFound('Repair job');
  if (repair.sale) throw ApiError.conflict('This job has been invoiced; use a sales return on the invoice instead');
  if (repair.status === 'CANCELLED') throw ApiError.conflict('Job is already cancelled');
  const advances = await CustomerPaymentModel.find({ repairJob: repair._id, type: 'ADVANCE', status: 'ACTIVE', unallocated: { $gt: 0 } }).session(session ?? null);
  for (const adv of advances) {
    await recordRefund(
      {
        customerId: repair.customer,
        customerName: repair.customerName ?? '',
        date: new Date(),
        amount: adv.unallocated,
        method: refundMethod || adv.methods?.[0]?.method || 'Cash',
        source: 'REPAIR_CANCEL',
        refId: repair._id,
        refNo: repair.jobNo,
        repairJob: repair._id,
        notes: `Advance ${adv.receiptNo} refunded`,
      },
      user,
      session,
    );
    adv.unallocated = 0;
    await adv.save({ session });
  }
  repair.status = 'CANCELLED';
  repair.cancelReason = reason;
  repair.statusHistory.push({ status: 'CANCELLED', at: new Date(), by: new Types.ObjectId(user.id), byName: user.name, note: reason });
  await repair.save({ session });
  await audit(user, 'CANCEL', 'RepairJob', repair._id, repair.jobNo, reason, undefined, session);
  return repair;
}

export async function updateRepairStatus(id: string, input: { status: RepairStatus; note?: string; refundMethod?: string }, user: AuthUser) {
  return withTransaction(async (session) => {
    if (input.status === 'CANCELLED') {
      return (await cancelRepairCore(id, input.note || 'Cancelled', input.refundMethod, user, session)).toObject();
    }
    const repair = await RepairJobModel.findById(id).session(session ?? null);
    if (!repair) throw ApiError.notFound('Repair job');
    if (repair.status === 'CANCELLED' || repair.status === 'DELIVERED') throw ApiError.conflict(`Job is already ${repair.status.toLowerCase()}`);
    if ((input.status === 'READY_FOR_DELIVERY' || input.status === 'DELIVERED') && !repair.sale) {
      throw ApiError.conflict('Complete the repair (generate the invoice) before marking it ready or delivered', 'NOT_COMPLETED');
    }
    if (repair.sale && OPEN_STATUSES.includes(input.status)) {
      throw ApiError.conflict('An invoiced job cannot go back to an earlier stage');
    }
    if (repair.status === input.status) return repair.toObject();
    repair.status = input.status;
    if (input.status === 'DELIVERED') repair.deliveredAt = new Date();
    repair.statusHistory.push({ status: input.status, at: new Date(), by: new Types.ObjectId(user.id), byName: user.name, note: input.note });
    await repair.save({ session });
    await audit(user, 'STATUS', 'RepairJob', repair._id, repair.jobNo, `Status -> ${input.status}`, undefined, session);
    return repair.toObject();
  });
}

export interface CompleteRepairInput {
  clientRequestId?: string;
  payments?: MethodSplit[];
  deliver?: boolean;
  note?: string;
  refundMethod?: string;
}

/**
 * Completes a job exactly once: the conditional update on `sale: null` plus the per-part
 * `consumed` flag make a repeated completion impossible, so spares are never deducted twice.
 * Builds the invoice (labour + spare-part lines), applies advances, takes the payment and
 * deducts the spares from stock - all in one transaction.
 */
export async function completeRepair(id: string, input: CompleteRepairInput, user: AuthUser) {
  if (input.clientRequestId) {
    const existing = await SaleModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { repair: await RepairJobModel.findById(id).lean(), sale: existing, duplicate: true };
  }
  const result = await withTransaction(async (session) => {
    const now = new Date();
    const repair = await RepairJobModel.findOneAndUpdate(
      { _id: id, sale: null, status: { $in: OPEN_STATUSES } },
      { $set: { completedAt: now } },
      { new: true, session },
    );
    if (!repair) {
      const existing = await RepairJobModel.findById(id).session(session ?? null).lean();
      if (!existing) throw ApiError.notFound('Repair job');
      throw ApiError.conflict(
        existing.sale ? `Job already completed (invoice ${existing.invoiceNo})` : `Job is ${existing.status.toLowerCase()}`,
        'ALREADY_COMPLETED',
      );
    }
    if (repair.parts.some((p) => p.consumed)) throw ApiError.conflict('Spare parts for this job were already consumed', 'ALREADY_CONSUMED');

    const device = {
      deviceCategoryId: repair.deviceCategory ? String(repair.deviceCategory) : undefined,
      brandId: repair.brand ? String(repair.brand) : undefined,
      deviceModelId: repair.deviceModel ? String(repair.deviceModel) : undefined,
      imei: repair.imei ?? undefined,
    };
    const warrantyExpiry = repair.warrantyDays ? new Date(now.getTime() + repair.warrantyDays * 86400000) : undefined;
    const warranty = warrantyExpiry
      ? { status: 'NEW_WARRANTY' as const, startDate: now, expiryDate: warrantyExpiry }
      : { status: 'NONE' as const };

    const items: SaleItemInput[] = [];
    if (repair.laborCharge > 0) {
      items.push({
        itemType: 'SERVICE',
        name: `Repair service (${repair.jobNo})`,
        description: [repair.brandName, repair.deviceModelName].filter(Boolean).join(' ') || undefined,
        qty: 1,
        unitPrice: repair.laborCharge,
        complaint: repair.complaint,
        device,
        warranty: repair.warrantyType === 'LABOR' || repair.warrantyType === 'FULL' ? warranty : { status: 'NONE' },
        internal: { revenueType: 'LABOR' },
      });
    }
    for (const part of repair.parts) {
      items.push({
        itemType: 'PRODUCT',
        productId: String(part.product),
        name: part.name ?? undefined,
        qty: part.qty,
        unitPrice: part.unitPrice ?? 0,
        device,
        warranty: repair.warrantyType === 'PARTS' || repair.warrantyType === 'FULL' ? warranty : { status: 'NONE' },
        internal: { revenueType: 'SPARE_PART', isRepairPart: true },
      });
    }
    if (!items.length) throw ApiError.validation('Add a labour charge or spare parts before completing the job');

    const advances = await CustomerPaymentModel.find({ repairJob: repair._id, type: 'ADVANCE', status: 'ACTIVE', unallocated: { $gt: 0 } })
      .session(session ?? null)
      .lean();

    const sale = await createSaleCore(
      {
        clientRequestId: input.clientRequestId,
        date: now,
        customerId: String(repair.customer),
        items,
        billDiscount: repair.discount ?? 0,
        payments: input.payments ?? [],
        notes: `Repair job ${repair.jobNo}${input.note ? ` - ${input.note}` : ''}`,
      },
      user,
      session,
      { repairJobId: repair._id, advanceIds: advances.map((a) => a._id) },
    );

    // Any advance exceeding the final bill is refunded.
    const leftovers = await CustomerPaymentModel.find({ repairJob: repair._id, type: 'ADVANCE', status: 'ACTIVE', unallocated: { $gt: 0 } }).session(session ?? null);
    for (const adv of leftovers) {
      await recordRefund(
        {
          customerId: repair.customer,
          customerName: repair.customerName ?? '',
          date: now,
          amount: adv.unallocated,
          method: input.refundMethod || adv.methods?.[0]?.method || 'Cash',
          source: 'REPAIR_CANCEL',
          refId: repair._id,
          refNo: repair.jobNo,
          repairJob: repair._id,
          notes: `Excess advance ${adv.receiptNo} refunded`,
        },
        user,
        session,
      );
      adv.unallocated = 0;
      await adv.save({ session });
    }

    for (const part of repair.parts) {
      const line = sale.items.find((i) => i.isRepairPart && String(i.product) === String(part.product));
      part.consumed = true;
      part.consumedAt = now;
      part.unitCost = line?.unitCost ?? 0;
    }
    const finalStatus: RepairStatus = input.deliver ? 'DELIVERED' : 'READY_FOR_DELIVERY';
    repair.sale = sale._id;
    repair.invoiceNo = sale.invoiceNo;
    repair.status = finalStatus;
    repair.warrantyExpiry = warrantyExpiry;
    if (input.deliver) repair.deliveredAt = now;
    repair.statusHistory.push({
      status: finalStatus,
      at: now,
      by: new Types.ObjectId(user.id),
      byName: user.name,
      note: `Completed - invoice ${sale.invoiceNo}`,
    });
    await repair.save({ session });
    await audit(user, 'COMPLETE', 'RepairJob', repair._id, repair.jobNo, `Invoiced ${sale.invoiceNo}`, undefined, session);
    return { repair: repair.toObject(), sale: sale.toObject() };
  });
  return { ...result, duplicate: false };
}

export function repairEstimate(r: { laborCharge?: number | null; discount?: number | null; parts?: Array<{ qty: number; unitPrice?: number | null }>; advancePaid?: number | null }) {
  const partsTotal = add(...(r.parts ?? []).map((p) => mul(p.unitPrice ?? 0, p.qty)));
  const total = sub(add(r.laborCharge ?? 0, partsTotal), r.discount ?? 0);
  return { partsTotal, total, balanceDue: sub(total, r.advancePaid ?? 0) };
}

export async function listRepairs(f: { page: number; limit: number; q?: string; status?: string; customer?: string; technician?: string; from?: Date; to?: Date }) {
  const query: Record<string, unknown> = {};
  if (f.status) query.status = { $in: f.status.split(',') };
  if (f.customer) query.customer = new Types.ObjectId(f.customer);
  if (f.technician) query.technician = new Types.ObjectId(f.technician);
  if (f.from || f.to) query.receivedAt = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q.slice(0, 100)), 'i');
    query.$or = [{ jobNo: rx }, { customerName: rx }, { contactNumber: rx }, { imei: rx }, { brandName: rx }, { deviceModelName: rx }];
  }
  const [items, total] = await Promise.all([
    RepairJobModel.find(query).sort({ receivedAt: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
    RepairJobModel.countDocuments(query),
  ]);
  return { items: items.map((r) => ({ ...r, estimate: repairEstimate(r) })), total };
}

export async function getRepair(id: string) {
  const repair = await RepairJobModel.findById(id).lean();
  if (!repair) throw ApiError.notFound('Repair job');
  const [sale, payments, customer] = await Promise.all([
    repair.sale ? SaleModel.findById(repair.sale).lean() : null,
    CustomerPaymentModel.find({ $or: [{ repairJob: repair._id }, ...(repair.sale ? [{ 'allocations.sale': repair.sale }] : [])] })
      .sort({ date: 1 })
      .lean(),
    CustomerModel.findById(repair.customer).lean(),
  ]);
  return { ...repair, estimate: repairEstimate(repair), sale, payments, customerDetails: customer };
}
