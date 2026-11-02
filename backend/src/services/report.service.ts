import {
  CustomerModel,
  CustomerPaymentModel,
  ExpenseCategoryModel,
  ExpenseModel,
  ProductModel,
  PurchaseModel,
  PurchaseReturnModel,
  RepairJobModel,
  SaleModel,
  SalesReturnModel,
  StockMovementModel,
  VendorModel,
} from '../models';
import { TIME_ZONE, dayKeys, type DateRange } from '../utils/dates';
import { add, round, sub } from '../utils/money';

const r = (n: number | undefined | null) => round(n ?? 0);
const dateKey = (field: string, unit: 'day' | 'week' | 'month' = 'day') => {
  if (unit === 'month') return { $dateToString: { format: '%Y-%m', date: field, timezone: TIME_ZONE } };
  if (unit === 'week') return { $dateToString: { format: '%G-W%V', date: field, timezone: TIME_ZONE } };
  return { $dateToString: { format: '%Y-%m-%d', date: field, timezone: TIME_ZONE } };
};

/**
 * PROFIT & LOSS - management accounts on an ACCRUAL basis:
 *  - Revenue is recognised on the invoice date, excluding tax collected (a liability) and net of
 *    line and bill discounts. Cancelled invoices are excluded entirely.
 *  - Cost of goods sold = weighted-average inventory cost recorded on each line at sale time.
 *    Retail product lines -> COGS; spare parts billed on repair jobs and spares consumed inside
 *    service lines -> "spare-part cost consumed in repairs".
 *  - Sales returns are recognised on the return date: revenue and cost are reversed.
 *  - Inventory write-offs = damaged / lost stock adjustments, damaged customer returns and losses
 *    on vendor returns, less stock found (ADJUSTMENT_IN). Opening stock is not P&L.
 *  - Expenses are recognised on the expense date whether paid or not.
 *  - Purchases and vendor payments are NOT expenses: purchases become inventory and reach the P&L
 *    only as COGS when sold, so paying vendor credit never counts the same cost twice.
 */
