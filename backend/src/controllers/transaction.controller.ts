import type { Request, Response } from 'express';
import { CustomerModel, CustomerPaymentModel, ExpenseModel, PurchaseModel, SaleModel, VendorPaymentModel } from '../models';
import * as customerPayments from '../services/customerPayment.service';
import * as expenses from '../services/expense.service';
import * as purchases from '../services/purchase.service';
import * as repairs from '../services/repair.service';
import * as returns from '../services/return.service';
import * as sales from '../services/sale.service';
import { getSettings } from '../services/settings.service';
import * as vendorPayments from '../services/vendorPayment.service';
import { ApiError } from '../utils/ApiError';
import { streamInvoicePdf } from '../utils/invoicePdf';
import { created, ok, okList } from '../utils/respond';

const q = (req: Request) => req.query as any;

// ---------------- sales ----------------
export const listSales = async (req: Request, res: Response) => okList(res, await sales.listSales(q(req)), q(req).page, q(req).limit);
export const createSale = async (req: Request, res: Response) => {
  const r = await sales.createSale(req.body, req.user!);
  created(res, r.sale, r.duplicate);
};
export const getSale = async (req: Request, res: Response) => ok(res, await sales.getSale(req.params.id));
export const cancelSale = async (req: Request, res: Response) => ok(res, await sales.cancelSale(req.params.id, req.body, req.user!));
export const salePayment = async (req: Request, res: Response) => {
  const sale = await SaleModel.findById(req.params.id).lean();
  if (!sale) throw ApiError.notFound('Invoice');
  const amount = (req.body.methods as Array<{ amount: number }>).reduce((a, m) => a + Number(m.amount), 0);
  const r = await customerPayments.createCustomerPayment(
    {
      clientRequestId: req.body.clientRequestId,
      customerId: String(sale.customer),
      date: req.body.date,
      methods: req.body.methods,
      allocationMode: 'MANUAL',
      allocations: [{ saleId: String(sale._id), amount }],
      notes: req.body.notes,
    },
    req.user!,
  );
  created(res, r.payment, r.duplicate);
};
export const saleReturn = async (req: Request, res: Response) => {
  const r = await returns.createSalesReturn(req.params.id, req.body, req.user!);
  created(res, r.salesReturn, r.duplicate);
};
export const salePdf = async (req: Request, res: Response) => {
  const sale = await SaleModel.findById(req.params.id).lean();
  if (!sale) throw ApiError.notFound('Invoice');
  streamInvoicePdf(res, sale as any, (await getSettings()) as any);
};

// ---------------- customer payments ----------------
export const listCustomerPayments = async (req: Request, res: Response) =>
  okList(res, await customerPayments.listCustomerPayments(q(req)), q(req).page, q(req).limit);
export const createCustomerPayment = async (req: Request, res: Response) => {
  const r = await customerPayments.createCustomerPayment(req.body, req.user!);
  created(res, r.payment, r.duplicate);
};
export const getCustomerPayment = async (req: Request, res: Response) => {
  const p = await CustomerPaymentModel.findById(req.params.id).populate('createdBy', 'name').lean();
  if (!p) throw ApiError.notFound('Receipt');
  const customer = await CustomerModel.findById(p.customer).select('mobile').lean();
  ok(res, { ...p, customerMobile: customer?.mobile });
};
export const cancelCustomerPayment = async (req: Request, res: Response) =>
  ok(res, await customerPayments.cancelCustomerPayment(req.params.id, req.body.reason, req.user!));

// ---------------- purchases ----------------
export const listPurchases = async (req: Request, res: Response) => okList(res, await purchases.listPurchases(q(req)), q(req).page, q(req).limit);
export const createPurchase = async (req: Request, res: Response) => {
  const r = await purchases.createPurchase(req.body, req.user!);
  created(res, r.purchase, r.duplicate);
};
export const getPurchase = async (req: Request, res: Response) => ok(res, await purchases.getPurchase(req.params.id));
export const updatePurchase = async (req: Request, res: Response) => ok(res, await purchases.updateDraftPurchase(req.params.id, req.body, req.user!));
export const receivePurchase = async (req: Request, res: Response) => ok(res, await purchases.receivePurchase(req.params.id, req.user!));
export const cancelPurchase = async (req: Request, res: Response) => ok(res, await purchases.cancelPurchase(req.params.id, req.body.reason, req.user!));
export const duplicatePurchase = async (req: Request, res: Response) => ok(res, await purchases.duplicatePurchase(req.params.id, req.user!), 201);
export const purchasePayment = async (req: Request, res: Response) => {
  const p = await PurchaseModel.findById(req.params.id).lean();
  if (!p) throw ApiError.notFound('Purchase');
  const r = await vendorPayments.createVendorPayment(
    { ...req.body, vendorId: String(p.vendor), allocationMode: 'MANUAL', allocations: [{ purchaseId: String(p._id), amount: req.body.amount }] },
    req.user!,
  );
  created(res, r.payment, r.duplicate);
};
export const purchaseReturn = async (req: Request, res: Response) => {
  const r = await returns.createPurchaseReturn(req.params.id, req.body, req.user!);
  created(res, r.purchaseReturn, r.duplicate);
};

