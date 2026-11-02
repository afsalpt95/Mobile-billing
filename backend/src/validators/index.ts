import { z } from 'zod';
import { REPAIR_STATUSES, PRODUCT_TYPES } from '../models';
import { ROLES } from '../types';
import {
  clientRequestId,
  listQuery,
  methodSplit,
  money,
  nullableId,
  objectId,
  optDate,
  optId,
  optStr,
  percent,
  qty,
  qBool,
  reqStr,
} from './common';

export * from './common';

// ---------- auth / users ----------
export const loginBody = z.object({ username: reqStr(50, 'Username'), password: z.string().min(1, 'Password is required').max(200) });
const password = z.string().min(8, 'Password must be at least 8 characters').max(100);
export const createUserBody = z.object({
  name: reqStr(100, 'Name'),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/, 'Username: 3-30 letters, numbers, . _ -'),
  email: optStr(100).pipe(z.string().email().optional()),
  password,
  role: z.enum(ROLES),
});
export const updateUserBody = z.object({
  name: optStr(100),
  email: optStr(100),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  password: password.optional(),
});
export const changePasswordBody = z.object({ currentPassword: z.string().min(1), newPassword: password });

// ---------- customers / vendors ----------
const mobile = z.preprocess(
  (v) => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : v),
  z.string().regex(/^\+?\d{6,15}$/, 'Enter a valid mobile number'),
);
const optMobile = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), mobile.optional());
const optEmail = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().email('Enter a valid email').optional());

export const customerBody = z.object({
  name: reqStr(120, 'Customer name'),
  mobile,
  altMobile: optMobile,
  email: optEmail,
  address: optStr(500),
  notes: optStr(1000),
  allowDuplicate: z.boolean().optional(),
});
export const customerPatch = customerBody.partial().extend({ isActive: z.boolean().optional(), mobile: optMobile });
export const customerListQuery = listQuery.extend({
  withBalance: qBool,
  active: z.enum(['true', 'false', 'all']).optional(),
  includeWalkIn: qBool,
});

export const vendorBody = z.object({
  name: reqStr(150, 'Vendor name'),
  contactPerson: optStr(100),
  mobile: optMobile,
  altMobile: optMobile,
  email: optEmail,
  address: optStr(500),
  taxId: optStr(50),
  vendorTypeId: nullableId,
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  notes: optStr(1000),
  allowDuplicate: z.boolean().optional(),
});
export const vendorPatch = vendorBody.partial().extend({ isActive: z.boolean().optional() });
export const vendorListQuery = listQuery.extend({ active: z.enum(['true', 'false', 'all']).optional(), withBalance: qBool });

