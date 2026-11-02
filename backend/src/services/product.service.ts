import { Types } from 'mongoose';
import { ProductModel, SerialNumberModel, StockAdjustmentModel, StockMovementModel, type ProductType } from '../models';
import type { AuthUser } from '../types';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { round } from '../utils/money';
import { escapeRegex } from '../utils/pagination';
import { isDuplicateKeyError, withTransaction } from '../utils/transaction';
import { normaliseSerials, stockIn, stockOut } from './inventory.service';
import { getSettings, nextNumber } from './settings.service';

export interface ProductInput {
  sku?: string;
  barcode?: string;
  name: string;
  productType: ProductType;
  categoryId?: string | null;
  deviceCategoryId?: string | null;
  brandId?: string | null;
  deviceModelId?: string | null;
  description?: string;
  purchaseCost?: number;
  sellingPrice?: number;
  taxRate?: number | null;
  minStock?: number;
  unit?: string;
  preferredVendorId?: string | null;
  warrantyMonths?: number;
  trackSerial?: boolean;
  isActive?: boolean;
  openingStock?: { qty: number; unitCost: number; serials?: string[] };
}

function toDoc(input: Partial<ProductInput>) {
  const d: Record<string, unknown> = {};
  const map: Record<string, string> = {
    categoryId: 'category',
    deviceCategoryId: 'deviceCategory',
    brandId: 'brand',
    deviceModelId: 'deviceModel',
    preferredVendorId: 'preferredVendor',
  };
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || k === 'openingStock') continue;
    if (map[k]) d[map[k]] = v || null;
    else if (k === 'sku' || k === 'barcode') d[k] = (v as string)?.trim() || undefined;
    else d[k] = v;
  }
  if (input.productType === 'SERVICE') {
    d.trackInventory = false;
    d.trackSerial = false;
  } else if (input.productType) {
    d.trackInventory = true;
  }
  if (d.purchaseCost !== undefined) d.purchaseCost = round(d.purchaseCost as number);
  if (d.sellingPrice !== undefined) d.sellingPrice = round(d.sellingPrice as number);
  return d;
}

export async function createProduct(input: ProductInput, user: AuthUser) {
  const settings = await getSettings();
  try {
    return await withTransaction(async (session) => {
      const productCode = await nextNumber('product', session);
      const doc = await new ProductModel({
        ...toDoc(input),
        productCode,
        minStock: input.minStock ?? (input.productType === 'SERVICE' ? 0 : settings.inventory?.defaultMinStock ?? 0),
        avgCost: 0,
        stockQty: 0,
        createdBy: user.id,
      }).save({ session });

      const opening = input.openingStock;
      if (opening && opening.qty > 0) {
        if (!doc.trackInventory) throw ApiError.validation('Service items cannot have opening stock');
        const serials = normaliseSerials(opening.serials);
        if (doc.trackSerial) {
          if (serials.length !== opening.qty) throw ApiError.validation(`Enter ${opening.qty} IMEI/serial numbers for the opening stock`);
          for (const serial of serials) {
            if (await SerialNumberModel.exists({ serial }).session(session ?? null)) throw ApiError.conflict(`IMEI/serial ${serial} already exists`, 'DUPLICATE_SERIAL');
            await new SerialNumberModel({ serial, product: doc._id, status: 'IN_STOCK', unitCost: opening.unitCost }).save({ session });
          }
        }
        await stockIn(doc._id, opening.qty, opening.unitCost, 'OPENING', { refType: 'Product', refId: doc._id, refNo: productCode, userId: user.id, notes: 'Opening stock', serials }, session, {
          updatePurchaseCost: true,
        });
      }
      await audit(user, 'CREATE', 'Product', doc._id, productCode, doc.name, undefined, session);
      return ProductModel.findById(doc._id).session(session ?? null).lean();
    });
  } catch (err) {
    if (isDuplicateKeyError(err, 'sku')) throw ApiError.conflict('Another product already uses this SKU', 'DUPLICATE_SKU');
    if (isDuplicateKeyError(err, 'barcode')) throw ApiError.conflict('Another product already uses this barcode', 'DUPLICATE_BARCODE');
    throw err;
  }
}

