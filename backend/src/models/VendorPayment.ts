import { Schema, model, type InferSchemaType } from 'mongoose';

const allocationSchema = new Schema(
  {
    purchase: { type: Schema.Types.ObjectId, ref: 'Purchase', required: true },
    purchaseNo: String,
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

/**
 * PAYMENT          - money paid to the vendor; allocated to purchases; any excess becomes an advance.
 * ADVANCE_APPLIED  - an existing advance / credit note applied to purchases (no money moves).
 * REFUND_RECEIVED  - vendor refunded part of an advance / credit note in cash.
 */
const vendorPaymentSchema = new Schema(
  {
    paymentNo: { type: String, required: true },
    clientRequestId: String,
    type: { type: String, enum: ['PAYMENT', 'ADVANCE_APPLIED', 'REFUND_RECEIVED'], default: 'PAYMENT' },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    vendorName: String,
    date: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    method: String,
    reference: String,
    allocationMode: { type: String, enum: ['OLDEST_FIRST', 'MANUAL'], default: 'MANUAL' },
    allocations: { type: [allocationSchema], default: [] },
    advanceAmount: { type: Number, default: 0 },
    notes: String,
    status: { type: String, enum: ['ACTIVE', 'CANCELLED'], default: 'ACTIVE' },
    cancelledAt: Date,
    cancelReason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

vendorPaymentSchema.index({ paymentNo: 1 }, { unique: true });
vendorPaymentSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });
vendorPaymentSchema.index({ vendor: 1, date: -1 });
vendorPaymentSchema.index({ date: -1 });
vendorPaymentSchema.index({ 'allocations.purchase': 1 });

export type VendorPayment = InferSchemaType<typeof vendorPaymentSchema>;
export const VendorPaymentModel = model('VendorPayment', vendorPaymentSchema);