// ---------- masters ----------
export const masterBody = z.object({
  name: reqStr(100, 'Name'),
  description: optStr(300),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
  brand: optId,
  deviceCategory: optId,
  kind: optStr(20),
});
export const masterPatch = masterBody.partial();
export const masterListQuery = z.object({
  q: optStr(100),
  active: z.enum(['true', 'false', 'all']).optional(),
  brand: optId,
  deviceCategory: optId,
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// ---------- products ----------
export const productBody = z.object({
  sku: optStr(60),
  barcode: optStr(60),
  name: reqStr(200, 'Product name'),
  productType: z.enum(PRODUCT_TYPES),
  categoryId: nullableId,
  deviceCategoryId: nullableId,
  brandId: nullableId,
  deviceModelId: nullableId,
  description: optStr(1000),
  purchaseCost: money.optional(),
  sellingPrice: money.optional(),
  taxRate: percent.nullable().optional(),
  minStock: z.coerce.number().min(0).max(1e6).optional(),
  unit: optStr(20),
  preferredVendorId: nullableId,
  warrantyMonths: z.coerce.number().int().min(0).max(120).optional(),
  trackSerial: z.boolean().optional(),
  isActive: z.boolean().optional(),
  openingStock: z
    .object({ qty: z.coerce.number().min(0).max(1e7), unitCost: money, serials: z.array(z.string().max(40)).max(10000).optional() })
    .optional(),
});
export const productPatch = productBody.omit({ openingStock: true }).partial();
export const productListQuery = listQuery.extend({
  type: optStr(100),
  category: optId,
  brand: optId,
  deviceModel: optId,
  lowStock: qBool,
  inStock: qBool,
  active: z.enum(['true', 'false', 'all']).optional(),
});

// ---------- sales ----------
const warranty = z.object({
  status: z.enum(['NONE', 'IN_WARRANTY', 'OUT_OF_WARRANTY', 'NEW_WARRANTY']),
  startDate: optDate,
  expiryDate: optDate,
});
export const saleItemBody = z.object({
  itemType: z.enum(['PRODUCT', 'SERVICE']),
  productId: optId,
  name: optStr(200),
  description: optStr(500),
  qty,
  unitPrice: money,
  discount: money.optional(),
  taxRate: percent.optional(),
  serials: z.array(z.string().trim().max(40)).max(1000).optional(),
  device: z.object({ deviceCategoryId: optId, brandId: optId, deviceModelId: optId, imei: optStr(40) }).optional(),
  complaint: optStr(500),
  sparePart: z.object({ productId: objectId, qty, dealerId: optId }).optional(),
  warranty: warranty.optional(),
});
export const saleBody = z.object({
  clientRequestId,
  date: optDate,
  customerId: optId,
  items: z.array(saleItemBody).min(1, 'Add at least one item').max(200),
  billDiscount: money.optional(),
  payments: z.array(methodSplit).max(10).default([]),
  dueDate: optDate,
  notes: optStr(1000),
  allowStockOverride: z.boolean().optional(),
});
export const saleListQuery = listQuery.extend({ customer: optId, status: optStr(20), paymentStatus: optStr(40) });
export const cancelSaleBody = z.object({ reason: reqStr(500, 'Reason'), refundMethod: optStr(50) });
export const salePaymentBody = z.object({ clientRequestId, date: optDate, methods: z.array(methodSplit).min(1).max(10), notes: optStr(500) });

// ---------- customer payments ----------
export const customerPaymentBody = z.object({
  clientRequestId,
  customerId: objectId,
  date: optDate,
  methods: z.array(methodSplit).min(1, 'Enter the payment').max(10),
  allocationMode: z.enum(['OLDEST_FIRST', 'MANUAL']).default('OLDEST_FIRST'),
  allocations: z.array(z.object({ saleId: objectId, amount: money })).max(500).optional(),
  notes: optStr(500),
});
export const paymentListQuery = listQuery.extend({ customer: optId, vendor: optId, type: optStr(20) });

// ---------- returns ----------
export const salesReturnBody = z.object({
  clientRequestId,
  date: optDate,
  items: z.array(z.object({ saleItemId: objectId, qty, restock: z.boolean().default(true), serials: z.array(z.string().max(40)).optional() })).min(1).max(200),
  reason: reqStr(500, 'Return reason'),
  refundMethod: optStr(50),
  notes: optStr(500),
});
export const purchaseReturnBody = z.object({
  clientRequestId,
  date: optDate,
  items: z.array(z.object({ purchaseItemId: objectId, qty, serials: z.array(z.string().max(40)).optional() })).min(1).max(200),
  reason: reqStr(500, 'Return reason'),
  settlement: z.enum(['REFUND', 'CREDIT_NOTE']).default('CREDIT_NOTE'),
  refundMethod: optStr(50),
  notes: optStr(500),
});

// ---------- purchases ----------
export const purchaseBody = z.object({
  clientRequestId,
  vendorId: objectId,
  vendorInvoiceNo: optStr(60),
  date: optDate,
  dueDate: optDate,
  items: z
    .array(
      z.object({
        productId: objectId,
        qty,
        freeQty: z.coerce.number().min(0).max(1e7).optional(),
        unitCost: money,
        discount: money.optional(),
        taxRate: percent.optional(),
        serials: z.array(z.string().trim().max(40)).max(10000).optional(),
      }),
    )
    .min(1, 'Add at least one item')
    .max(300),
  shippingCharges: money.optional(),
  otherCharges: money.optional(),
  paymentTerms: optStr(200),
  notes: optStr(1000),
  attachmentRef: optStr(300),
  initialPayment: z.object({ amount: money, method: optStr(50), reference: optStr(100) }).optional(),
  receive: z.boolean().optional(),
});
export const purchaseListQuery = listQuery.extend({ vendor: optId, status: optStr(40), paymentStatus: optStr(40) });

// ---------- vendor payments ----------
export const vendorPaymentBody = z.object({
  clientRequestId,
  vendorId: objectId,
  date: optDate,
  amount: money,
  method: reqStr(50, 'Payment method'),
  reference: optStr(100),
  allocationMode: z.enum(['OLDEST_FIRST', 'MANUAL']).default('OLDEST_FIRST'),
  allocations: z.array(z.object({ purchaseId: objectId, amount: money })).max(500).optional(),
  recordExcessAsAdvance: z.boolean().optional(),
  notes: optStr(500),
});
export const purchasePaymentBody = vendorPaymentBody.omit({ vendorId: true, allocationMode: true, allocations: true });
export const applyAdvanceBody = z.object({
  clientRequestId,
  vendorId: objectId,
  amount: money,
  allocationMode: z.enum(['OLDEST_FIRST', 'MANUAL']).default('OLDEST_FIRST'),
  allocations: z.array(z.object({ purchaseId: objectId, amount: money })).optional(),
  notes: optStr(500),
});
export const vendorRefundBody = z.object({
  clientRequestId,
  vendorId: objectId,
  amount: money,
  method: reqStr(50, 'Payment method'),
  reference: optStr(100),
  notes: optStr(500),
  date: optDate,
});

// ---------- repairs ----------
const repairCore = {
  contactNumber: optStr(20),
  deviceCategoryId: optId,
  brandId: optId,
  deviceModelId: optId,
  imei: optStr(40),
  conditionAtReceipt: optStr(1000),
  accessoriesReceived: optStr(500),
  diagnosis: optStr(2000),
  estimatedCost: money.optional(),
  approvedCost: money.optional(),
  technicianId: optId,
  expectedDeliveryAt: optDate,
  parts: z.array(z.object({ productId: objectId, qty, unitPrice: money })).max(100).optional(),
  laborCharge: money.optional(),
  discount: money.optional(),
  warrantyType: z.enum(['NONE', 'PARTS', 'LABOR', 'FULL']).optional(),
  warrantyDays: z.coerce.number().int().min(0).max(3650).optional(),
  internalNotes: optStr(2000),
  customerNotes: optStr(2000),
};
export const repairBody = z.object({
  clientRequestId,
  customerId: objectId,
  complaint: reqStr(2000, 'Customer complaint'),
  receivedAt: optDate,
  advance: z.object({ methods: z.array(methodSplit).max(5) }).optional(),
  ...repairCore,
});
export const repairPatch = z.object({ complaint: optStr(2000), ...repairCore });
export const repairStatusBody = z.object({ status: z.enum(REPAIR_STATUSES), note: optStr(500), refundMethod: optStr(50) });
export const repairAdvanceBody = z.object({ methods: z.array(methodSplit).min(1).max(5) });
export const repairCompleteBody = z.object({
  clientRequestId,
  payments: z.array(methodSplit).max(10).default([]),
  deliver: z.boolean().optional(),
  note: optStr(500),
  refundMethod: optStr(50),
});
export const repairListQuery = listQuery.extend({ status: optStr(200), customer: optId, technician: optId });

// ---------- inventory ----------
export const adjustmentBody = z.object({
  clientRequestId,
  productId: objectId,
  type: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGED']),
  qty,
  unitCost: money.optional(),
  reason: reqStr(500, 'Reason'),
  date: optDate,
});
export const movementListQuery = listQuery.extend({ product: optId, type: optStr(200) });

// ---------- expenses ----------
export const expenseBody = z.object({
  clientRequestId,
  date: optDate,
  categoryId: objectId,
  description: reqStr(500, 'Description'),
  amount: money.refine((v) => v > 0, 'Amount must be greater than zero'),
  paidTo: optStr(150),
  vendorId: optId,
  amountPaid: money.optional(),
  method: optStr(50),
  reference: optStr(100),
  attachmentRef: optStr(300),
  notes: optStr(1000),
});
export const expensePatch = expenseBody.omit({ clientRequestId: true, amountPaid: true, method: true, reference: true }).partial().extend({ vendorId: nullableId });
export const expensePayBody = z.object({ amount: money, method: reqStr(50, 'Payment method'), reference: optStr(100), date: optDate });
export const expenseListQuery = listQuery.extend({ category: optId, status: optStr(20), paymentStatus: optStr(40), method: optStr(50) });

// ---------- reports ----------
export const reportQuery = z.object({
  from: optStr(10),
  to: optStr(10),
  groupBy: z.enum(['day', 'week', 'month']).optional(),
});

// ---------- settings ----------
const prefix = z.string().trim().max(10).regex(/^[A-Za-z0-9/_-]*$/, 'Prefix may contain letters, numbers, / _ -');
export const settingsPatch = z
  .object({
    shopName: optStr(150),
    address: z.string().max(500).optional(),
    phone: z.string().max(50).optional(),
    email: z.string().max(100).optional(),
    logo: z.string().max(400_000).optional(),
    taxRegistrationNo: z.string().max(50).optional(),
    currencyCode: z.string().max(5).optional(),
    currencySymbol: z.string().max(5).optional(),
    currencyPrecision: z.coerce.number().int().min(0).max(3).optional(),
    numbering: z
      .object({
        invoicePrefix: prefix,
        purchasePrefix: prefix,
        repairPrefix: prefix,
        expensePrefix: prefix,
        receiptPrefix: prefix,
        vendorPaymentPrefix: prefix,
        salesReturnPrefix: prefix,
        purchaseReturnPrefix: prefix,
        adjustmentPrefix: prefix,
        padding: z.coerce.number().int().min(3).max(10),
      })
      .partial()
      .optional(),
    tax: z.object({ enabled: z.boolean(), name: z.string().max(20), defaultRate: percent, purchaseTaxInCost: z.boolean() }).partial().optional(),
    billing: z
      .object({
        walkInEnabled: z.boolean(),
        maxCashierDiscountPercent: percent,
        allowStockOverride: z.boolean(),
        defaultPaymentMethod: z.string().max(50),
        invoiceFooter: z.string().max(500),
        creditDueDays: z.coerce.number().int().min(0).max(365),
      })
      .partial()
      .optional(),
    warranty: z
      .object({ defaultProductMonths: z.coerce.number().int().min(0).max(120), defaultRepairDays: z.coerce.number().int().min(0).max(3650), terms: z.string().max(1000) })
      .partial()
      .optional(),
    inventory: z.object({ defaultMinStock: z.coerce.number().min(0).max(1e6) }).partial().optional(),
    vendorPayments: z.object({ defaultAllocation: z.enum(['OLDEST_FIRST', 'MANUAL']) }).partial().optional(),
  })
  .strict();
export const masterParams = z.object({ master: z.string().regex(/^[a-z-]{3,40}$/, 'Invalid list') });
