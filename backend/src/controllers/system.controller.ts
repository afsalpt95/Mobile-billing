import type { Request, Response } from 'express';
import { AuditLogModel, ProductModel, SaleModel, RepairJobModel, UserModel } from '../models';
import * as reports from '../services/report.service';
import { getSettings, updateSettings } from '../services/settings.service';
import * as users from '../services/user.service';
import { addDays, resolveRange, startOfDay, todayRange } from '../utils/dates';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { escapeRegex } from '../utils/pagination';
import { ok, okList } from '../utils/respond';

function range(req: Request) {
  try {
    return resolveRange(req.query.from as string | undefined, req.query.to as string | undefined);
  } catch (e) {
    throw ApiError.validation((e as Error).message);
  }
}

// ---- dashboard ----
export const dashboardSummary = async (_req: Request, res: Response) => ok(res, await reports.dashboardSummary(todayRange()));
export const dashboardTrend = async (req: Request, res: Response) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 7), 1), 90);
  const to = new Date();
  const from = startOfDay(addDays(to, -(days - 1)));
  ok(res, await reports.salesTrend({ from, to }));
};
export const dashboardLowStock = async (_req: Request, res: Response) =>
  ok(
    res,
    await ProductModel.find({ trackInventory: true, isActive: true, $expr: { $lte: ['$stockQty', '$minStock'] } })
      .select('productCode name stockQty minStock unit')
      .sort({ stockQty: 1 })
      .limit(20)
      .lean(),
  );

// ---- reports ----
export const profitLoss = async (req: Request, res: Response) => {
  const r = range(req);
  const [summary, detail] = await Promise.all([reports.profitAndLoss(r), reports.profitAndLossDetail(r)]);
  ok(res, { ...summary, ...detail });
};
export const salesReport = async (req: Request, res: Response) => ok(res, await reports.salesReport(range(req)));
export const purchaseReport = async (req: Request, res: Response) => ok(res, await reports.purchaseReport(range(req)));
export const inventoryReport = async (_req: Request, res: Response) => ok(res, await reports.inventoryReport());
export const expenseReport = async (req: Request, res: Response) => ok(res, await reports.expenseReport(range(req), (req.query.groupBy as any) ?? 'day'));

// ---- warranty lookup ----
export const warrantyLookup = async (req: Request, res: Response) => {
  const term = String(req.query.q ?? '').trim();
  if (term.length < 3) throw ApiError.validation('Enter at least 3 characters (IMEI, invoice, job or mobile number)');
  const rx = new RegExp(escapeRegex(term), 'i');
  const [sales, repairs] = await Promise.all([
    SaleModel.find({ status: 'COMPLETED', $or: [{ invoiceNo: rx }, { customerMobile: term }, { 'items.serials': term.toUpperCase() }, { 'items.device.imei': term }] })
      .select('invoiceNo date customerName customerMobile items.name items.serials items.warranty items.qty items.returnedQty')
      .sort({ date: -1 })
      .limit(20)
      .lean(),
    RepairJobModel.find({ $or: [{ jobNo: rx }, { contactNumber: term }, { imei: term }, { invoiceNo: rx }] })
      .select('jobNo customerName contactNumber brandName deviceModelName imei complaint status warrantyType warrantyExpiry invoiceNo completedAt')
      .sort({ receivedAt: -1 })
      .limit(20)
      .lean(),
  ]);
  ok(res, { sales, repairs });
};

// ---- settings ----
export const getShopSettings = async (_req: Request, res: Response) => ok(res, await getSettings());
export const patchShopSettings = async (req: Request, res: Response) => {
  if (req.body.currencyPrecision !== undefined) {
    const current = await getSettings();
    if (req.body.currencyPrecision !== current.currencyPrecision && (await SaleModel.exists({}))) {
      throw ApiError.conflict('Currency precision cannot be changed after invoices exist');
    }
  }
  const doc = await updateSettings(req.body);
  await audit(req.user, 'UPDATE', 'ShopSettings', undefined, undefined, 'Settings updated', Object.keys(req.body));
  ok(res, doc);
};

// ---- users ----
export const listUsers = async (_req: Request, res: Response) => ok(res, await UserModel.find().sort({ name: 1 }).lean().then((u) => u.map(({ passwordHash: _p, ...x }: any) => x)));
export const technicians = async (_req: Request, res: Response) =>
  ok(res, await UserModel.find({ isActive: true, role: { $in: ['TECHNICIAN', 'ADMIN'] } }).select('name role').sort({ name: 1 }).lean());
export const createUser = async (req: Request, res: Response) => ok(res, await users.createUser(req.body, req.user!), 201);
export const updateUser = async (req: Request, res: Response) => ok(res, await users.updateUser(req.params.id, req.body, req.user!));

// ---- audit ----
export const auditLogs = async (req: Request, res: Response) => {
  const qq = req.query as any;
  const filter: Record<string, unknown> = {};
  if (qq.entity) filter.entity = qq.entity;
  if (qq.q) filter.$or = [{ refNo: new RegExp(escapeRegex(qq.q), 'i') }, { summary: new RegExp(escapeRegex(qq.q), 'i') }];
  const [items, total] = await Promise.all([
    AuditLogModel.find(filter).sort({ at: -1 }).skip((qq.page - 1) * qq.limit).limit(qq.limit).lean(),
    AuditLogModel.countDocuments(filter),
  ]);
  okList(res, { items, total }, qq.page, qq.limit);
};
