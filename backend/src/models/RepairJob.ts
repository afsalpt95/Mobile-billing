import { Schema, model, type InferSchemaType } from 'mongoose';

export const REPAIR_STATUSES = [
  'RECEIVED',
  'DIAGNOSIS_PENDING',
  'WAITING_APPROVAL',
  'WAITING_PARTS',
  'IN_PROGRESS',
  'READY_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];

/** RepairPartUsage - embedded. `consumed` guards against double stock deduction. */
const repairPartSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  name: String,
  qty: { type: Number, required: true, min: 0 },
  unitPrice: { type: Number, default: 0, min: 0 },
  unitCost: { type: Number, default: 0 },
  consumed: { type: Boolean, default: false },
  consumedAt: Date,
});

const statusHistorySchema = new Schema(
  {
    status: { type: String, enum: REPAIR_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    note: String,
  },
  { _id: false },
);

const repairJobSchema = new Schema(
  {
    jobNo: { type: String, required: true },
    clientRequestId: String,
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: String,
    contactNumber: { type: String, trim: true },
    deviceCategory: { type: Schema.Types.ObjectId, ref: 'DeviceCategory' },
    deviceCategoryName: String,
    brand: { type: Schema.Types.ObjectId, ref: 'Brand' },
    brandName: String,
    deviceModel: { type: Schema.Types.ObjectId, ref: 'DeviceModel' },
    deviceModelName: String,
    imei: { type: String, trim: true },
    conditionAtReceipt: String,
    accessoriesReceived: String,
    complaint: { type: String, required: true },
    diagnosis: String,
    estimatedCost: { type: Number, default: 0 },
    approvedCost: { type: Number, default: 0 },
    technician: { type: Schema.Types.ObjectId, ref: 'User' },
    technicianName: String,
    receivedAt: { type: Date, required: true, default: Date.now },
    expectedDeliveryAt: Date,
    status: { type: String, enum: REPAIR_STATUSES, default: 'RECEIVED' },
    statusHistory: { type: [statusHistorySchema], default: [] },
    parts: { type: [repairPartSchema], default: [] },
    laborCharge: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    /** Sum of active advance receipts. */
    advancePaid: { type: Number, default: 0 },
    warrantyType: { type: String, enum: ['NONE', 'PARTS', 'LABOR', 'FULL'], default: 'NONE' },
    warrantyDays: { type: Number, default: 0, min: 0 },
    warrantyExpiry: Date,
    internalNotes: String,
    customerNotes: String,
    /** Final invoice; set exactly once when the job is completed. */
    sale: { type: Schema.Types.ObjectId, ref: 'Sale' },
    invoiceNo: String,
    completedAt: Date,
    deliveredAt: Date,
    cancelReason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

repairJobSchema.index({ jobNo: 1 }, { unique: true });
repairJobSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });
repairJobSchema.index({ status: 1, receivedAt: -1 });
repairJobSchema.index({ customer: 1, receivedAt: -1 });
repairJobSchema.index({ imei: 1 });
repairJobSchema.index({ contactNumber: 1 });

export type RepairJob = InferSchemaType<typeof repairJobSchema>;
export const RepairJobModel = model('RepairJob', repairJobSchema);
