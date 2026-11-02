import { Schema, model } from 'mongoose';

/** Atomic sequence counters for document numbering. */
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
export const CounterModel = model('Counter', counterSchema);

const auditLogSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    refNo: String,
    summary: String,
    data: Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: false },
);
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ entity: 1, entityId: 1 });
export const AuditLogModel = model('AuditLog', auditLogSchema);