export async function profitAndLoss(range: DateRange) {
  const dateMatch = { $gte: range.from, $lte: range.to };

  const [salesLines, returnLines, movementAgg, prVariance, expenseAgg, categories] = await Promise.all([
    SaleModel.aggregate([
      { $match: { status: 'COMPLETED', date: dateMatch } },
      { $unwind: '$items' },
      {
        $group: {
          _id: { rt: '$items.revenueType', rp: '$items.isRepairPart' },
          revenue: { $sum: '$items.taxableAmount' },
          tax: { $sum: '$items.taxAmount' },
          cost: { $sum: '$items.costTotal' },
        },
      },
    ]),
    SalesReturnModel.aggregate([
      { $match: { date: dateMatch } },
      { $unwind: '$items' },
      {
        $group: {
          _id: { rt: '$items.revenueType', rp: '$items.isRepairPart' },
          revenue: { $sum: '$items.taxableAmount' },
          tax: { $sum: '$items.taxAmount' },
          cost: { $sum: '$items.costTotal' },
        },
      },
    ]),
    StockMovementModel.aggregate([
      { $match: { date: dateMatch, type: { $in: ['ADJUSTMENT_OUT', 'DAMAGED', 'SALE_RETURN_DAMAGED', 'ADJUSTMENT_IN'] } } },
      { $group: { _id: '$type', value: { $sum: '$value' } } },
    ]),
    PurchaseReturnModel.aggregate([{ $match: { date: dateMatch } }, { $group: { _id: null, v: { $sum: '$costVariance' } } }]),
    ExpenseModel.aggregate([{ $match: { status: 'ACTIVE', date: dateMatch } }, { $group: { _id: '$category', name: { $first: '$categoryName' }, amount: { $sum: '$amount' } } }]),
    ExpenseCategoryModel.find().lean(),
  ]);

  const bucket = (rows: Array<{ _id: { rt: string; rp?: boolean }; revenue: number; tax: number; cost: number }>) => {
    const out = { product: 0, sparePart: 0, labor: 0, tax: 0, productCost: 0, repairCost: 0 };
    for (const row of rows) {
      out.tax += row.tax;
      if (row._id.rt === 'PRODUCT' && !row._id.rp) {
        out.product += row.revenue;
        out.productCost += row.cost;
      } else if (row._id.rt === 'LABOR') {
        out.labor += row.revenue;
        out.repairCost += row.cost;
      } else {
        out.sparePart += row.revenue;
        out.repairCost += row.cost;
      }
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, r(v)])) as typeof out;
  };
  const s = bucket(salesLines);
  const ret = bucket(returnLines);

  const mv = Object.fromEntries(movementAgg.map((m) => [m._id, m.value as number]));
  const writeOffs = r(
    (mv.ADJUSTMENT_OUT ?? 0) + (mv.DAMAGED ?? 0) + (mv.SALE_RETURN_DAMAGED ?? 0) + (prVariance[0]?.v ?? 0) - (mv.ADJUSTMENT_IN ?? 0),
  );

  const kindOf = new Map(categories.map((c) => [String(c._id), (c as { kind?: string }).kind ?? 'OPERATING']));
  const expenseBreakdown = expenseAgg
    .map((e) => ({ categoryId: e._id, category: e.name, kind: kindOf.get(String(e._id)) ?? 'OPERATING', amount: r(e.amount) }))
    .sort((a, b) => b.amount - a.amount);
  const operatingExpenses = add(...expenseBreakdown.filter((e) => e.kind === 'OPERATING').map((e) => e.amount));
  const otherExpenses = add(...expenseBreakdown.filter((e) => e.kind === 'OTHER').map((e) => e.amount));

  const productSalesRevenue = s.product;
  const sparePartRevenue = s.sparePart;
  const repairLaborRevenue = s.labor;
  const grossRevenue = add(productSalesRevenue, sparePartRevenue, repairLaborRevenue);
  const salesReturns = add(ret.product, ret.sparePart, ret.labor);
  const netRevenue = sub(grossRevenue, salesReturns);
  const costOfGoodsSold = sub(s.productCost, ret.productCost);
  const repairPartsCost = sub(s.repairCost, ret.repairCost);
  const directCosts = add(costOfGoodsSold, repairPartsCost, writeOffs);
  const grossProfit = sub(netRevenue, directCosts);
  const netOperatingProfit = sub(grossProfit, operatingExpenses);
  const otherIncome = 0;
  const netProfit = sub(add(netOperatingProfit, otherIncome), otherExpenses);

  return {
    range,
    basis: 'ACCRUAL',
    productSalesRevenue,
    sparePartRevenue,
    repairLaborRevenue,
    grossRevenue,
    salesReturns,
    returnsBreakdown: { product: ret.product, sparePart: ret.sparePart, labor: ret.labor },
    netRevenue,
    costOfGoodsSold,
    repairPartsCost,
    inventoryWriteOffs: writeOffs,
    directCosts,
    grossProfit,
    grossMarginPct: netRevenue ? Number(((grossProfit / netRevenue) * 100).toFixed(2)) : 0,
    operatingExpenses,
    netOperatingProfit,
    otherIncome,
    otherExpenses,
    netProfit,
    taxCollected: sub(s.tax, ret.tax),
    expenseBreakdown,
  };
}

