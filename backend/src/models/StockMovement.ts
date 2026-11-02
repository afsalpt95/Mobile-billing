import { Schema, model, type InferSchemaType } from 'mongoose';

export const MOVEMENT_TYPES = [
  'OPENING',
  'PURCHASE',
  'PURCHASE_CANCEL',
  'PURCHASE_RETURN',
  'SALE',
  'SALE_CANCEL',
  'SALE_RETURN',
  'SALE_RETURN_DAMAGED',
  'REPAIR_CONSUMPTION',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'DAMAGED',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Immutable stock ledger. Every change to Product.stockQty / damagedQty is written here together
 * with the source document reference (refType/refId/refNo).
 */
const stockMovementSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: String,
    date: { type: Date, required: true, default: Date.now },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    /** Signed change to sellable stock (+ in, - out). */
    qty: { type: Number, required: true },
    /** Signed change to damaged stock. */
    damagedQty: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
    /** qty * unitCost (absolute value of stock moved) */
    value: { type: Number, default: 0 },
    balanceAfter: { type: Number, required: true },
    avgCostAfter: { type: Number, default: 0 },
    refType: { type: String, required: true },
    refId: { type: Schema.Types.ObjectId, required: true },
    refNo: String,
    serials: [String],
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

stockMovementSchema.index({ product: 1, date: -1 });
stockMovementSchema.index({ refId: 1 });
stockMovementSchema.index({ date: -1, type: 1 });

export type StockMovement = InferSchemaType<typeof stockMovementSchema>;
export const StockMovementModel = model('StockMovement', stockMovementSchema);

const stockAdjustmentSchema = new Schema(
  {
    adjustmentNo: { type: String, required: true, unique: true },
    clientRequestId: { type: String },
    date: { type: Date, required: true, default: Date.now },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGED'], required: true },
    qty: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
    reason: { type: String, required: true, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
stockAdjustmentSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });
stockAdjustmentSchema.index({ date: -1 });

export const StockAdjustmentModel = model('StockAdjustment', stockAdjustmentSchema);
