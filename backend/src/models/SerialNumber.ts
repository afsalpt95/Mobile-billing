import { Schema, model, type InferSchemaType } from 'mongoose';

export const SERIAL_STATUSES = ['IN_STOCK', 'SOLD', 'RETURNED_TO_VENDOR', 'DAMAGED', 'CANCELLED'] as const;

/** IMEI / serial number tracking for serial-tracked products. */
const serialSchema = new Schema(
  {
    serial: { type: String, required: true, trim: true, uppercase: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    status: { type: String, enum: SERIAL_STATUSES, default: 'IN_STOCK' },
    unitCost: { type: Number, default: 0 },
    purchase: { type: Schema.Types.ObjectId, ref: 'Purchase' },
    purchaseNo: String,
    sale: { type: Schema.Types.ObjectId, ref: 'Sale' },
    invoiceNo: String,
    soldAt: Date,
  },
  { timestamps: true },
);

serialSchema.index({ serial: 1 }, { unique: true });
serialSchema.index({ product: 1, status: 1 });

export type SerialNumber = InferSchemaType<typeof serialSchema>;
export const SerialNumberModel = model('SerialNumber', serialSchema);
