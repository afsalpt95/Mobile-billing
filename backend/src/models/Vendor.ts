import { Schema, model, type InferSchemaType } from 'mongoose';

const vendorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    mobile: { type: String, trim: true },
    altMobile: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    taxId: { type: String, trim: true },
    vendorType: { type: Schema.Types.ObjectId, ref: 'VendorType' },
    paymentTermsDays: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    /** Outstanding payable to this vendor (sum of unpaid purchase balances). */
    balance: { type: Number, default: 0 },
    /** Money paid in advance / credit notes not yet applied. Tracked separately from liabilities. */
    advanceBalance: { type: Number, default: 0 },
    totalPurchases: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    lastPaymentAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

vendorSchema.index({ mobile: 1 });
vendorSchema.index({ name: 'text', mobile: 'text', contactPerson: 'text' });

export type Vendor = InferSchemaType<typeof vendorSchema>;
export const VendorModel = model('Vendor', vendorSchema);