/** Daily series + category / product breakdowns for the P&L charts. */
export async function profitAndLossDetail(range: DateRange) {
  const dateMatch = { $gte: range.from, $lte: range.to };
  const [salesDaily, returnsDaily, expensesDaily, writeOffDaily, byCategory, byProduct] = await Promise.all([
    SaleModel.aggregate([
      { $match: { status: 'COMPLETED', date: dateMatch } },
      { $unwind: '$items' },
      { $group: { _id: dateKey('$date'), revenue: { $sum: '$items.taxableAmount' }, cost: { $sum: '$items.costTotal' } } },
    ]),
    SalesReturnModel.aggregate([
      { $match: { date: dateMatch } },
      { $unwind: '$items' },
      { $group: { _id: dateKey('$date'), revenue: { $sum: '$items.taxableAmount' }, cost: { $sum: '$items.costTotal' } } },
    ]),
    ExpenseModel.aggregate([{ $match: { status: 'ACTIVE', date: dateMatch } }, { $group: { _id: dateKey('$date'), amount: { $sum: '$amount' } } }]),
    StockMovementModel.aggregate([
      { $match: { date: dateMatch, type: { $in: ['ADJUSTMENT_OUT', 'DAMAGED', 'SALE_RETURN_DAMAGED', 'ADJUSTMENT_IN'] } } },
      { $group: { _id: dateKey('$date'), value: { $sum: { $cond: [{ $eq: ['$type', 'ADJUSTMENT_IN'] }, { $multiply: ['$value', -1] }, '$value'] } } } },
    ]),
    SaleModel.aggregate([
      { $match: { status: 'COMPLETED', date: dateMatch } },
      { $unwind: '$items' },
      {
        $group: {
          _id: { $ifNull: ['$items.category', { $cond: [{ $eq: ['$items.itemType', 'SERVICE'] }, 'Service', 'Uncategorised'] }] },
          revenue: { $sum: '$items.taxableAmount' },
          cost: { $sum: '$items.costTotal' },
          qty: { $sum: '$items.qty' },
        },
      },
      { $sort: { revenue: -1 } },
    ]),
    SaleModel.aggregate([
      { $match: { status: 'COMPLETED', date: dateMatch } },
      { $unwind: '$items' },
      { $group: { _id: '$items.name', revenue: { $sum: '$items.taxableAmount' }, cost: { $sum: '$items.costTotal' }, qty: { $sum: '$items.qty' } } },
      { $sort: { revenue: -1 } },
      { $limit: 20 },
    ]),
  ]);
  const map = <T extends { _id: string }>(rows: T[]) => new Map(rows.map((x) => [x._id, x]));
  const sd = map(salesDaily);
  const rd = map(returnsDaily);
  const ed = map(expensesDaily);
  const wd = map(writeOffDaily);
  const series = dayKeys(range).map((day) => {
    const revenue = sub(r(sd.get(day)?.revenue), r(rd.get(day)?.revenue));
    const cost = sub(r(sd.get(day)?.cost), r(rd.get(day)?.cost));
    const writeOff = r(wd.get(day)?.value);
    const expenses = r(ed.get(day)?.amount);
    const grossProfit = sub(revenue, cost, writeOff);
    return { date: day, revenue, cost, expenses, grossProfit, netProfit: sub(grossProfit, expenses) };
  });
  const withProfit = (rows: Array<{ _id: string; revenue: number; cost: number; qty: number }>) =>
    rows.map((x) => ({ name: x._id, revenue: r(x.revenue), cost: r(x.cost), profit: sub(r(x.revenue), r(x.cost)), qty: x.qty }));
  return { series, byCategory: withProfit(byCategory), byProduct: withProfit(byProduct) };
}

