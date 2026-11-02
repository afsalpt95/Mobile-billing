import { Schema, model, type InferSchemaType } from 'mongoose';

const customerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, trim: true },
    altMobile: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    notes: { type: String, trim: true },
    isWalkIn: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    /** Cached outstanding balance: positive = customer owes the shop, negative = advance held. Maintained only via ledger postings. */
    balance: { type: Number, default: 0 },
    totalSales: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    lastPurchaseAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

customerSchema.index({ mobile: 1 });
customerSchema.index({ name: 'text', mobile: 'text' });
customerSchema.index({ balance: -1 });

export type Customer = InferSchemaType<typeof customerSchema>;
export const CustomerModel = model('Customer', customerSchema);
