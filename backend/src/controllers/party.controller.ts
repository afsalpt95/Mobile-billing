import type { Request, Response } from 'express';
import { CustomerPaymentModel, RepairJobModel, SaleModel } from '../models';
import { customerStatement, vendorStatement } from '../services/ledger.service';
import * as party from '../services/party.service';
import { vendorCreditSummary } from '../services/vendorPayment.service';
import { resolveRange } from '../utils/dates';
import { ApiError } from '../utils/ApiError';
import { ok, okList } from '../utils/respond';

function optionalRange(q: Record<string, unknown>) {
  if (!q.from && !q.to) return { from: undefined, to: undefined };
  try {
    return resolveRange(q.from as string | undefined, q.to as string | undefined);
  } catch (e) {
    throw ApiError.validation((e as Error).message);
  }
}

// ---- customers ----
export const listCustomers = async (req: Request, res: Response) => {
  const q = req.query as any;
  okList(res, await party.listCustomers(q), q.page, q.limit);
};
export const createCustomer = async (req: Request, res: Response) => ok(res, await party.createCustomer(req.body, req.user!), 201);
export const getCustomer = async (req: Request, res: Response) => ok(res, await party.getCustomer(req.params.id));
export const updateCustomer = async (req: Request, res: Response) => ok(res, await party.updateCustomer(req.params.id, req.body, req.user!));
export const checkCustomerMobile = async (req: Request, res: Response) =>
  ok(res, await party.findCustomersByMobile(String(req.query.mobile ?? ''), req.query.exclude as string | undefined));
export const customerLedger = async (req: Request, res: Response) => {
  const { from, to } = optionalRange(req.query as Record<string, unknown>);
  ok(res, await customerStatement(req.params.id, from, to));
};
export const customerOpenInvoices = async (req: Request, res: Response) => ok(res, await party.openInvoices(req.params.id));
export const customerWarranties = async (req: Request, res: Response) => ok(res, await party.customerWarranties(req.params.id));
export const customerHistory = async (req: Request, res: Response) => {
  const id = req.params.id;
  const [sales, repairs, payments] = await Promise.all([
    SaleModel.find({ customer: id }).select('invoiceNo date grandTotal amountPaid balanceDue paymentStatus status returnStatus').sort({ date: -1 }).limit(200).lean(),
    RepairJobModel.find({ customer: id }).select('jobNo receivedAt brandName deviceModelName complaint status invoiceNo warrantyExpiry').sort({ receivedAt: -1 }).limit(200).lean(),
    CustomerPaymentModel.find({ customer: id }).sort({ date: -1 }).limit(200).lean(),
  ]);
  ok(res, { sales, repairs, payments });
};
export const customerCredit = async (req: Request, res: Response) => ok(res, await party.customerCreditSummary(req.query.q as string | undefined));

// ---- vendors ----
export const listVendors = async (req: Request, res: Response) => {
  const q = req.query as any;
  okList(res, await party.listVendors(q), q.page, q.limit);
};
export const createVendor = async (req: Request, res: Response) => ok(res, await party.createVendor(req.body, req.user!), 201);
export const getVendor = async (req: Request, res: Response) => ok(res, await party.getVendor(req.params.id));
export const updateVendor = async (req: Request, res: Response) => ok(res, await party.updateVendor(req.params.id, req.body, req.user!));
export const vendorLedger = async (req: Request, res: Response) => {
  const { from, to } = optionalRange(req.query as Record<string, unknown>);
  ok(res, await vendorStatement(req.params.id, from, to));
};
export const vendorOpenPurchases = async (req: Request, res: Response) => ok(res, await party.vendorOpenPurchases(req.params.id));
export const vendorCredit = async (req: Request, res: Response) =>
  ok(res, await vendorCreditSummary(req.query.q as string | undefined, req.query.all !== 'true'));
