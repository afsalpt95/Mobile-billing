import {
  BrandModel,
  CustomerModel,
  DeviceCategoryModel,
  DeviceModelModel,
  ExpenseCategoryModel,
  PaymentMethodModel,
  ProductCategoryModel,
  ProductModel,
  ShopSettingsModel,
  UserModel,
  VendorTypeModel,
} from '../models';
import { invalidateSettingsCache, nextNumber } from '../services/settings.service';
import { hashPassword } from '../services/user.service';

/**
 * Idempotent seed of master data + a development admin. Creates NO transactions, so all
 * dashboard figures start at zero and come only from real postings.
 */
export async function seedDefaults(admin: { username: string; password: string }) {
  const upsertNames = async (model: any, names: Array<string | Record<string, unknown>>) => {
    let i = 0;
    for (const n of names) {
      const doc = typeof n === 'string' ? { name: n } : n;
      await model.updateOne({ name: doc.name }, { $setOnInsert: { ...doc, sortOrder: i++ } }, { upsert: true, collation: { locale: 'en', strength: 2 } });
    }
  };

  await upsertNames(PaymentMethodModel, [
    { name: 'Cash', kind: 'CASH' },
    { name: 'UPI', kind: 'DIGITAL' },
    { name: 'Card', kind: 'CARD' },
    { name: 'Bank Transfer', kind: 'BANK' },
    { name: 'Other', kind: 'OTHER' },
  ]);
  await upsertNames(DeviceCategoryModel, ['Mobile Phone', 'Tablet', 'Smartwatch', 'Accessories', 'Spare Parts', 'Other']);
  await upsertNames(ProductCategoryModel, [
    'Mobile Phones',
    'Tablets',
    'Smartwatches',
    'Spare Parts',
    'Chargers',
    'Cables',
    'Cases & Covers',
    'Screen Protectors',
    'Audio',
    'Other Accessories',
    'Repair Consumables',
    'Services',
  ]);
  await upsertNames(BrandModel, ['Samsung', 'Apple', 'Xiaomi', 'Vivo', 'Oppo', 'Realme', 'OnePlus', 'Motorola', 'Nokia', 'Generic']);
  await upsertNames(ExpenseCategoryModel, [
    'Shop Rent',
    'Electricity',
    'Internet and Telephone',
    'Staff Salary',
    'Transport',
    'Packaging',
    'Repair Tools',
    'Maintenance',
    'Bank Charges',
    'Office Supplies',
    'Other Expenses',
  ]);
  await upsertNames(VendorTypeModel, ['Distributor', 'Wholesaler', 'Spare Parts Dealer', 'Accessories Supplier', 'Service Provider']);

  // A few common device models (editable master data).
  const phone = await DeviceCategoryModel.findOne({ name: 'Mobile Phone' }).lean();
  const models: Record<string, string[]> = {
    Samsung: ['Galaxy A15', 'Galaxy A35', 'Galaxy S24', 'Galaxy M34'],
    Apple: ['iPhone 13', 'iPhone 14', 'iPhone 15'],
    Xiaomi: ['Redmi Note 13', 'Redmi 13C'],
    Vivo: ['Y28', 'V30'],
    Oppo: ['A79', 'Reno 11'],
    Realme: ['Narzo 70', 'Realme 12'],
    OnePlus: ['Nord CE 4', 'OnePlus 12'],
    Motorola: ['G54', 'Edge 50'],
  };
  for (const [brandName, list] of Object.entries(models)) {
    const brand = await BrandModel.findOne({ name: brandName }).lean();
    if (!brand) continue;
    for (const name of list) {
      await DeviceModelModel.updateOne(
        { brand: brand._id, name },
        { $setOnInsert: { brand: brand._id, name, deviceCategory: phone?._id } },
        { upsert: true, collation: { locale: 'en', strength: 2 } },
      );
    }
  }

  // Walk-in customer + settings
  let walkIn = await CustomerModel.findOne({ isWalkIn: true }).lean();
  if (!walkIn) walkIn = (await CustomerModel.create({ name: 'Walk-in Customer', isWalkIn: true, notes: 'Used for cash sales without customer details' })).toObject();
  await ShopSettingsModel.updateOne({ key: 'default' }, { $setOnInsert: { key: 'default' } }, { upsert: true });
  await ShopSettingsModel.updateOne({ key: 'default', 'billing.walkInCustomer': { $exists: false } }, { $set: { 'billing.walkInCustomer': walkIn._id } });
  invalidateSettingsCache();

  // Common repair services as non-stock service items.
  const services = await ProductCategoryModel.findOne({ name: 'Services' }).lean();
  for (const name of ['Screen Replacement', 'Battery Replacement', 'Charging Port Repair', 'Software Service', 'Diagnostics', 'General Repair']) {
    if (await ProductModel.exists({ name, productType: 'SERVICE' })) continue;
    await ProductModel.create({
      productCode: await nextNumber('product'),
      name,
      productType: 'SERVICE',
      category: services?._id,
      trackInventory: false,
      sellingPrice: 0,
      minStock: 0,
    });
  }

  // Development admin
  let created = false;
  if (!(await UserModel.exists({ username: admin.username.toLowerCase() }))) {
    await UserModel.create({ name: 'Administrator', username: admin.username, role: 'ADMIN', passwordHash: await hashPassword(admin.password) });
    created = true;
  }
  return { adminCreated: created, walkInCustomerId: String(walkIn._id) };
}
