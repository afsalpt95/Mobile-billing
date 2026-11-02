import { Schema, model, type InferSchemaType } from 'mongoose';

const salesReturnItemSchema = new Schema(
  {
    saleItemId: { type: Schema.Types.ObjectId, required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    itemType: String,
    revenueType: String,
    isRepairPart: Boolean,
    qty: { type: Number, required: true, min: 0 },
    /** Taxable value returned (revenue reversal). */
    taxableAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    /** taxable + tax = value credited to the customer */
    amount: { type: Number, required: true },
    unitCost: { type: Number, default: 0 },
    costTotal: { type: Number, default: 0 },
    restock: { type: Boolean, default: true },
    serials: [String],
  },
  { _id: false },
);

const salesReturnSchema = new Schema(
  {
    returnNo: { type: String, required: true },
    clientRequestId: String,
    date: { type: Date, required: true },
    sale: { type: Schema.Types.ObjectId, ref: 'Sale', required: true },
    invoiceNo: String,
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: String,
    items: { type: [salesReturnItemSchema], validate: (v: unknown[]) => v.length > 0 },
    reason: { type: String, required: true },
    totalAmount: { type: Number, required: true },
    /** Portion that reduced the invoice's outstanding balance. */
    adjustedAgainstDue: { type: Number, default: 0 },
    refundAmount: { type: Number, default: 0 },
    refundMethod: String,
    refundPayment: { type: Schema.Types.ObjectId, ref: 'CustomerPayment' },
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
salesReturnSchema.index({ returnNo: 1 }, { unique: true });
salesReturnSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });
salesReturnSchema.index({ sale: 1 });
salesReturnSchema.index({ date: -1 });

const purchaseReturnItemSchema = new Schema(
  {
    purchaseItemId: { type: Schema.Types.ObjectId, required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String,
    qty: { type: Number, required: true, min: 0 },
    /** Value billed by vendor for these units (credit note value). */
    amount: { type: Number, required: true },
    landedUnitCost: { type: Number, default: 0 },
    costTotal: { type: Number, default: 0 },
    serials: [String],
  },
  { _id: false },
);

const purchaseReturnSchema = new Schema(
  {
    returnNo: { type: String, required: true },
    clientRequestId: String,
    date: { type: Date, required: true },
    purchase: { type: Schema.Types.ObjectId, ref: 'Purchase', required: true },
    purchaseNo: String,
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorName: String,
    items: { type: [purchaseReturnItemSchema], validate: (v: unknown[]) => v.length > 0 },
    reason: { type: String, required: true },
    totalAmount: { type: Number, required: true },
    adjustedAgainstDue: { type: Number, default: 0 },
    /** Remainder handling: refund received now, or kept as vendor credit (advance). */
    settlement: { type: String, enum: ['REFUND', 'CREDIT_NOTE'], default: 'CREDIT_NOTE' },
    refundAmount: { type: Number, default: 0 },
    refundMethod: String,
    creditNoteAmount: { type: Number, default: 0 },
    /** Difference between vendor credit and inventory cost removed (charges/tax not refunded). */
    costVariance: { type: Number, default: 0 },
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
purchaseReturnSchema.index({ returnNo: 1 }, { unique: true });
purchaseReturnSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });
purchaseReturnSchema.index({ purchase: 1 });
purchaseReturnSchema.index({ date: -1 });

export type SalesReturn = InferSchemaType<typeof salesReturnSchema>;
export type PurchaseReturn = InferSchemaType<typeof purchaseReturnSchema>;
export const SalesReturnModel = model('SalesReturn', salesReturnSchema);
export const PurchaseReturnModel = model('PurchaseReturn', purchaseReturnSchema);
