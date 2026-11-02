import { Schema, model, type InferSchemaType } from 'mongoose';

export const REVENUE_TYPES = ['PRODUCT', 'SPARE_PART', 'LABOR'] as const;
export const WARRANTY_STATUSES = ['NONE', 'IN_WARRANTY', 'OUT_OF_WARRANTY', 'NEW_WARRANTY'] as const;

/** Sale line (SaleItem) - embedded because lines are always read and written with the invoice. */
const saleItemSchema = new Schema({
  itemType: { type: String, enum: ['PRODUCT', 'SERVICE'], required: true },
  product: { type: Schema.Types.ObjectId, ref: 'Product' },
  name: { type: String, required: true },
  category: String,
  description: String,
  /** PRODUCT = retail goods, SPARE_PART = parts billed on a repair, LABOR = service charge */
  revenueType: { type: String, enum: REVENUE_TYPES, required: true },
  isRepairPart: { type: Boolean, default: false },
  qty: { type: Number, required: true, min: 0 },
  unitPrice: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0 },
  /** qty * unitPrice - discount */
  lineTotal: { type: Number, required: true },
  billDiscountShare: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 },
  taxableAmount: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  /** taxableAmount + taxAmount */
  netTotal: { type: Number, required: true },
  /** Inventory cost recorded at sale time (weighted average). */
  unitCost: { type: Number, default: 0 },
  costTotal: { type: Number, default: 0 },
  serials: [String],
  returnedQty: { type: Number, default: 0 },
  /** Running totals already returned - the final return of a line takes the exact remainder. */
  returnedAmount: { type: Number, default: 0 },
  returnedTaxable: { type: Number, default: 0 },
  returnedTax: { type: Number, default: 0 },
  returnedCost: { type: Number, default: 0 },
  // repair / service specific
  device: {
    deviceCategory: { type: Schema.Types.ObjectId, ref: 'DeviceCategory' },
    deviceCategoryName: String,
    brand: { type: Schema.Types.ObjectId, ref: 'Brand' },
    brandName: String,
    deviceModel: { type: Schema.Types.ObjectId, ref: 'DeviceModel' },
    deviceModelName: String,
    imei: String,
  },
  complaint: String,
  sparePart: {
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    qty: Number,
    unitCost: Number,
    costTotal: Number,
    dealer: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    dealerName: String,
  },
  warranty: {
    status: { type: String, enum: WARRANTY_STATUSES, default: 'NONE' },
    startDate: Date,
    expiryDate: Date,
  },
});

const salePaymentSummarySchema = new Schema(
  {
    method: { type: String, required: true },
    amount: { type: Number, required: true },
    reference: String,
  },
  { _id: false },
);

const saleSchema = new Schema(
  {
    invoiceNo: { type: String, required: true },
    clientRequestId: { type: String },
    date: { type: Date, required: true, default: Date.now },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    customerMobile: String,
    items: { type: [saleItemSchema], validate: (v: unknown[]) => v.length > 0 },
    subtotal: { type: Number, required: true },
    itemDiscount: { type: Number, default: 0 },
    billDiscount: { type: Number, default: 0 },
    taxableAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },
    costTotal: { type: Number, default: 0 },
    /** Amount settled (payments, advances and return credits). */
    amountPaid: { type: Number, default: 0 },
    /** Value credited back through sales returns. */
    returnedAmount: { type: Number, default: 0 },
    /** Cash paid back to the customer (returns / cancellation). */
    refundedAmount: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },
    /** Cash returned to the customer at the counter (tendered - due). */
    changeDue: { type: Number, default: 0 },
    tendered: [salePaymentSummarySchema],
    paymentStatus: { type: String, enum: ['PAID', 'PARTIAL', 'UNPAID'], required: true },
    status: { type: String, enum: ['COMPLETED', 'CANCELLED'], default: 'COMPLETED' },
    returnStatus: { type: String, enum: ['NONE', 'PARTIAL', 'FULL'], default: 'NONE' },
    dueDate: Date,
    repairJob: { type: Schema.Types.ObjectId, ref: 'RepairJob' },
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: String,
  },
  { timestamps: true },
);

saleSchema.index({ invoiceNo: 1 }, { unique: true });
saleSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });
saleSchema.index({ date: -1 });
saleSchema.index({ customer: 1, date: -1 });
saleSchema.index({ status: 1, paymentStatus: 1 });
saleSchema.index({ 'items.serials': 1 });

export type Sale = InferSchemaType<typeof saleSchema>;
export const SaleModel = model('Sale', saleSchema);
