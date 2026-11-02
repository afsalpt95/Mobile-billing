import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import * as inv from '../controllers/inventory.controller';
import * as master from '../controllers/master.controller';
import * as party from '../controllers/party.controller';
import * as sys from '../controllers/system.controller';
import * as tx from '../controllers/transaction.controller';
import { authenticate, requirePermission as can } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler as h } from '../utils/asyncHandler';
import * as v from '../validators';

const router = Router();
const id = { params: v.idParam };

// ---------------- auth ----------------
router.post('/auth/login', validate({ body: v.loginBody }), h(auth.login));
router.post('/auth/logout', h(auth.logout));

router.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }));

// Everything below requires a valid session.
router.use(authenticate);
router.get('/auth/me', h(auth.me));
router.post('/auth/change-password', validate({ body: v.changePasswordBody }), h(auth.changePassword));

// ---------------- dashboard ----------------
router.get('/dashboard/summary', can('dashboard.view'), h(sys.dashboardSummary));
router.get('/dashboard/sales-trend', can('dashboard.view'), h(sys.dashboardTrend));
router.get('/dashboard/low-stock', can('dashboard.view'), h(sys.dashboardLowStock));

// ---------------- customers ----------------
router.get('/customers', can('customers.read'), validate({ query: v.customerListQuery }), h(party.listCustomers));
router.get('/customers/check-mobile', can('customers.read'), h(party.checkCustomerMobile));
router.post('/customers', can('customers.write'), validate({ body: v.customerBody }), h(party.createCustomer));
router.get('/customers/:id', can('customers.read'), validate(id), h(party.getCustomer));
router.patch('/customers/:id', can('customers.write'), validate({ ...id, body: v.customerPatch }), h(party.updateCustomer));
router.get('/customers/:id/ledger', can('customers.read'), validate({ ...id, query: v.dateRangeQuery }), h(party.customerLedger));
router.get('/customers/:id/open-invoices', can('customers.read'), validate(id), h(party.customerOpenInvoices));
router.get('/customers/:id/history', can('customers.read'), validate(id), h(party.customerHistory));
router.get('/customers/:id/warranties', can('customers.read'), validate(id), h(party.customerWarranties));
router.get('/customer-credit', can('customers.read'), h(party.customerCredit));

// ---------------- customer payments ----------------
router.get('/customer-payments', can('customers.read'), validate({ query: v.paymentListQuery }), h(tx.listCustomerPayments));
router.post('/customer-payments', can('customerPayments.create'), validate({ body: v.customerPaymentBody }), h(tx.createCustomerPayment));
router.get('/customer-payments/:id', can('customers.read'), validate(id), h(tx.getCustomerPayment));
router.post('/customer-payments/:id/cancel', can('customerPayments.cancel'), validate({ ...id, body: v.reasonBody }), h(tx.cancelCustomerPayment));

// ---------------- vendors ----------------
router.get('/vendors', can('vendors.read'), validate({ query: v.vendorListQuery }), h(party.listVendors));
router.post('/vendors', can('vendors.write'), validate({ body: v.vendorBody }), h(party.createVendor));
router.get('/vendors/:id', can('vendors.read'), validate(id), h(party.getVendor));
router.patch('/vendors/:id', can('vendors.write'), validate({ ...id, body: v.vendorPatch }), h(party.updateVendor));
router.get('/vendors/:id/ledger', can('vendorPayments.read'), validate({ ...id, query: v.dateRangeQuery }), h(party.vendorLedger));
router.get('/vendors/:id/open-purchases', can('vendorPayments.read'), validate(id), h(party.vendorOpenPurchases));
router.get('/vendor-credit', can('vendorPayments.read'), h(party.vendorCredit));