// ---------------- vendor payments ----------------
export const listVendorPayments = async (req: Request, res: Response) =>
  okList(res, await vendorPayments.listVendorPayments(q(req)), q(req).page, q(req).limit);
export const createVendorPayment = async (req: Request, res: Response) => {
  const r = await vendorPayments.createVendorPayment(req.body, req.user!);
  created(res, r.payment, r.duplicate);
};
export const getVendorPayment = async (req: Request, res: Response) => {
  const p = await VendorPaymentModel.findById(req.params.id).populate('createdBy', 'name').lean();
  if (!p) throw ApiError.notFound('Payment');
  ok(res, p);
};
export const applyVendorAdvance = async (req: Request, res: Response) => {
  const r = await vendorPayments.applyVendorAdvance(req.body, req.user!);
  created(res, r.payment, r.duplicate);
};
export const vendorRefund = async (req: Request, res: Response) => {
  const r = await vendorPayments.recordVendorRefund(req.body, req.user!);
  created(res, r.payment, r.duplicate);
};
export const cancelVendorPayment = async (req: Request, res: Response) =>
  ok(res, await vendorPayments.cancelVendorPayment(req.params.id, req.body.reason, req.user!));

// ---------------- returns ----------------
export const listSalesReturns = async (req: Request, res: Response) => okList(res, await returns.listReturns('sales', q(req)), q(req).page, q(req).limit);
export const listPurchaseReturns = async (req: Request, res: Response) =>
  okList(res, await returns.listReturns('purchases', q(req)), q(req).page, q(req).limit);

// ---------------- repairs ----------------
export const listRepairs = async (req: Request, res: Response) => okList(res, await repairs.listRepairs(q(req)), q(req).page, q(req).limit);
export const createRepair = async (req: Request, res: Response) => {
  const r = await repairs.createRepair(req.body, req.user!);
  created(res, r.repair, r.duplicate);
};
export const getRepair = async (req: Request, res: Response) => ok(res, await repairs.getRepair(req.params.id));
export const updateRepair = async (req: Request, res: Response) => ok(res, await repairs.updateRepair(req.params.id, req.body, req.user!));
export const repairStatus = async (req: Request, res: Response) => ok(res, await repairs.updateRepairStatus(req.params.id, req.body, req.user!));
export const repairAdvance = async (req: Request, res: Response) => ok(res, await repairs.addRepairAdvance(req.params.id, req.body.methods, req.user!));
export const completeRepair = async (req: Request, res: Response) => {
  const r = await repairs.completeRepair(req.params.id, req.body, req.user!);
  created(res, { repair: r.repair, sale: r.sale }, r.duplicate);
};

// ---------------- expenses ----------------
export const listExpenses = async (req: Request, res: Response) => okList(res, await expenses.listExpenses(q(req)), q(req).page, q(req).limit);
export const createExpense = async (req: Request, res: Response) => {
  const r = await expenses.createExpense(req.body, req.user!);
  created(res, r.expense, r.duplicate);
};
export const getExpense = async (req: Request, res: Response) => {
  const e = await ExpenseModel.findById(req.params.id).populate('vendor', 'name').lean();
  if (!e) throw ApiError.notFound('Expense');
  ok(res, e);
};
export const updateExpense = async (req: Request, res: Response) => ok(res, await expenses.updateExpense(req.params.id, req.body, req.user!));
export const payExpense = async (req: Request, res: Response) => ok(res, await expenses.payExpense(req.params.id, req.body, req.user!));
export const cancelExpense = async (req: Request, res: Response) => ok(res, await expenses.cancelExpense(req.params.id, req.body.reason, req.user!));