export async function salesReport(range: DateRange) {
  const dateMatch = { $gte: range.from, $lte: range.to };
  const match = { status: 'COMPLETED', date: dateMatch };
  const [summary, cancelled, daily, byCategory, topProducts, byUser, methods, returns] = await Promise.all([
    SaleModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          subtotal: { $sum: '$subtotal' },
          discount: { $sum: { $add: ['$itemDiscount', '$billDiscount'] } },
          tax: { $sum: '$taxAmount' },
          total: { $sum: '$grandTotal' },
          due: { $sum: '$balanceDue' },
        },
      },
    ]),
    SaleModel.aggregate([{ $match: { status: 'CANCELLED', date: dateMatch } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$grandTotal' } } }]),
    SaleModel.aggregate([{ $match: match }, { $group: { _id: dateKey('$date'), count: { $sum: 1 }, total: { $sum: '$grandTotal' } } }]),
    SaleModel.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: { $ifNull: ['$items.category', 'Service'] }, qty: { $sum: '$items.qty' }, total: { $sum: '$items.netTotal' } } },
      { $sort: { total: -1 } },
    ]),
    SaleModel.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: '$items.name', qty: { $sum: '$items.qty' }, total: { $sum: '$items.netTotal' } } },
      { $sort: { total: -1 } },
      { $limit: 15 },
    ]),
    SaleModel.aggregate([
      { $match: match },
      { $group: { _id: '$createdBy', count: { $sum: 1 }, total: { $sum: '$grandTotal' } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $project: { count: 1, total: 1, name: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, 'Unknown'] } } },
    ]),
    CustomerPaymentModel.aggregate([
      { $match: { status: 'ACTIVE', date: dateMatch } },
      { $unwind: '$methods' },
      {
        $group: {
          _id: '$methods.method',
          received: { $sum: { $cond: [{ $eq: ['$type', 'REFUND'] }, 0, '$methods.amount'] } },
          refunded: { $sum: { $cond: [{ $eq: ['$type', 'REFUND'] }, '$methods.amount', 0] } },
        },
      },
    ]),
    SalesReturnModel.aggregate([{ $match: { date: dateMatch } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$totalAmount' } } }]),
  ]);
  const dmap = new Map(daily.map((d) => [d._id, d]));
  return {
    summary: {
      invoices: summary[0]?.count ?? 0,
      subtotal: r(summary[0]?.subtotal),
      discount: r(summary[0]?.discount),
      tax: r(summary[0]?.tax),
      total: r(summary[0]?.total),
      outstanding: r(summary[0]?.due),
      cancelledCount: cancelled[0]?.count ?? 0,
      cancelledTotal: r(cancelled[0]?.total),
      returnsCount: returns[0]?.count ?? 0,
      returnsTotal: r(returns[0]?.total),
      netSales: sub(r(summary[0]?.total), r(returns[0]?.total)),
    },
    daily: dayKeys(range).map((d) => ({ date: d, count: dmap.get(d)?.count ?? 0, total: r(dmap.get(d)?.total) })),
    byCategory: byCategory.map((c) => ({ name: c._id, qty: c.qty, total: r(c.total) })),
    topProducts: topProducts.map((c) => ({ name: c._id, qty: c.qty, total: r(c.total) })),
    byUser: byUser.map((u) => ({ name: u.name, count: u.count, total: r(u.total) })),
    paymentMethods: methods.map((m) => ({ method: m._id, received: r(m.received), refunded: r(m.refunded), net: sub(r(m.received), r(m.refunded)) })),
  };
}

export async function purchaseReport(range: DateRange) {
  const dateMatch = { $gte: range.from, $lte: range.to };
  const match = { status: 'RECEIVED', date: dateMatch };
  const [summary, byVendor, daily, topItems, returns] = await Promise.all([
    PurchaseModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          total: { $sum: '$grandTotal' },
          tax: { $sum: '$taxAmount' },
          charges: { $sum: { $add: ['$shippingCharges', '$otherCharges'] } },
          paid: { $sum: '$amountPaid' },
          due: { $sum: '$balanceDue' },
        },
      },
    ]),
    PurchaseModel.aggregate([
      { $match: match },
      { $group: { _id: '$vendor', name: { $first: '$vendorName' }, count: { $sum: 1 }, total: { $sum: '$grandTotal' }, due: { $sum: '$balanceDue' } } },
      { $sort: { total: -1 } },
    ]),
    PurchaseModel.aggregate([{ $match: match }, { $group: { _id: dateKey('$date'), count: { $sum: 1 }, total: { $sum: '$grandTotal' } } }]),
    PurchaseModel.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: '$items.name', qty: { $sum: { $add: ['$items.qty', '$items.freeQty'] } }, total: { $sum: '$items.lineTotal' } } },
      { $sort: { total: -1 } },
      { $limit: 15 },
    ]),
    PurchaseReturnModel.aggregate([{ $match: { date: dateMatch } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$totalAmount' } } }]),
  ]);
  const dmap = new Map(daily.map((d) => [d._id, d]));
  return {
    summary: {
      purchases: summary[0]?.count ?? 0,
      total: r(summary[0]?.total),
      tax: r(summary[0]?.tax),
      charges: r(summary[0]?.charges),
      paid: r(summary[0]?.paid),
      outstanding: r(summary[0]?.due),
      returnsCount: returns[0]?.count ?? 0,
      returnsTotal: r(returns[0]?.total),
    },
    byVendor: byVendor.map((v) => ({ vendorId: v._id, name: v.name, count: v.count, total: r(v.total), due: r(v.due) })),
    daily: dayKeys(range).map((d) => ({ date: d, count: dmap.get(d)?.count ?? 0, total: r(dmap.get(d)?.total) })),
    topItems: topItems.map((i) => ({ name: i._id, qty: i.qty, total: r(i.total) })),
  };
}

