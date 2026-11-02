/**
 * End-to-end business workflow tests against a real MongoDB replica set (transactions enabled).
 * The scenarios run in order and share state, mirroring a day of shop operations.
 *
 * Expected figures (tax disabled, weighted-average cost):
 *   Purchase: 10 chargers @100 + 5 screens @500, shipping 350 (split 100/250) -> landed 110 / 550, total 3850
 */
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CustomerLedgerModel,
  CustomerModel,
  ProductModel,
  PurchaseModel,
  SaleModel,
  StockMovementModel,
  VendorModel,
} from '../src/models';
import { api, expectOk, masterId, rid, setupDatabase, teardownDatabase, type Tokens } from './helpers';

let t: Tokens;
const s: Record<string, any> = {};

beforeAll(async () => {
  t = await setupDatabase('pos_test_workflows');
});
afterAll(async () => {
  await teardownDatabase();
});

const stockOf = async (id: string) => (await ProductModel.findById(id).lean())!.stockQty;

describe('master data & quick-create (scenarios 1, 2)', () => {
  it('creates a customer from the billing dropdown and warns about duplicate mobiles', async () => {
    const cashier = api(t.cashier);
    s.customer = expectOk(await cashier.post('/customers', { name: 'Ravi Kumar', mobile: '98765 43210' }));
    expect(s.customer.mobile).toBe('9876543210');
    const dup = await cashier.post('/customers', { name: 'Ravi K', mobile: '9876543210' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_MOBILE');
    const search = expectOk(await cashier.get('/customers?q=ravi'));
    expect(search.items.map((c: any) => c._id)).toContain(s.customer._id);
  });

  it('creates device category, brand and model from their dropdowns', async () => {
    const cashier = api(t.cashier);
    const cat = expectOk(await cashier.post('/device-categories', { name: 'Foldable' }));
    const brand = expectOk(await cashier.post('/brands', { name: 'Nothing' }));
    const model = expectOk(await cashier.post('/device-models', { name: 'Phone (2a)', brand: brand._id, deviceCategory: cat._id }));
    expect(model.brand).toBe(brand._id);
    expect((await cashier.post('/brands', { name: 'nothing' })).status).toBe(409); // case-insensitive unique
    const models = expectOk(await cashier.get(`/device-models?brand=${brand._id}`));
    expect(models).toHaveLength(1);
    s.device = { deviceCategoryId: cat._id, brandId: brand._id, deviceModelId: model._id };
  });

  it('creates products and a vendor', async () => {
    const admin = api(t.admin);
    s.charger = expectOk(await admin.post('/products', { name: 'Fast Charger 25W', productType: 'ACCESSORY', sellingPrice: 250, sku: 'CHG-25W', minStock: 2 }));
    s.screen = expectOk(await admin.post('/products', { name: 'Galaxy A15 Display', productType: 'SPARE_PART', sellingPrice: 1200, minStock: 2 }));
    s.phone = expectOk(await admin.post('/products', { name: 'Galaxy A15 128GB', productType: 'PHONE', sellingPrice: 15000, trackSerial: true }));
    s.caseItem = expectOk(await admin.post('/products', { name: 'Silicone Case', productType: 'ACCESSORY', sellingPrice: 199, minStock: 3 }));
    s.vendor = expectOk(await api(t.accountant).post('/vendors', { name: 'Metro Distributors', mobile: '9000000001', paymentTermsDays: 15 }));
    expect(s.charger.productCode).toMatch(/^P-/);
    expect((await admin.post('/products', { name: 'Dup', productType: 'ACCESSORY', sku: 'CHG-25W' })).status).toBe(409);
  });
});

describe('purchases and vendor credit (scenarios 5, 6, 7)', () => {
  it('receives a credit purchase: stock up, landed cost, vendor payable', async () => {
    const acc = api(t.accountant);
    s.purchase = expectOk(
      await acc.post('/purchases', {
        clientRequestId: rid(),
        vendorId: s.vendor._id,
        vendorInvoiceNo: 'MD-1001',
        items: [
          { productId: s.charger._id, qty: 10, unitCost: 100 },
          { productId: s.screen._id, qty: 5, unitCost: 500 },
        ],
        shippingCharges: 350,
        initialPayment: { amount: 1000, method: 'Cash' },
        receive: true,
      }),
    );
    expect(s.purchase.status).toBe('RECEIVED');
    expect(s.purchase.grandTotal).toBe(3850);
    expect(s.purchase.amountPaid).toBe(1000);
    expect(s.purchase.balanceDue).toBe(2850);
    expect(s.purchase.paymentStatus).toBe('PARTIAL');

    const charger = await ProductModel.findById(s.charger._id).lean();
    const screen = await ProductModel.findById(s.screen._id).lean();
    expect(charger!.stockQty).toBe(10);
    expect(charger!.avgCost).toBe(110);
    expect(screen!.stockQty).toBe(5);
    expect(screen!.avgCost).toBe(550);
    // phones on a separate, fully paid invoice
    const phones = expectOk(
      await acc.post('/purchases', {
        clientRequestId: rid(),
        vendorId: s.vendor._id,
        vendorInvoiceNo: 'MD-1002',
        items: [{ productId: s.phone._id, qty: 2, unitCost: 10000, serials: ['356000000000011', '356000000000029'] }],
        initialPayment: { amount: 20000, method: 'Bank Transfer' },
        receive: true,
      }),
    );
    expect(phones.paymentStatus).toBe('PAID');
    expect(await stockOf(s.phone._id)).toBe(2);

    const vendor = await VendorModel.findById(s.vendor._id).lean();
    expect(vendor!.balance).toBe(2850);
    const credit = expectOk(await acc.get('/vendor-credit'));
    expect(credit.find((v: any) => v._id === s.vendor._id).outstanding).toBe(2850);
  });

  it('rejects the same vendor invoice number twice and never receives twice', async () => {
    const acc = api(t.accountant);
    const dup = await acc.post('/purchases', { vendorId: s.vendor._id, vendorInvoiceNo: 'MD-1001', items: [{ productId: s.charger._id, qty: 1, unitCost: 100 }] });
    expect(dup.status).toBe(409);
    const again = await acc.post(`/purchases/${s.purchase._id}/receive`);
    expect(again.status).toBe(409);
    expect(await stockOf(s.charger._id)).toBe(10);
  });

  it('records a partial vendor payment and keeps the remaining balance', async () => {
    const acc = api(t.accountant);
    const pay = expectOk(await acc.post('/vendor-payments', { clientRequestId: rid(), vendorId: s.vendor._id, amount: 850, method: 'Bank Transfer', allocationMode: 'OLDEST_FIRST' }));
    expect(pay.allocations[0].amount).toBe(850);
    const p = await PurchaseModel.findById(s.purchase._id).lean();
    expect(p!.balanceDue).toBe(2000);
    expect((await VendorModel.findById(s.vendor._id).lean())!.balance).toBe(2000);
    // over-payment without the advance flag is refused
    const over = await acc.post('/vendor-payments', { vendorId: s.vendor._id, amount: 999999, method: 'Cash' });
    expect(over.status).toBe(422);
    const ledger = expectOk(await acc.get(`/vendors/${s.vendor._id}/ledger`));
    expect(ledger.closing).toBe(2000);
  });
});

describe('billing (scenarios 3, 4, 8, 17)', () => {
  it('completes a cash sale with change due and deducts stock at average cost', async () => {
    const cashier = api(t.cashier);
    s.cashSaleReq = rid();
    s.cashSale = expectOk(
      await cashier.post('/sales', {
        clientRequestId: s.cashSaleReq,
        items: [{ itemType: 'PRODUCT', productId: s.charger._id, qty: 2, unitPrice: 250 }],
        payments: [{ method: 'Cash', amount: 600 }],
      }),
    );
    expect(s.cashSale.invoiceNo).toMatch(/^INV-/);
    expect(s.cashSale.grandTotal).toBe(500);
    expect(s.cashSale.amountPaid).toBe(500);
    expect(s.cashSale.changeDue).toBe(100);
    expect(s.cashSale.paymentStatus).toBe('PAID');
    expect(s.cashSale.costTotal).toBe(220);
    expect(await stockOf(s.charger._id)).toBe(8);
    const mv = await StockMovementModel.find({ refId: s.cashSale._id }).lean();
    expect(mv).toHaveLength(1);
    expect(mv[0].qty).toBe(-2);
  });

  it('is idempotent: the same submission never creates a second invoice or stock movement', async () => {
    const cashier = api(t.cashier);
    const body = { clientRequestId: s.cashSaleReq, items: [{ itemType: 'PRODUCT', productId: s.charger._id, qty: 2, unitPrice: 250 }], payments: [{ method: 'Cash', amount: 600 }] };
    const again = await cashier.post('/sales', body);
    expect(again.status).toBe(200);
    expect(again.body.meta.duplicate).toBe(true);
    expect(again.body.data.invoiceNo).toBe(s.cashSale.invoiceNo);

    // concurrent double-click
    const reqId = rid();
    const parallel = await Promise.all(
      [1, 2, 3].map(() =>
        cashier.post('/sales', { clientRequestId: reqId, items: [{ itemType: 'PRODUCT', productId: s.charger._id, qty: 1, unitPrice: 250 }], payments: [{ method: 'Cash', amount: 250 }] }),
      ),
    );
    const ids = new Set(parallel.map((r) => r.body.data?._id));
    expect(parallel.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(ids.size).toBe(1);
    expect(await SaleModel.countDocuments({ clientRequestId: reqId })).toBe(1);
    expect(await stockOf(s.charger._id)).toBe(7);
    s.parallelSale = parallel[0].body.data;
  });

  it('records a partial-payment sale as customer credit', async () => {
    const cashier = api(t.cashier);
    s.creditSale = expectOk(
      await cashier.post('/sales', {
        clientRequestId: rid(),
        customerId: s.customer._id,
        items: [{ itemType: 'PRODUCT', productId: s.charger._id, qty: 1, unitPrice: 250 }],
        payments: [{ method: 'UPI', amount: 100, reference: 'UPI123' }],
      }),
    );
    expect(s.creditSale.balanceDue).toBe(150);
    expect(s.creditSale.paymentStatus).toBe('PARTIAL');
    const c = await CustomerModel.findById(s.customer._id).lean();
    expect(c!.balance).toBe(150);
    const credit = expectOk(await cashier.get('/customer-credit'));
    expect(credit.find((x: any) => x._id === s.customer._id).balance).toBe(150);
  });

  it('refuses credit for the walk-in customer and over-tendering by card', async () => {
    const cashier = api(t.cashier);
    const walkInCredit = await cashier.post('/sales', { items: [{ itemType: 'PRODUCT', productId: s.charger._id, qty: 1, unitPrice: 250 }], payments: [{ method: 'Cash', amount: 100 }] });
    expect(walkInCredit.status).toBe(422);
    const cardOver = await cashier.post('/sales', { items: [{ itemType: 'PRODUCT', productId: s.charger._id, qty: 1, unitPrice: 250 }], payments: [{ method: 'Card', amount: 300 }] });
    expect(cardOver.status).toBe(422);
    expect(await stockOf(s.charger._id)).toBe(6); // failed bills changed nothing
  });

  it('prevents selling beyond stock and handles IMEI tracking', async () => {
    const cashier = api(t.cashier);
    const tooMany = await cashier.post('/sales', { items: [{ itemType: 'PRODUCT', productId: s.screen._id, qty: 99, unitPrice: 1200 }], payments: [{ method: 'Cash', amount: 118800 }] });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('INSUFFICIENT_STOCK');

    const noImei = await cashier.post('/sales', { items: [{ itemType: 'PRODUCT', productId: s.phone._id, qty: 1, unitPrice: 15000 }], payments: [{ method: 'Cash', amount: 15000 }] });
    expect(noImei.status).toBe(422);
    s.phoneSale = expectOk(
      await cashier.post('/sales', {
        customerId: s.customer._id,
        items: [{ itemType: 'PRODUCT', productId: s.phone._id, qty: 1, unitPrice: 15000, serials: ['356000000000011'] }],
        payments: [{ method: 'Card', amount: 15000 }],
      }),
    );
    expect(s.phoneSale.items[0].warranty.status).toBe('NONE');
    const resold = await cashier.post('/sales', { items: [{ itemType: 'PRODUCT', productId: s.phone._id, qty: 1, unitPrice: 15000, serials: ['356000000000011'] }], payments: [{ method: 'Cash', amount: 15000 }] });
    expect(resold.status).toBe(409);
    expect(await stockOf(s.phone._id)).toBe(1);
  });

  it('serialises concurrent sales of the last unit (no negative stock)', async () => {
    const admin = api(t.admin);
    const last = expectOk(await admin.post('/products', { name: 'Type-C Cable', productType: 'ACCESSORY', sellingPrice: 150, openingStock: { qty: 1, unitCost: 60 } }));
    const results = await Promise.all(
      [1, 2].map(() => api(t.cashier).post('/sales', { clientRequestId: rid(), items: [{ itemType: 'PRODUCT', productId: last._id, qty: 1, unitPrice: 150 }], payments: [{ method: 'Cash', amount: 150 }] })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await stockOf(last._id)).toBe(0);
    s.cable = last;
  });

  it('records a customer credit payment and updates the ledger', async () => {
    const cashier = api(t.cashier);
    const pay = expectOk(await cashier.post('/customer-payments', { clientRequestId: rid(), customerId: s.customer._id, methods: [{ method: 'Cash', amount: 150 }], allocationMode: 'OLDEST_FIRST' }));
    expect(pay.allocations).toHaveLength(1);
    expect(pay.allocations[0].invoiceNo).toBe(s.creditSale.invoiceNo);
    const sale = await SaleModel.findById(s.creditSale._id).lean();
    expect(sale!.balanceDue).toBe(0);
    expect(sale!.paymentStatus).toBe('PAID');
    const ledger = expectOk(await cashier.get(`/customers/${s.customer._id}/ledger`));
    expect(ledger.closing).toBe(0);
    expect(ledger.entries.map((e: any) => e.type)).toEqual(['SALE', 'PAYMENT', 'SALE', 'PAYMENT', 'PAYMENT']);
    const tooMuch = await cashier.post('/customer-payments', { customerId: s.customer._id, methods: [{ method: 'Cash', amount: 10 }] });
    expect(tooMuch.status).toBe(422);
  });

  it('enforces the cashier discount limit', async () => {
    const res = await api(t.cashier).post('/sales', {
      items: [{ itemType: 'PRODUCT', productId: s.charger._id, qty: 1, unitPrice: 250, discount: 100 }],
      payments: [{ method: 'Cash', amount: 150 }],
    });
    expect(res.status).toBe(403);
  });
});

describe('expenses (scenario 9)', () => {
  it('records an unpaid expense as a payable and reports it', async () => {
    const acc = api(t.accountant);
    const rent = await masterId('expenseCategory', 'Shop Rent');
    s.expense = expectOk(await acc.post('/expenses', { clientRequestId: rid(), categoryId: rent, description: 'October rent', amount: 5000, paidTo: 'Landlord' }));
    expect(s.expense.paymentStatus).toBe('UNPAID');
    expect(s.expense.balanceDue).toBe(5000);
    const payables = expectOk(await acc.get('/expenses?paymentStatus=UNPAID,PARTIAL'));
    expect(payables.items).toHaveLength(1);
    const paid = expectOk(await acc.post(`/expenses/${s.expense._id}/payments`, { amount: 2000, method: 'Bank Transfer' }));
    expect(paid.paymentStatus).toBe('PARTIAL');
    const report = expectOk(await acc.get('/reports/expenses'));
    expect(report.summary.amount).toBe(5000);
    expect(report.summary.outstanding).toBe(3000);
    expect(report.byCategory[0]).toMatchObject({ name: 'Shop Rent', amount: 5000 });
    expect(report.byPaymentMethod[0]).toMatchObject({ method: 'Bank Transfer', amount: 2000 });
  });
});

describe('repairs (scenario 10)', () => {
  it('creates a job with an advance, completes it once and deducts spares once', async () => {
    const tech = api(t.technician);
    const created = expectOk(
      await tech.post('/repairs', {
        clientRequestId: rid(),
        customerId: s.customer._id,
        ...s.device,
        imei: '351111111111111',
        complaint: 'Display broken',
        conditionAtReceipt: 'Cracked screen, body ok',
        laborCharge: 300,
        parts: [{ productId: s.screen._id, qty: 1, unitPrice: 1200 }],
        warrantyType: 'FULL',
        warrantyDays: 90,
        advance: { methods: [{ method: 'Cash', amount: 200 }] },
      }),
    );
    expect(created.jobNo).toMatch(/^JOB-/);
    expect(created.advancePaid).toBe(200);
    expect(await stockOf(s.screen._id)).toBe(5); // not consumed until completion
    s.repair = created;

    const notYet = await tech.patch(`/repairs/${created._id}/status`, { status: 'DELIVERED' });
    expect(notYet.status).toBe(409);
    expectOk(await tech.patch(`/repairs/${created._id}/status`, { status: 'IN_PROGRESS', note: 'Started' }));

    const done = expectOk(await api(t.cashier).post(`/repairs/${created._id}/complete`, { clientRequestId: rid(), payments: [{ method: 'Cash', amount: 1300 }] }));
    expect(done.repair.status).toBe('READY_FOR_DELIVERY');
    expect(done.sale.grandTotal).toBe(1500);
    expect(done.sale.amountPaid).toBe(1500);
    expect(done.sale.balanceDue).toBe(0);
    expect(done.sale.repairJob).toBe(created._id);
    const labor = done.sale.items.find((i: any) => i.revenueType === 'LABOR');
    const part = done.sale.items.find((i: any) => i.revenueType === 'SPARE_PART');
    expect(labor.netTotal).toBe(300);
    expect(part.costTotal).toBe(550);
    expect(part.isRepairPart).toBe(true);
    expect(await stockOf(s.screen._id)).toBe(4);
    s.repairSale = done.sale;

    const twice = await api(t.cashier).post(`/repairs/${created._id}/complete`, { clientRequestId: rid(), payments: [] });
    expect(twice.status).toBe(409);
    expect(await stockOf(s.screen._id)).toBe(4);

    expectOk(await tech.patch(`/repairs/${created._id}/status`, { status: 'DELIVERED' }));
    const c = await CustomerModel.findById(s.customer._id).lean();
    expect(c!.balance).toBe(0);
  });
});

describe('returns (scenarios 11, 12)', () => {
  it('processes a customer return with restock and refund', async () => {
    const acc = api(t.accountant);
    const itemId = s.cashSale.items[0]._id;
    const ret = expectOk(await acc.post(`/sales/${s.cashSale._id}/returns`, { clientRequestId: rid(), items: [{ saleItemId: itemId, qty: 1, restock: true }], reason: 'Not working', refundMethod: 'Cash' }));
    expect(ret.totalAmount).toBe(250);
    expect(ret.refundAmount).toBe(250);
    expect(ret.items[0].costTotal).toBe(110);
    expect(await stockOf(s.charger._id)).toBe(7);
    const over = await acc.post(`/sales/${s.cashSale._id}/returns`, { items: [{ saleItemId: itemId, qty: 2, restock: true }], reason: 'again' });
    expect(over.status).toBe(422);
    const sale = await SaleModel.findById(s.cashSale._id).lean();
    expect(sale!.returnStatus).toBe('PARTIAL');
    expect(sale!.items[0].returnedQty).toBe(1);
  });

  it('returns an IMEI-tracked phone to stock', async () => {
    const ret = expectOk(
      await api(t.admin).post(`/sales/${s.phoneSale._id}/returns`, {
        items: [{ saleItemId: s.phoneSale.items[0]._id, qty: 1, restock: true, serials: ['356000000000011'] }],
        reason: 'Customer changed mind',
        refundMethod: 'Card',
      }),
    );
    expect(ret.refundAmount).toBe(15000);
    expect(await stockOf(s.phone._id)).toBe(2);
  });

  it('processes a vendor return as a credit note against the payable', async () => {
    const acc = api(t.accountant);
    const p = await PurchaseModel.findById(s.purchase._id).lean();
    const screenLine = p!.items.find((i) => String(i.product) === s.screen._id)!;
    const ret = expectOk(await acc.post(`/purchases/${s.purchase._id}/returns`, { clientRequestId: rid(), items: [{ purchaseItemId: String(screenLine._id), qty: 1 }], reason: 'Defective', settlement: 'CREDIT_NOTE' }));
    expect(ret.totalAmount).toBe(500);
    expect(ret.adjustedAgainstDue).toBe(500);
    expect(ret.costVariance).toBe(50);
    expect(await stockOf(s.screen._id)).toBe(3);
    expect((await ProductModel.findById(s.screen._id).lean())!.avgCost).toBe(550);
    const vendor = await VendorModel.findById(s.vendor._id).lean();
    expect(vendor!.balance).toBe(1500);
    expect(vendor!.advanceBalance).toBe(0);
  });
});

describe('cancellations (scenario 13)', () => {
  it('cancels an invoice with full reversal and blocks double cancellation', async () => {
    const cashier = api(t.cashier);
    const sale = expectOk(await cashier.post('/sales', { clientRequestId: rid(), items: [{ itemType: 'PRODUCT', productId: s.charger._id, qty: 1, unitPrice: 250 }], payments: [{ method: 'Cash', amount: 250 }] }));
    expect(await stockOf(s.charger._id)).toBe(6);
    expect((await cashier.post(`/sales/${sale._id}/cancel`, { reason: 'Wrong item' })).status).toBe(403);
    const cancelled = expectOk(await api(t.admin).post(`/sales/${sale._id}/cancel`, { reason: 'Wrong item', refundMethod: 'Cash' }));
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.refundedAmount).toBe(250);
    expect(await stockOf(s.charger._id)).toBe(7);
    expect((await api(t.admin).post(`/sales/${sale._id}/cancel`, { reason: 'again' })).status).toBe(409);
  });

  it('cancels a vendor payment and restores the purchase balance', async () => {
    const acc = api(t.accountant);
    const pay = expectOk(await acc.post('/vendor-payments', { vendorId: s.vendor._id, amount: 100, method: 'Cash', allocationMode: 'OLDEST_FIRST' }));
    expect((await VendorModel.findById(s.vendor._id).lean())!.balance).toBe(1400);
    expectOk(await api(t.admin).post(`/vendor-payments/${pay._id}/cancel`, { reason: 'Entered twice' }));
    expect((await VendorModel.findById(s.vendor._id).lean())!.balance).toBe(1500);
  });

  it('cancels a received purchase: stock removed, paid amount becomes vendor advance', async () => {
    const acc = api(t.accountant);
    const v2 = expectOk(await acc.post('/vendors', { name: 'Accessory World' }));
    const p = expectOk(
      await acc.post('/purchases', { vendorId: v2._id, items: [{ productId: s.caseItem._id, qty: 4, unitCost: 50 }], initialPayment: { amount: 80, method: 'Cash' }, receive: true }),
    );
    expect(await stockOf(s.caseItem._id)).toBe(4);
    expectOk(await api(t.admin).post(`/purchases/${p._id}/cancel`, { reason: 'Wrong vendor' }));
    expect(await stockOf(s.caseItem._id)).toBe(0);
    const vendor = await VendorModel.findById(v2._id).lean();
    expect(vendor!.balance).toBe(0);
    expect(vendor!.advanceBalance).toBe(80);
    const ledger = expectOk(await acc.get(`/vendors/${v2._id}/ledger`));
    expect(ledger.closing).toBe(-80); // vendor owes us / advance held
  });
});

describe('inventory, dashboard and P&L (scenarios 14, 15)', () => {
  it('records a stock adjustment and flags low stock', async () => {
    const admin = api(t.admin);
    expect((await api(t.cashier).post('/inventory/adjustments', { productId: s.charger._id, type: 'ADJUSTMENT_OUT', qty: 1, reason: 'Lost' })).status).toBe(403);
    const adj = expectOk(await admin.post('/inventory/adjustments', { clientRequestId: rid(), productId: s.charger._id, type: 'ADJUSTMENT_OUT', qty: 1, reason: 'Lost' }));
    expect(adj.value).toBe(110);
    expect(await stockOf(s.charger._id)).toBe(6);
    expectOk(await admin.patch(`/products/${s.screen._id}`, { minStock: 5 }));
    const low = expectOk(await admin.get('/dashboard/low-stock'));
    const lowIds = low.map((p: any) => p._id);
    expect(lowIds).toContain(s.screen._id);
    expect(lowIds).toContain(s.caseItem._id);
    expect(lowIds).not.toContain(s.charger._id);
  });

  it('computes profit & loss from stored transactions without double counting', async () => {
    const pl = expectOk(await api(t.accountant).get('/reports/profit-loss'));
    // product sales: cash 500 + parallel 250 + credit 250 + phone 15000 + cable 150 (cancelled sale excluded)
    expect(pl.productSalesRevenue).toBe(16150);
    expect(pl.sparePartRevenue).toBe(1200);
    expect(pl.repairLaborRevenue).toBe(300);
    expect(pl.salesReturns).toBe(15250);
    expect(pl.netRevenue).toBe(2400);
    // COGS: chargers 4 x 110 + phone 10000 + cable 60 - returned charger 110 - returned phone 10000
    expect(pl.costOfGoodsSold).toBe(390);
    expect(pl.repairPartsCost).toBe(550);
    // write-offs: lost charger 110 + vendor-return variance 50
    expect(pl.inventoryWriteOffs).toBe(160);
    expect(pl.grossProfit).toBe(2400 - 390 - 550 - 160);
    expect(pl.operatingExpenses).toBe(5000);
    expect(pl.netProfit).toBe(1300 - 5000);
    // purchases / vendor payments never appear as expenses
    expect(pl.expenseBreakdown.map((e: any) => e.category)).toEqual(['Shop Rent']);
    expect(pl.series.length).toBe(1);
    expect(pl.series[0].revenue).toBe(2400);
  });

  it('dashboard figures come from the database', async () => {
    const d = expectOk(await api(t.cashier).get('/dashboard/summary'));
    expect(d.todaySales).toBe(16150 + 1500);
    expect(d.todayPurchases).toBe(3850 + 20000);
    expect(d.todayExpenses).toBe(5000);
    expect(d.outstandingVendorCredit).toBe(1500);
    expect(d.outstandingCustomerCredit).toBe(0);
    expect(d.pendingRepairs).toBe(0);
    expect(d.lowStockItems).toBeGreaterThanOrEqual(2);
  });
});

describe('authorisation (scenario 16)', () => {
  it('rejects unauthenticated and unauthorised requests', async () => {
    const supertest = (await import('supertest')).default;
    const { app } = await import('./helpers');
    expect((await supertest(app).get('/api/v1/sales')).status).toBe(401);
    expect((await api('not-a-token').get('/sales')).status).toBe(401);
    expect((await api(t.cashier).post('/purchases', { vendorId: s.vendor._id, items: [{ productId: s.charger._id, qty: 1, unitCost: 1 }] })).status).toBe(403);
    expect((await api(t.technician).post('/sales', { items: [{ itemType: 'PRODUCT', productId: s.charger._id, qty: 1, unitPrice: 1 }] })).status).toBe(403);
    expect((await api(t.cashier).get('/reports/profit-loss')).status).toBe(403);
    expect((await api(t.cashier).patch('/settings', { shopName: 'Hacked' })).status).toBe(403);
    expect((await api(t.accountant).post('/users', { name: 'x', username: 'xx1', password: 'Password@1', role: 'ADMIN' })).status).toBe(403);
    expect((await api(t.technician).post('/expenses', { categoryId: s.expense.category, description: 'x', amount: 1 })).status).toBe(403);
  });
});

describe('data consistency (scenario 18)', () => {
  it('cached balances and stock always equal their ledgers', async () => {
    for (const c of await CustomerModel.find().lean()) {
      const agg = await CustomerLedgerModel.aggregate([{ $match: { customer: c._id } }, { $group: { _id: null, d: { $sum: '$debit' }, cr: { $sum: '$credit' } } }]);
      expect(Number(((agg[0]?.d ?? 0) - (agg[0]?.cr ?? 0)).toFixed(2))).toBe(c.balance);
    }
    for (const p of await ProductModel.find({ trackInventory: true }).lean()) {
      const agg = await StockMovementModel.aggregate([{ $match: { product: p._id } }, { $group: { _id: null, q: { $sum: '$qty' }, dq: { $sum: '$damagedQty' } } }]);
      expect(agg[0]?.q ?? 0).toBe(p.stockQty);
      expect(agg[0]?.dq ?? 0).toBe(p.damagedQty);
    }
    for (const v of await VendorModel.find().lean()) {
      const agg = await PurchaseModel.aggregate([{ $match: { vendor: v._id, status: 'RECEIVED' } }, { $group: { _id: null, due: { $sum: '$balanceDue' } } }]);
      expect(Number((agg[0]?.due ?? 0).toFixed(2))).toBe(v.balance);
    }
  });

  it('figures are identical after a reconnect (restart)', async () => {
    const before = expectOk(await api(t.accountant).get('/reports/profit-loss'));
    const uri = process.env.TEST_MONGODB_URI!;
    await mongoose.disconnect();
    const { connectDatabase } = await import('../src/config/db');
    await connectDatabase(uri, 'pos_test_workflows');
    const after = expectOk(await api(t.accountant).get('/reports/profit-loss'));
    expect(after.netProfit).toBe(before.netProfit);
    expect(after.grossProfit).toBe(before.grossProfit);
  });
});