/** Stock quantity and cost can only change through stock movements, never through an edit. */
export async function updateProduct(id: string, input: Partial<ProductInput>, user: AuthUser) {
  const product = await ProductModel.findById(id);
  if (!product) throw ApiError.notFound('Product');
  const patch = toDoc(input);
  if (input.productType && input.productType !== product.productType) {
    const toService = input.productType === 'SERVICE';
    if ((toService || product.productType === 'SERVICE') && (product.stockQty !== 0 || (await StockMovementModel.exists({ product: product._id })))) {
      throw ApiError.conflict('Cannot convert between stock and service items once stock has moved');
    }
  }
  if (input.trackSerial !== undefined && input.trackSerial !== product.trackSerial && product.stockQty !== 0) {
    throw ApiError.conflict('Serial tracking can only be changed when stock is zero');
  }
  delete patch.stockQty;
  delete patch.avgCost;
  product.set(patch);
  try {
    await product.save();
  } catch (err) {
    if (isDuplicateKeyError(err, 'sku')) throw ApiError.conflict('Another product already uses this SKU', 'DUPLICATE_SKU');
    if (isDuplicateKeyError(err, 'barcode')) throw ApiError.conflict('Another product already uses this barcode', 'DUPLICATE_BARCODE');
    throw err;
  }
  await audit(user, 'UPDATE', 'Product', product._id, product.productCode, product.name, Object.keys(patch));
  return product.toObject();
}

export interface ProductFilter {
  page: number;
  limit: number;
  q?: string;
  type?: string;
  category?: string;
  brand?: string;
  deviceModel?: string;
  lowStock?: boolean;
  inStock?: boolean;
  active?: 'true' | 'false' | 'all';
  sort?: string;
}

export function productQuery(f: Omit<ProductFilter, 'page' | 'limit'>) {
  const query: Record<string, unknown> = {};
  if (f.active !== 'all') query.isActive = f.active !== 'false';
  if (f.type) query.productType = { $in: f.type.split(',') };
  if (f.category) query.category = new Types.ObjectId(f.category);
  if (f.brand) query.brand = new Types.ObjectId(f.brand);
  if (f.deviceModel) query.deviceModel = new Types.ObjectId(f.deviceModel);
  if (f.inStock) query.stockQty = { $gt: 0 };
  if (f.lowStock) {
    query.trackInventory = true;
    query.$expr = { $lte: ['$stockQty', '$minStock'] };
  }
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q.slice(0, 100)), 'i');
    query.$or = [{ name: rx }, { sku: rx }, { barcode: rx }, { productCode: rx }];
  }
  return query;
}

export async function listProducts(f: ProductFilter) {
  const query = productQuery(f);
  const sortMap: Record<string, Record<string, 1 | -1>> = {
    name: { name: 1 },
    '-name': { name: -1 },
    stock: { stockQty: 1 },
    '-stock': { stockQty: -1 },
    '-updated': { updatedAt: -1 },
    price: { sellingPrice: 1 },
  };
  const sort = sortMap[f.sort ?? 'name'] ?? { name: 1 };
  const [items, total] = await Promise.all([
    ProductModel.find(query)
      .populate('category', 'name')
      .populate('brand', 'name')
      .populate('deviceModel', 'name')
      .populate('preferredVendor', 'name')
      .sort({ ...sort, _id: 1 })
      .skip((f.page - 1) * f.limit)
      .limit(f.limit)
      .lean(),
    ProductModel.countDocuments(query),
  ]);
  return {
    items: items.map((p) => ({ ...p, stockValue: round((p.stockQty > 0 ? p.stockQty : 0) * (p.avgCost ?? 0)), isLowStock: p.trackInventory && p.stockQty <= p.minStock })),
    total,
  };
}

export async function getProduct(id: string) {
  const p = await ProductModel.findById(id)
    .populate('category', 'name')
    .populate('brand', 'name')
    .populate('deviceModel', 'name')
    .populate('deviceCategory', 'name')
    .populate('preferredVendor', 'name')
    .lean();
  if (!p) throw ApiError.notFound('Product');
  return p;
}

