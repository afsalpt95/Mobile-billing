import { ShopSettingsModel, CounterModel } from '../models';
import { setMoneyPrecision } from '../utils/money';
import type { Session } from '../utils/transaction';
import { ApiError } from '../utils/ApiError';

type SettingsDoc = NonNullable<Awaited<ReturnType<typeof loadSettings>>>;

let cache: SettingsDoc | null = null;

async function loadSettings() {
  let doc = await ShopSettingsModel.findOne({ key: 'default' }).lean();
  if (!doc) {
    try {
      await ShopSettingsModel.create({ key: 'default' });
    } catch {
      // created concurrently
    }
    doc = await ShopSettingsModel.findOne({ key: 'default' }).lean();
  }
  return doc;
}

export async function getSettings(): Promise<SettingsDoc> {
  if (cache) return cache;
  const doc = await loadSettings();
  if (!doc) throw new Error('Unable to load shop settings');
  cache = doc;
  setMoneyPrecision(doc.currencyPrecision ?? 2);
  return doc;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

/** Flattens a nested patch into dot-notation so partial nested updates do not wipe sibling fields. */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else if (v !== undefined) out[key] = v;
  }
  return out;
}

export async function updateSettings(patch: Record<string, unknown>) {
  await getSettings();
  const doc = await ShopSettingsModel.findOneAndUpdate({ key: 'default' }, { $set: flatten(patch) }, { new: true, runValidators: true }).lean();
  invalidateSettingsCache();
  return getSettings().then(() => doc);
}

export type NumberKind =
  | 'invoice'
  | 'purchase'
  | 'repair'
  | 'expense'
  | 'receipt'
  | 'vendorPayment'
  | 'salesReturn'
  | 'purchaseReturn'
  | 'adjustment'
  | 'product';

const PREFIX_FIELD: Record<NumberKind, string | null> = {
  invoice: 'invoicePrefix',
  purchase: 'purchasePrefix',
  repair: 'repairPrefix',
  expense: 'expensePrefix',
  receipt: 'receiptPrefix',
  vendorPayment: 'vendorPaymentPrefix',
  salesReturn: 'salesReturnPrefix',
  purchaseReturn: 'purchaseReturnPrefix',
  adjustment: 'adjustmentPrefix',
  product: null,
};

/**
 * Generates the next unique document number. The counter is incremented inside the caller's
 * transaction, so an aborted posting does not consume a number. Uniqueness is additionally
 * enforced by unique indexes on every number field.
 */
export async function nextNumber(kind: NumberKind, session?: Session): Promise<string> {
  const settings = await getSettings();
  const numbering = settings.numbering as unknown as Record<string, string | number>;
  const field = PREFIX_FIELD[kind];
  const prefix = field ? String(numbering?.[field] ?? '') : 'P-';
  const padding = Number(numbering?.padding ?? 6);
  const counter = await CounterModel.findOneAndUpdate({ _id: kind }, { $inc: { seq: 1 } }, { upsert: true, new: true, session });
  if (!counter) throw ApiError.conflict('Unable to generate document number');
  return `${prefix}${String(counter.seq).padStart(padding, '0')}`;
}
