import { Schema, model, type InferSchemaType } from 'mongoose';

export const PRODUCT_TYPES = ['PHONE', 'SPARE_PART', 'ACCESSORY', 'CONSUMABLE', 'SERVICE', 'OTHER'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

const productSchema = new Schema(
  {
    productCode: { type: String, required: true, unique: true },
    sku: { type: String, trim: true },
    barcode: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    productType: { type: String, enum: PRODUCT_TYPES, required: true },
    category: { type: Schema.Types.ObjectId, ref: 'ProductCategory' },
    deviceCategory: { type: Schema.Types.ObjectId, ref: 'DeviceCategory' },
    brand: { type: Schema.Types.ObjectId, ref: 'Brand' },
    deviceModel: { type: Schema.Types.ObjectId, ref: 'DeviceModel' },
    description: { type: String, trim: true },
    /** Last purchase unit cost (informational). */
    purchaseCost: { type: Number, default: 0, min: 0 },
    /** Weighted-average unit cost - the cost basis used for COGS. */
    avgCost: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, min: 0, max: 100 },
    stockQty: { type: Number, default: 0 },
    damagedQty: { type: Number, default: 0, min: 0 },
    minStock: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: 'pcs', trim: true },
    preferredVendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    warrantyMonths: { type: Number, default: 0, min: 0 },
    trackSerial: { type: Boolean, default: false },
    /** false for service items - no stock is maintained. */
    trackInventory: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

productSchema.index({ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: 'string', $gt: '' } } });
productSchema.index({ barcode: 1 }, { unique: true, partialFilterExpression: { barcode: { $type: 'string', $gt: '' } } });
productSchema.index({ name: 'text', sku: 'text', barcode: 'text', productCode: 'text' });
productSchema.index({ productType: 1, isActive: 1 });
productSchema.index({ category: 1 });
productSchema.index({ brand: 1, deviceModel: 1 });

export type Product = InferSchemaType<typeof productSchema>;
export const ProductModel = model('Product', productSchema);
