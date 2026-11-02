import { Schema, model, type InferSchemaType } from 'mongoose';

const expensePaymentSchema = new Schema({
  date: { type: Date, required: true },
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, required: true },
  reference: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
});

const expenseSchema = new Schema(
  {
    expenseNo: { type: String, required: true },
    clientRequestId: String,
    date: { type: Date, required: true },
    category: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
    categoryName: String,
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    paidTo: { type: String, trim: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    /** Payments against this expense. An expense with amountPaid < amount is an outstanding payable. */
    payments: { type: [expensePaymentSchema], default: [] },
    amountPaid: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['PAID', 'PARTIAL', 'UNPAID'], required: true },
    attachmentRef: String,
    notes: String,
    status: { type: String, enum: ['ACTIVE', 'CANCELLED'], default: 'ACTIVE' },
    cancelledAt: Date,
    cancelReason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdByName: String,
  },
  { timestamps: true },
);

expenseSchema.index({ expenseNo: 1 }, { unique: true });
expenseSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true });
expenseSchema.index({ date: -1, status: 1 });
expenseSchema.index({ category: 1, date: -1 });

export type Expense = InferSchemaType<typeof expenseSchema>;
export const ExpenseModel = model('Expense', expenseSchema);
