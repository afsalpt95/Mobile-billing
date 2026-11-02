import { Schema, model, type InferSchemaType } from 'mongoose';

const methodSplitSchema = new Schema(
  {
    method: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    reference: String,
  },
  { _id: false },
);

const allocationSchema = new Schema(
  {
    sale: { type: Schema.Types.ObjectId, ref: 'Sale', required: true },
    invoiceNo: String,
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

/**
 * Money received from (RECEIPT / ADVANCE) or paid back to (REFUND) a customer.
 * This is the single source for customer cash movements (SalePayment + CustomerPayment combined):
 * a payment taken at the counter while billing is a RECEIPT allocated to that invoice.
 */
const customerPaymentSchema = new Schema(
  {
    receiptNo: { type: String, required: true },
    clientRequestId: String,
    type: { type: String, enum: ['RECEIPT', 'ADVANCE', 'REFUND'], required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: String,
    date: { type: Date, required: true, default: Date.now },
    amount: { type: Number, required: true, min: 0 },
    methods: { type: [methodSplitSchema], default: [] },
    allocations: { type: [allocationSchema], default: [] },
    /** Portion of an ADVANCE not yet applied to an invoice. */
    unallocated: { type: Number, default: 0 },
    repairJob: { type: Schema.Types.ObjectId, ref: 'RepairJob' },
    source: { type: String, enum: ['SALE', 'CREDIT_PAYMENT', 'REPAIR_ADVANCE', 'SALE_CANCEL', 'SALE_RETURN', 'REPAIR_CANCEL'] },
    refId: { type: Schema.Types.ObjectId },
    notes: String,
    status: { type: String, enum: ['ACTIVE', 'CANCELLED'], default: 'ACTIVE' },
    cancelledAt: Date,
    cancelReason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

customerPaymentSchema.index({ receiptNo: 1 }, { unique: true });
customerPaymentSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });
customerPaymentSchema.index({ customer: 1, date: -1 });
customerPaymentSchema.index({ date: -1 });
customerPaymentSchema.index({ 'allocations.sale': 1 });

export type CustomerPayment = InferSchemaType<typeof customerPaymentSchema>;
export const CustomerPaymentModel = model('CustomerPayment', customerPaymentSchema);
