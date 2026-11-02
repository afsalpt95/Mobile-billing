import { Schema, model, type InferSchemaType } from 'mongoose';

const shopSettingsSchema = new Schema(
  {
    key: { type: String, default: 'default', unique: true },
    shopName: { type: String, default: 'My Mobile Shop' },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    /** Data URL or URL of the logo (kept small - shown on invoices). */
    logo: { type: String, default: '' },
    taxRegistrationNo: { type: String, default: '' },
    currencyCode: { type: String, default: 'INR' },
    currencySymbol: { type: String, default: '₹' },
    currencyPrecision: { type: Number, default: 2, min: 0, max: 3 },
    numbering: {
      invoicePrefix: { type: String, default: 'INV-' },
      purchasePrefix: { type: String, default: 'PUR-' },
      repairPrefix: { type: String, default: 'JOB-' },
      expensePrefix: { type: String, default: 'EXP-' },
      receiptPrefix: { type: String, default: 'RCPT-' },
      vendorPaymentPrefix: { type: String, default: 'VPAY-' },
      salesReturnPrefix: { type: String, default: 'SR-' },
      purchaseReturnPrefix: { type: String, default: 'PR-' },
      adjustmentPrefix: { type: String, default: 'ADJ-' },
      padding: { type: Number, default: 6, min: 3, max: 10 },
    },
    tax: {
      enabled: { type: Boolean, default: false },
      name: { type: String, default: 'GST' },
      defaultRate: { type: Number, default: 0, min: 0, max: 100 },
      /** When true, purchase tax is added to inventory cost (not recoverable). */
      purchaseTaxInCost: { type: Boolean, default: true },
    },
    billing: {
      walkInEnabled: { type: Boolean, default: true },
      walkInCustomer: { type: Schema.Types.ObjectId, ref: 'Customer' },
      /** Max line/bill discount a non-admin can give, as % of the line/bill value. */
      maxCashierDiscountPercent: { type: Number, default: 10, min: 0, max: 100 },
      /** Lets an ADMIN sell beyond available stock. */
      allowStockOverride: { type: Boolean, default: false },
      defaultPaymentMethod: { type: String, default: 'Cash' },
      invoiceFooter: { type: String, default: 'Thank you for your business!' },
      creditDueDays: { type: Number, default: 30, min: 0 },
    },
    warranty: {
      defaultProductMonths: { type: Number, default: 0, min: 0 },
      defaultRepairDays: { type: Number, default: 30, min: 0 },
      terms: { type: String, default: 'Warranty does not cover physical or liquid damage.' },
    },
    inventory: {
      defaultMinStock: { type: Number, default: 2, min: 0 },
    },
    vendorPayments: {
      defaultAllocation: { type: String, enum: ['OLDEST_FIRST', 'MANUAL'], default: 'OLDEST_FIRST' },
    },
  },
  { timestamps: true },
);

export type ShopSettings = InferSchemaType<typeof shopSettingsSchema>;
export const ShopSettingsModel = model('ShopSettings', shopSettingsSchema);
