import { Schema, model, type InferSchemaType } from 'mongoose';

/** PurchaseItem - embedded line. */
const purchaseItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  sku: String,
  qty: { type: Number, required: true, min: 0 },
  freeQty: { type: Number, default: 0, min: 0 },
  unitCost: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0 },
  taxRate: { type: Number, default: 0, min: 0 },
  /** qty * unitCost - discount */
  lineTotal: { type: Number, required: true },
  taxAmount: { type: Number, default: 0 },
  chargesShare: { type: Number, default: 0 },
  /** Final inventory cost per received unit (incl. allocated charges, and tax when configured). */
  landedUnitCost: { type: Number, default: 0 },
  serials: [String],
  receivedQty: { type: Number, default: 0 },
  returnedQty: { type: Number, default: 0 },
  returnedAmount: { type: Number, default: 0 },
  returnedCost: { type: Number, default: 0 },
});

const purchaseSchema = new Schema(
  {
    purchaseNo: { type: String, required: true },
    clientRequestId: String,
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorName: String,
    vendorInvoiceNo: { type: String, trim: true },
    date: { type: Date, required: true },
    dueDate: Date,
    status: { type: String, enum: ['DRAFT', 'RECEIVED', 'CANCELLED'], required: true, default: 'DRAFT' },
    returnStatus: { type: String, enum: ['NONE', 'PARTIAL', 'FULL'], default: 'NONE' },
    items: { type: [purchaseItemSchema], validate: (v: unknown[]) => v.length > 0 },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    shippingCharges: { type: Number, default: 0 },
    otherCharges: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    returnedAmount: { type: Number, default: 0 },
    refundReceived: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['PAID', 'PARTIAL', 'UNPAID'], default: 'UNPAID' },
    paymentTerms: String,
    /** Initial payment entered on the form (applied when the purchase is received). */
    initialPayment: {
      amount: { type: Number, default: 0 },
      method: String,
      reference: String,
    },
    notes: String,
    attachmentRef: String,
    receivedAt: Date,
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: String,
  },
  { timestamps: true },
);

purchaseSchema.index({ purchaseNo: 1 }, { unique: true });
purchaseSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });
purchaseSchema.index({ vendor: 1, date: -1 });
purchaseSchema.index({ date: -1, status: 1 });
purchaseSchema.index({ vendor: 1, vendorInvoiceNo: 1 });
purchaseSchema.index({ status: 1, balanceDue: 1, dueDate: 1 });

export type Purchase = InferSchemaType<typeof purchaseSchema>;
export const PurchaseModel = model('Purchase', purchaseSchema);
