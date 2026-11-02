import { Schema, model, type Model } from 'mongoose';

/**
 * Simple editable master-data collections. All are soft-deactivated (isActive) rather than deleted
 * so historical documents keep valid references.
 */
function masterSchema(extra: Record<string, unknown> = {}) {
  const schema = new Schema(
    {
      name: { type: String, required: true, trim: true },
      description: { type: String, trim: true },
      isActive: { type: Boolean, default: true },
      sortOrder: { type: Number, default: 0 },
      ...extra,
    },
    { timestamps: true },
  );
  return schema;
}

const caseInsensitive = { locale: 'en', strength: 2 };

const productCategorySchema = masterSchema();
productCategorySchema.index({ name: 1 }, { unique: true, collation: caseInsensitive });

const deviceCategorySchema = masterSchema();
deviceCategorySchema.index({ name: 1 }, { unique: true, collation: caseInsensitive });

const brandSchema = masterSchema();
brandSchema.index({ name: 1 }, { unique: true, collation: caseInsensitive });

const deviceModelSchema = masterSchema({
  brand: { type: Schema.Types.ObjectId, ref: 'Brand', required: true },
  deviceCategory: { type: Schema.Types.ObjectId, ref: 'DeviceCategory' },
});
deviceModelSchema.index({ brand: 1, name: 1 }, { unique: true, collation: caseInsensitive });

const expenseCategorySchema = masterSchema({
  /** OPERATING expenses reduce operating profit; OTHER are shown below net operating profit. */
  kind: { type: String, enum: ['OPERATING', 'OTHER'], default: 'OPERATING' },
});
expenseCategorySchema.index({ name: 1 }, { unique: true, collation: caseInsensitive });

const vendorTypeSchema = masterSchema();
vendorTypeSchema.index({ name: 1 }, { unique: true, collation: caseInsensitive });

const paymentMethodSchema = masterSchema({
  /** CASH methods can produce change due on overpayment. */
  kind: { type: String, enum: ['CASH', 'DIGITAL', 'CARD', 'BANK', 'OTHER'], default: 'OTHER' },
});
paymentMethodSchema.index({ name: 1 }, { unique: true, collation: caseInsensitive });

export const ProductCategoryModel = model('ProductCategory', productCategorySchema);
export const DeviceCategoryModel = model('DeviceCategory', deviceCategorySchema);
export const BrandModel = model('Brand', brandSchema);
export const DeviceModelModel = model('DeviceModel', deviceModelSchema);
export const ExpenseCategoryModel = model('ExpenseCategory', expenseCategorySchema);
export const VendorTypeModel = model('VendorType', vendorTypeSchema);
export const PaymentMethodModel = model('PaymentMethod', paymentMethodSchema);

export const MASTER_MODELS: Record<string, { model: Model<any>; label: string; populate?: string[] }> = {
  'product-categories': { model: ProductCategoryModel, label: 'Product category' },
  categories: { model: ProductCategoryModel, label: 'Product category' },
  'device-categories': { model: DeviceCategoryModel, label: 'Device category' },
  brands: { model: BrandModel, label: 'Brand' },
  'device-models': { model: DeviceModelModel, label: 'Device model', populate: ['brand', 'deviceCategory'] },
  'expense-categories': { model: ExpenseCategoryModel, label: 'Expense category' },
  'vendor-types': { model: VendorTypeModel, label: 'Vendor type' },
  'payment-methods': { model: PaymentMethodModel, label: 'Payment method' },
};