export async function inventoryReport() {
  const [byCategory, totals, lowStock, damaged] = await Promise.all([
    ProductModel.aggregate([
      { $match: { trackInventory: true, isActive: true } },
      { $lookup: { from: 'productcategories', localField: 'category', foreignField: '_id', as: 'c' } },
      {
        $group: {
          _id: { $ifNull: [{ $arrayElemAt: ['$c.name', 0] }, 'Uncategorised'] },
          items: { $sum: 1 },
          qty: { $sum: { $max: ['$stockQty', 0] } },
          value: { $sum: { $multiply: [{ $max: ['$stockQty', 0] }, '$avgCost'] } },
          retailValue: { $sum: { $multiply: [{ $max: ['$stockQty', 0] }, '$sellingPrice'] } },
        },
      },
      { $sort: { value: -1 } },
    ]),
    ProductModel.aggregate([
      { $match: { trackInventory: true, isActive: true } },
      {
        $group: {
          _id: null,
          items: { $sum: 1 },
          qty: { $sum: { $max: ['$stockQty', 0] } },
          value: { $sum: { $multiply: [{ $max: ['$stockQty', 0] }, '$avgCost'] } },
          retailValue: { $sum: { $multiply: [{ $max: ['$stockQty', 0] }, '$sellingPrice'] } },
          outOfStock: { $sum: { $cond: [{ $lte: ['$stockQty', 0] }, 1, 0] } },
          damagedQty: { $sum: '$damagedQty' },
          damagedValue: { $sum: { $multiply: ['$damagedQty', '$avgCost'] } },
        },
      },
    ]),
    ProductModel.find({ trackInventory: true, isActive: true, $expr: { $lte: ['$stockQty', '$minStock'] } })
      .select('productCode name sku stockQty minStock unit avgCost sellingPrice preferredVendor')
      .populate('preferredVendor', 'name mobile')
      .sort({ stockQty: 1 })
      .limit(200)
      .lean(),
    ProductModel.find({ damagedQty: { $gt: 0 } }).select('productCode name damagedQty avgCost').lean(),
  ]);
  const t = totals[0] ?? {};
  return {
    totals: {
      items: t.items ?? 0,
      qty: t.qty ?? 0,
      value: r(t.value),
      retailValue: r(t.retailValue),
      outOfStock: t.outOfStock ?? 0,
      damagedQty: t.damagedQty ?? 0,
      damagedValue: r(t.damagedValue),
      lowStock: lowStock.length,
    },
    byCategory: byCategory.map((c) => ({ name: c._id, items: c.items, qty: c.qty, value: r(c.value), retailValue: r(c.retailValue) })),
    lowStock,
    damaged: damaged.map((d) => ({ ...d, value: r(d.damagedQty * (d.avgCost ?? 0)) })),
  };
}