// ---------------- vendor payments ----------------
router.get('/vendor-payments', can('vendorPayments.read'), validate({ query: v.paymentListQuery }), h(tx.listVendorPayments));
router.post('/vendor-payments', can('vendorPayments.create'), validate({ body: v.vendorPaymentBody }), h(tx.createVendorPayment));
router.post('/vendor-payments/apply-advance', can('vendorPayments.create'), validate({ body: v.applyAdvanceBody }), h(tx.applyVendorAdvance));
router.post('/vendor-payments/refund', can('vendorPayments.create'), validate({ body: v.vendorRefundBody }), h(tx.vendorRefund));
router.get('/vendor-payments/:id', can('vendorPayments.read'), validate(id), h(tx.getVendorPayment));
router.post('/vendor-payments/:id/cancel', can('vendorPayments.cancel'), validate({ ...id, body: v.reasonBody }), h(tx.cancelVendorPayment));

// ---------------- products / spare parts ----------------
router.get('/products', can('inventory.read'), validate({ query: v.productListQuery }), h(inv.listProducts));
router.get('/products/lookup', can('inventory.read'), h(inv.lookupProduct));
router.post('/products', can('products.write'), validate({ body: v.productBody }), h(inv.createProduct));
router.get('/products/:id', can('inventory.read'), validate(id), h(inv.getProduct));
router.patch('/products/:id', can('products.write'), validate({ ...id, body: v.productPatch }), h(inv.updateProduct));
router.get('/products/:id/serials', can('inventory.read'), validate(id), h(inv.productSerials));
router.get('/spare-parts', can('inventory.read'), validate({ query: v.productListQuery }), h(inv.listSpareParts));
router.post('/spare-parts', can('masters.write'), validate({ body: v.productBody.extend({ productType: v.productBody.shape.productType.optional() }) }), h(inv.createSparePart));

// ---------------- inventory ----------------
router.get('/inventory/stock', can('inventory.read'), validate({ query: v.productListQuery }), h(inv.stock));
router.get('/inventory/movements', can('inventory.read'), validate({ query: v.movementListQuery }), h(inv.movements));
router.get('/inventory/adjustments', can('inventory.read'), validate({ query: v.listQuery }), h(inv.listAdjustments));
router.post('/inventory/adjustments', can('inventory.adjust'), validate({ body: v.adjustmentBody }), h(inv.createAdjustment));
router.get('/inventory/valuation', can('inventory.read'), h(inv.valuation));

// ---------------- sales ----------------
router.get('/sales', can('sales.read'), validate({ query: v.saleListQuery }), h(tx.listSales));
router.post('/sales', can('sales.create'), validate({ body: v.saleBody }), h(tx.createSale));
router.get('/sales/:id', can('sales.read'), validate(id), h(tx.getSale));
router.get('/sales/:id/pdf', can('sales.read'), validate(id), h(tx.salePdf));
router.post('/sales/:id/payments', can('customerPayments.create'), validate({ ...id, body: v.salePaymentBody }), h(tx.salePayment));
router.post('/sales/:id/returns', can('returns.sales'), validate({ ...id, body: v.salesReturnBody }), h(tx.saleReturn));
router.post('/sales/:id/cancel', can('sales.cancel'), validate({ ...id, body: v.cancelSaleBody }), h(tx.cancelSale));

// ---------------- purchases ----------------
router.get('/purchases', can('purchases.read'), validate({ query: v.purchaseListQuery }), h(tx.listPurchases));
router.post('/purchases', can('purchases.write'), validate({ body: v.purchaseBody }), h(tx.createPurchase));
router.get('/purchases/:id', can('purchases.read'), validate(id), h(tx.getPurchase));
router.put('/purchases/:id', can('purchases.write'), validate({ ...id, body: v.purchaseBody }), h(tx.updatePurchase));
router.post('/purchases/:id/receive', can('purchases.write'), validate(id), h(tx.receivePurchase));
router.post('/purchases/:id/cancel', can('purchases.cancel'), validate({ ...id, body: v.reasonBody }), h(tx.cancelPurchase));
router.post('/purchases/:id/duplicate', can('purchases.write'), validate(id), h(tx.duplicatePurchase));
router.post('/purchases/:id/payments', can('vendorPayments.create'), validate({ ...id, body: v.purchasePaymentBody }), h(tx.purchasePayment));
router.post('/purchases/:id/returns', can('returns.purchases'), validate({ ...id, body: v.purchaseReturnBody }), h(tx.purchaseReturn));

