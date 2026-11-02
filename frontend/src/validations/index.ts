import { z } from 'zod';

const mobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^\+?\d{6,15}$/.test(v), 'Enter a valid mobile number');
const optMobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => v === '' || /^\+?\d{6,15}$/.test(v), 'Enter a valid mobile number')
  .optional();
const optEmail = z.string().trim().refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email').optional();
const num = (msg = 'Enter a valid number') => z.coerce.number({ invalid_type_error: msg }).min(0, 'Cannot be negative');

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(120),
  mobile,
  altMobile: optMobile,
  email: optEmail,
  address: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});
export type CustomerValues = z.infer<typeof customerSchema>;

export const vendorSchema = z.object({
  name: z.string().trim().min(1, 'Vendor name is required').max(150),
  contactPerson: z.string().max(100).optional(),
  mobile: optMobile,
  email: optEmail,
  address: z.string().max(500).optional(),
  taxId: z.string().max(50).optional(),
  paymentTermsDays: num().int('Whole days only').max(365).optional(),
  notes: z.string().max(1000).optional(),
});
export type VendorValues = z.infer<typeof vendorSchema>;

export const masterSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().max(300).optional(),
  kind: z.string().optional(),
});
export type MasterValues = z.infer<typeof masterSchema>;

export const deviceModelSchema = z.object({
  name: z.string().trim().min(1, 'Model name is required').max(100),
  brand: z.string().min(1, 'Select the brand'),
  deviceCategory: z.string().optional(),
});
export type DeviceModelValues = z.infer<typeof deviceModelSchema>;

export const productSchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required').max(200),
    productType: z.enum(['PHONE', 'SPARE_PART', 'ACCESSORY', 'CONSUMABLE', 'SERVICE', 'OTHER']),
    sku: z.string().max(60).optional(),
    barcode: z.string().max(60).optional(),
    categoryId: z.string().optional(),
    brandId: z.string().optional(),
    deviceModelId: z.string().optional(),
    sellingPrice: num('Enter the selling price'),
    purchaseCost: num().optional(),
    taxRate: z.union([z.literal(''), num().max(100)]).optional(),
    minStock: num().optional(),
    unit: z.string().max(20).optional(),
    warrantyMonths: num().int().max(120).optional(),
    trackSerial: z.boolean().optional(),
    preferredVendorId: z.string().optional(),
    description: z.string().max(1000).optional(),
    openingQty: num().optional(),
    openingCost: num().optional(),
    openingSerials: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.productType === 'SERVICE' && v.trackSerial) ctx.addIssue({ code: 'custom', path: ['trackSerial'], message: 'Services cannot track serials' });
    if (v.trackSerial && v.openingQty && v.openingQty > 0) {
      const serials = (v.openingSerials ?? '').split(/[\s,]+/).filter(Boolean);
      if (serials.length !== v.openingQty) ctx.addIssue({ code: 'custom', path: ['openingSerials'], message: `Enter ${v.openingQty} IMEI/serial numbers` });
    }
  });
export type ProductValues = z.infer<typeof productSchema>;

export const expenseSchema = z
  .object({
    date: z.string().min(1, 'Date is required'),
    categoryId: z.string().min(1, 'Select a category'),
    description: z.string().trim().min(1, 'Description is required').max(500),
    amount: z.coerce.number({ invalid_type_error: 'Enter the amount' }).positive('Amount must be greater than zero'),
    paidTo: z.string().max(150).optional(),
    vendorId: z.string().optional(),
    paymentStatus: z.enum(['PAID', 'UNPAID', 'PARTIAL']),
    amountPaid: num().optional(),
    method: z.string().optional(),
    reference: z.string().max(100).optional(),
    attachmentRef: z.string().max(300).optional(),
    notes: z.string().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.paymentStatus !== 'UNPAID' && !v.method) ctx.addIssue({ code: 'custom', path: ['method'], message: 'Select the payment method' });
    if (v.paymentStatus === 'PARTIAL' && !(Number(v.amountPaid) > 0 && Number(v.amountPaid) < v.amount)) {
      ctx.addIssue({ code: 'custom', path: ['amountPaid'], message: 'Enter an amount between 0 and the total' });
    }
  });
export type ExpenseValues = z.infer<typeof expenseSchema>;

export const userSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,30}$/, '3-30 letters, numbers, . _ -'),
  email: optEmail,
  password: z.string().min(8, 'At least 8 characters'),
  role: z.enum(['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT']),
});
export type UserValues = z.infer<typeof userSchema>;

/** Strips empty strings so optional fields are omitted from API payloads. */
export function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined && v !== null)) as Partial<T>;
}