export async function expenseReport(range: DateRange, groupBy: 'day' | 'week' | 'month' = 'day') {
  const dateMatch = { $gte: range.from, $lte: range.to };
  const match = { status: 'ACTIVE', date: dateMatch };
  const [summary, byCategory, byPeriod, byMethod] = await Promise.all([
    ExpenseModel.aggregate([
      { $match: match },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' }, paid: { $sum: '$amountPaid' }, due: { $sum: '$balanceDue' } } },
    ]),
    ExpenseModel.aggregate([
      { $match: match },
      { $group: { _id: '$categoryName', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      { $sort: { amount: -1 } },
    ]),
    ExpenseModel.aggregate([{ $match: match }, { $group: { _id: dateKey('$date', groupBy), amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    ExpenseModel.aggregate([
      { $match: { status: 'ACTIVE' } },
      { $unwind: '$payments' },
      { $match: { 'payments.date': dateMatch } },
      { $group: { _id: '$payments.method', amount: { $sum: '$payments.amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
  ]);
  return {
    summary: { count: summary[0]?.count ?? 0, amount: r(summary[0]?.amount), paid: r(summary[0]?.paid), outstanding: r(summary[0]?.due) },
    byCategory: byCategory.map((c) => ({ name: c._id, count: c.count, amount: r(c.amount) })),
    byPeriod: byPeriod.map((p) => ({ period: p._id, count: p.count, amount: r(p.amount) })),
    byPaymentMethod: byMethod.map((m) => ({ method: m._id, count: m.count, amount: r(m.amount) })),
  };
}

export async function dashboardSummary(today: DateRange) {
  const dateMatch = { $gte: today.from, $lte: today.to };
  const [pl, sales, purchases, expenses, custCredit, vendCredit, lowStock, pendingRepairs] = await Promise.all([
    profitAndLoss(today),
    SaleModel.aggregate([{ $match: { status: 'COMPLETED', date: dateMatch } }, { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } }]),
    PurchaseModel.aggregate([{ $match: { status: 'RECEIVED', date: dateMatch } }, { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } }]),
    ExpenseModel.aggregate([{ $match: { status: 'ACTIVE', date: dateMatch } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    CustomerModel.aggregate([{ $match: { balance: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$balance' }, count: { $sum: 1 } } }]),
    VendorModel.aggregate([{ $match: { balance: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$balance' }, count: { $sum: 1 } } }]),
    ProductModel.countDocuments({ trackInventory: true, isActive: true, $expr: { $lte: ['$stockQty', '$minStock'] } }),
    RepairJobModel.countDocuments({ status: { $nin: ['DELIVERED', 'CANCELLED'] } }),
  ]);
  return {
    todaySales: r(sales[0]?.total),
    todaySalesCount: sales[0]?.count ?? 0,
    todayPurchases: r(purchases[0]?.total),
    todayPurchasesCount: purchases[0]?.count ?? 0,
    todayExpenses: r(expenses[0]?.total),
    todayExpensesCount: expenses[0]?.count ?? 0,
    todayGrossProfit: pl.grossProfit,
    todayNetProfit: pl.netProfit,
    outstandingCustomerCredit: r(custCredit[0]?.total),
    customersWithCredit: custCredit[0]?.count ?? 0,
    outstandingVendorCredit: r(vendCredit[0]?.total),
    vendorsWithCredit: vendCredit[0]?.count ?? 0,
    lowStockItems: lowStock,
    pendingRepairs,
  };
}

export async function salesTrend(range: DateRange) {
  const daily = await SaleModel.aggregate([
    { $match: { status: 'COMPLETED', date: { $gte: range.from, $lte: range.to } } },
    { $group: { _id: dateKey('$date'), total: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
  ]);
  const map = new Map(daily.map((d) => [d._id, d]));
  return dayKeys(range).map((d) => ({ date: d, total: r(map.get(d)?.total), count: map.get(d)?.count ?? 0 }));
}