/** Exact barcode / SKU / product code / IMEI lookup for the scanner. */
export async function lookupProduct(code: string) {
  const c = code.trim();
  const p = await ProductModel.findOne({ isActive: true, $or: [{ barcode: c }, { sku: c }, { productCode: c.toUpperCase() }] }).lean();
  if (p) return { product: p, serial: null };
  const serial = await SerialNumberModel.findOne({ serial: c.toUpperCase() }).lean();
  if (serial) {
    const product = await ProductModel.findById(serial.product).lean();
    return { product, serial };
  }
  throw ApiError.notFound('No product matches this code');
}

export async function listSerials(productId: string, status?: string) {
  const query: Record<string, unknown> = { product: new Types.ObjectId(productId) };
  if (status) query.status = { $in: status.split(',') };
  return SerialNumberModel.find(query).sort({ createdAt: -1 }).limit(500).lean();
}

export async function listMovements(f: { page: number; limit: number; product?: string; type?: string; from?: Date; to?: Date; q?: string }) {
  const query: Record<string, unknown> = {};
  if (f.product) query.product = new Types.ObjectId(f.product);
  if (f.type) query.type = { $in: f.type.split(',') };
  if (f.from || f.to) query.date = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q.slice(0, 100)), 'i');
    query.$or = [{ productName: rx }, { refNo: rx }, { serials: f.q.trim().toUpperCase() }];
  }
  const [items, total] = await Promise.all([
    StockMovementModel.find(query).sort({ date: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).populate('createdBy', 'name').lean(),
    StockMovementModel.countDocuments(query),
  ]);
  return { items, total };
}

export interface AdjustmentInput {
  clientRequestId?: string;
  productId: string;
  type: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'DAMAGED';
  qty: number;
  unitCost?: number;
  reason: string;
  date?: Date;
}

/** Manual stock adjustments (found / lost / damaged) - always recorded as stock movements. */
export async function createAdjustment(input: AdjustmentInput, user: AuthUser) {
  if (input.clientRequestId) {
    const existing = await StockAdjustmentModel.findOne({ clientRequestId: input.clientRequestId }).lean();
    if (existing) return { adjustment: existing, duplicate: true };
  }
  const adjustment = await withTransaction(async (session) => {
    const product = await ProductModel.findById(input.productId).session(session ?? null).lean();
    if (!product) throw ApiError.notFound('Product');
    if (!product.trackInventory) throw ApiError.validation('Service items have no stock');
    if (product.trackSerial) throw ApiError.validation('Serial-tracked items are adjusted through purchases, sales and returns so IMEIs stay accurate');
    if (!(input.qty > 0)) throw ApiError.validation('Quantity must be greater than zero');
    const id = new Types.ObjectId();
    const adjustmentNo = await nextNumber('adjustment', session);
    const date = input.date ?? new Date();
    const ref = { refType: 'StockAdjustment', refId: id, refNo: adjustmentNo, date, userId: user.id, notes: input.reason };
    let unitCost: number;
    if (input.type === 'ADJUSTMENT_IN') {
      unitCost = input.unitCost ?? product.avgCost ?? 0;
      await stockIn(product._id, input.qty, unitCost, 'ADJUSTMENT_IN', ref, session);
    } else {
      const out = await stockOut(product._id, input.qty, input.type, ref, session, { toDamaged: input.type === 'DAMAGED' });
      unitCost = out.unitCost;
    }
    const doc = await new StockAdjustmentModel({
      _id: id,
      adjustmentNo,
      clientRequestId: input.clientRequestId,
      date,
      product: product._id,
      type: input.type,
      qty: input.qty,
      unitCost,
      value: round(input.qty * unitCost),
      reason: input.reason,
      createdBy: user.id,
    }).save({ session });
    await audit(user, 'ADJUST', 'Product', product._id, adjustmentNo, `${input.type} ${input.qty} x ${product.name}: ${input.reason}`, undefined, session);
    return doc.toObject();
  });
  return { adjustment, duplicate: false };
}

export async function listAdjustments(f: { page: number; limit: number; from?: Date; to?: Date }) {
  const query: Record<string, unknown> = {};
  if (f.from || f.to) query.date = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  const [items, total] = await Promise.all([
    StockAdjustmentModel.find(query).sort({ date: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).populate('product', 'name productCode').populate('createdBy', 'name').lean(),
    StockAdjustmentModel.countDocuments(query),
  ]);
  return { items, total };
}
