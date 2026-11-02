import type { Request, Response } from 'express';
import * as products from '../services/product.service';
import { inventoryReport } from '../services/report.service';
import { created, ok, okList } from '../utils/respond';

export const listProducts = async (req: Request, res: Response) => {
  const q = req.query as any;
  okList(res, await products.listProducts(q), q.page, q.limit);
};
export const createProduct = async (req: Request, res: Response) => ok(res, await products.createProduct(req.body, req.user!), 201);
export const getProduct = async (req: Request, res: Response) => ok(res, await products.getProduct(req.params.id));
export const updateProduct = async (req: Request, res: Response) => ok(res, await products.updateProduct(req.params.id, req.body, req.user!));
export const lookupProduct = async (req: Request, res: Response) => ok(res, await products.lookupProduct(String(req.query.code ?? '')));
export const productSerials = async (req: Request, res: Response) => ok(res, await products.listSerials(req.params.id, req.query.status as string | undefined));

/** /spare-parts is a filtered view of products with productType SPARE_PART. */
export const listSpareParts = async (req: Request, res: Response) => {
  const q = { ...(req.query as any), type: 'SPARE_PART' };
  okList(res, await products.listProducts(q), q.page, q.limit);
};
export const createSparePart = async (req: Request, res: Response) =>
  ok(res, await products.createProduct({ ...req.body, productType: 'SPARE_PART' }, req.user!), 201);

export const stock = async (req: Request, res: Response) => {
  const q = { ...(req.query as any), type: (req.query as any).type ?? 'PHONE,SPARE_PART,ACCESSORY,CONSUMABLE,OTHER' };
  okList(res, await products.listProducts(q), q.page, q.limit);
};
export const movements = async (req: Request, res: Response) => {
  const q = req.query as any;
  okList(res, await products.listMovements(q), q.page, q.limit);
};
export const listAdjustments = async (req: Request, res: Response) => {
  const q = req.query as any;
  okList(res, await products.listAdjustments(q), q.page, q.limit);
};
export const createAdjustment = async (req: Request, res: Response) => {
  const r = await products.createAdjustment(req.body, req.user!);
  created(res, r.adjustment, r.duplicate);
};
export const valuation = async (_req: Request, res: Response) => ok(res, await inventoryReport());
