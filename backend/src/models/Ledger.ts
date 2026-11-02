import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Customer ledger: debit = amount the customer owes increases, credit = decreases.
 * Customer.balance always equals sum(debit - credit).
 */
const customerLedgerSchema = new Schema(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    date: { type: Date, required: true },
    type: {
      type: String,
      enum: ['SALE', 'PAYMENT', 'ADVANCE', 'REFUND', 'SALE_RETURN', 'SALE_CANCEL', 'PAYMENT_CANCEL', 'ADJUSTMENT'],
      required: true,
    },
    refType: { type: String, required: true },
    refId: { type: Schema.Types.ObjectId, required: true },
    refNo: String,
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
    balanceAfter: { type: Number, required: true },
    narration: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
customerLedgerSchema.index({ customer: 1, date: 1, _id: 1 });
customerLedgerSchema.index({ refId: 1 });

/**
 * Vendor ledger: credit = we owe the vendor more (purchase), debit = we owe less (payment, return).
 * Running balance = payable - advance.
 */
const vendorLedgerSchema = new Schema(
  {
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    date: { type: Date, required: true },
    type: {
      type: String,
      enum: [
        'PURCHASE',
        'PAYMENT',
        'PURCHASE_RETURN',
        'PURCHASE_CANCEL',
        'PAYMENT_CANCEL',
        'REFUND_RECEIVED',
        'ADVANCE_APPLIED',
        'ADJUSTMENT',
      ],
      required: true,
    },
    refType: { type: String, required: true },
    refId: { type: Schema.Types.ObjectId, required: true },
    refNo: String,
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
    balanceAfter: { type: Number, required: true },
    narration: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
vendorLedgerSchema.index({ vendor: 1, date: 1, _id: 1 });
vendorLedgerSchema.index({ refId: 1 });

export type CustomerLedgerEntry = InferSchemaType<typeof customerLedgerSchema>;
export type VendorLedgerEntry = InferSchemaType<typeof vendorLedgerSchema>;
export const CustomerLedgerModel = model('CustomerLedgerEntry', customerLedgerSchema);
export const VendorLedgerModel = model('VendorLedgerEntry', vendorLedgerSchema);