// ---------------- returns ----------------
router.get('/returns/sales', can('sales.read'), validate({ query: v.listQuery }), h(tx.listSalesReturns));
router.get('/returns/purchases', can('purchases.read'), validate({ query: v.listQuery }), h(tx.listPurchaseReturns));

// ---------------- repairs ----------------
router.get('/repairs', can('repairs.read'), validate({ query: v.repairListQuery }), h(tx.listRepairs));
router.post('/repairs', can('repairs.write'), validate({ body: v.repairBody }), h(tx.createRepair));
router.get('/repairs/:id', can('repairs.read'), validate(id), h(tx.getRepair));
router.patch('/repairs/:id', can('repairs.write'), validate({ ...id, body: v.repairPatch }), h(tx.updateRepair));
router.patch('/repairs/:id/status', can('repairs.write'), validate({ ...id, body: v.repairStatusBody }), h(tx.repairStatus));
router.post('/repairs/:id/advance', can('repairs.write'), validate({ ...id, body: v.repairAdvanceBody }), h(tx.repairAdvance));
router.post('/repairs/:id/complete', can('repairs.complete'), validate({ ...id, body: v.repairCompleteBody }), h(tx.completeRepair));
router.get('/warranty/lookup', can('sales.read'), h(sys.warrantyLookup));

// ---------------- expenses ----------------
router.get('/expenses', can('expenses.read'), validate({ query: v.expenseListQuery }), h(tx.listExpenses));
router.post('/expenses', can('expenses.write'), validate({ body: v.expenseBody }), h(tx.createExpense));
router.get('/expenses/:id', can('expenses.read'), validate(id), h(tx.getExpense));
router.patch('/expenses/:id', can('expenses.write'), validate({ ...id, body: v.expensePatch }), h(tx.updateExpense));
router.post('/expenses/:id/payments', can('expenses.write'), validate({ ...id, body: v.expensePayBody }), h(tx.payExpense));
router.post('/expenses/:id/cancel', can('expenses.write'), validate({ ...id, body: v.reasonBody }), h(tx.cancelExpense));

// ---------------- reports ----------------
router.get('/reports/sales', can('reports.sales'), validate({ query: v.reportQuery }), h(sys.salesReport));
router.get('/reports/purchases', can('reports.financial'), validate({ query: v.reportQuery }), h(sys.purchaseReport));
router.get('/reports/profit-loss', can('reports.financial'), validate({ query: v.reportQuery }), h(sys.profitLoss));
router.get('/reports/inventory', can('inventory.read'), h(sys.inventoryReport));
router.get('/reports/expenses', can('expenses.read'), validate({ query: v.reportQuery }), h(sys.expenseReport));

// ---------------- settings / users / audit ----------------
router.get('/settings', can('settings.read'), h(sys.getShopSettings));
router.patch('/settings', can('settings.write'), validate({ body: v.settingsPatch }), h(sys.patchShopSettings));
router.get('/users', can('users.manage'), h(sys.listUsers));
router.get('/users/technicians', can('repairs.read'), h(sys.technicians));
router.post('/users', can('users.manage'), validate({ body: v.createUserBody }), h(sys.createUser));
router.patch('/users/:id', can('users.manage'), validate({ ...id, body: v.updateUserBody }), h(sys.updateUser));
router.get('/audit-logs', can('audit.read'), validate({ query: v.listQuery }), h(sys.auditLogs));

// ---------------- master data (categories, brands, models, expense categories, ...) ----------------
const masterParam = { params: v.masterParams };
router.get('/:master', can('masters.read'), validate({ ...masterParam, query: v.masterListQuery }), h(master.listMaster));
router.post('/:master', can('masters.write'), validate({ ...masterParam, body: v.masterBody }), h(master.createMaster));
router.patch('/:master/:id', can('masters.manage'), validate({ params: v.masterParams.merge(v.idParam), body: v.masterPatch }), h(master.updateMaster));

export default router;
