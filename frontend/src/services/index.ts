import { api, requestWithMeta } from '@/lib/api';
import type {
  Customer,
  CustomerPayment,
  Expense,
  LedgerStatement,
  MasterItem,
  Me,
  Paged,
  PaymentMethod,
  Product,
  Purchase,
  RepairJob,
  Sale,
  SalesReturn,
  ShopSettings,
  Vendor,
  VendorPayment,
} from '@/types';

type Q = Record<string, string | number | boolean | undefined | null>;

// ---------- auth ----------
export const authService = {
  login: (username: string, password: string) => api.post<{ user: Me }>('/auth/login', { username, password }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get<Me>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) => api.post('/auth/change-password', { currentPassword, newPassword }),
};

// ---------- master data ----------
export type MasterName = 'product-categories' | 'device-categories' | 'brands' | 'device-models' | 'expense-categories' | 'vendor-types' | 'payment-methods';
export const masterService = {
  list: <T = MasterItem>(name: MasterName, query?: Q) => api.get<T[]>(`/${name}`, query),
  create: <T = MasterItem>(name: MasterName, body: Record<string, unknown>) => api.post<T>(`/${name}`, body),
  update: <T = MasterItem>(name: MasterName, id: string, body: Record<string, unknown>) => api.patch<T>(`/${name}/${id}`, body),
  paymentMethods: () => api.get<PaymentMethod[]>('/payment-methods'),
};

// ---------- customers ----------
export const customerService = {
  list: (q?: Q) => api.get<Paged<Customer>>('/customers', q),
  get: (id: string) => api.get<Customer>(`/customers/${id}`),
  create: (body: Record<string, unknown>) => api.post<Customer>('/customers', body),
  update: (id: string, body: Record<string, unknown>) => api.patch<Customer>(`/customers/${id}`, body),
  checkMobile: (mobile: string, exclude?: string) => api.get<Array<{ _id: string; name: string; mobile: string }>>('/customers/check-mobile', { mobile, exclude }),
  ledger: (id: string, q?: Q) => api.get<LedgerStatement>(`/customers/${id}/ledger`, q),
  openInvoices: (id: string) => api.get<Sale[]>(`/customers/${id}/open-invoices`),
  history: (id: string) => api.get<{ sales: Sale[]; repairs: RepairJob[]; payments: CustomerPayment[] }>(`/customers/${id}/history`),
  warranties: (id: string) =>
    api.get<Array<{ _id: string; saleId: string; invoiceNo: string; name: string; serials: string[]; startDate: string; expiryDate: string; active: boolean }>>(
      `/customers/${id}/warranties`,
    ),
  credit: (q?: string) =>
    api.get<
      Array<{ _id: string; name: string; mobile: string; totalSales: number; totalPaid: number; balance: number; openInvoices: number; overdue: number; oldestInvoiceDate?: string; lastPurchaseAt?: string }>
    >('/customer-credit', { q }),
};

export const customerPaymentService = {
  list: (q?: Q) => api.get<Paged<CustomerPayment>>('/customer-payments', q),
  get: (id: string) => api.get<CustomerPayment>(`/customer-payments/${id}`),
  create: (body: Record<string, unknown>) => requestWithMeta<CustomerPayment>('POST', '/customer-payments', body),
  cancel: (id: string, reason: string) => api.post<CustomerPayment>(`/customer-payments/${id}/cancel`, { reason }),
};

// ---------- vendors ----------
export interface VendorCreditRow {
  _id: string;
  name: string;
  mobile?: string;
  totalPurchases: number;
  totalPaid: number;
  outstanding: number;
  advanceBalance: number;
  overdue: number;
  openInvoices: number;
  oldestUnpaid: { purchaseNo: string; date: string } | null;
  nextDueDate: string | null;
  lastPaymentAt?: string;
}
export const vendorService = {
  list: (q?: Q) => api.get<Paged<Vendor>>('/vendors', q),
  get: (id: string) => api.get<Vendor>(`/vendors/${id}`),
  create: (body: Record<string, unknown>) => api.post<Vendor>('/vendors', body),
  update: (id: string, body: Record<string, unknown>) => api.patch<Vendor>(`/vendors/${id}`, body),
  ledger: (id: string, q?: Q) => api.get<LedgerStatement>(`/vendors/${id}/ledger`, q),
  openPurchases: (id: string) => api.get<Purchase[]>(`/vendors/${id}/open-purchases`),
  credit: (q?: string, all?: boolean) => api.get<VendorCreditRow[]>('/vendor-credit', { q, all }),
};

export const vendorPaymentService = {
  list: (q?: Q) => api.get<Paged<VendorPayment>>('/vendor-payments', q),
  get: (id: string) => api.get<VendorPayment>(`/vendor-payments/${id}`),
  create: (body: Record<string, unknown>) => requestWithMeta<VendorPayment>('POST', '/vendor-payments', body),
  applyAdvance: (body: Record<string, unknown>) => api.post<VendorPayment>('/vendor-payments/apply-advance', body),
  refund: (body: Record<string, unknown>) => api.post<VendorPayment>('/vendor-payments/refund', body),
  cancel: (id: string, reason: string) => api.post<VendorPayment>(`/vendor-payments/${id}/cancel`, { reason }),
};

// ---------- products / inventory ----------
export const productService = {
  list: (q?: Q) => api.get<Paged<Product>>('/products', q),
  get: (id: string) => api.get<Product>(`/products/${id}`),
  create: (body: Record<string, unknown>) => api.post<Product>('/products', body),
  update: (id: string, body: Record<string, unknown>) => api.patch<Product>(`/products/${id}`, body),
  lookup: (code: string) => api.get<{ product: Product; serial: { serial: string; status: string } | null }>('/products/lookup', { code }),
  serials: (id: string, status?: string) => api.get<Array<{ _id: string; serial: string; status: string; invoiceNo?: string; purchaseNo?: string }>>(`/products/${id}/serials`, { status }),
};

export const inventoryService = {
  movements: (q?: Q) =>
    api.get<
      Paged<{ _id: string; product: string; productName: string; date: string; type: string; qty: number; damagedQty: number; unitCost: number; value: number; balanceAfter: number; refType: string; refId: string; refNo?: string; notes?: string; serials?: string[]; createdBy?: { name: string } }>
    >('/inventory/movements', q),
  adjustments: (q?: Q) => api.get<Paged<{ _id: string; adjustmentNo: string; date: string; product: { name: string; productCode: string }; type: string; qty: number; unitCost: number; value: number; reason: string; createdBy?: { name: string } }>>('/inventory/adjustments', q),
  adjust: (body: Record<string, unknown>) => api.post('/inventory/adjustments', body),
  valuation: () => api.get<any>('/inventory/valuation'),
};

// ---------- sales ----------
export const saleService = {
  list: (q?: Q) => api.get<Paged<Sale>>('/sales', q),
  get: (id: string) => api.get<Sale>(`/sales/${id}`),
  create: (body: Record<string, unknown>) => requestWithMeta<Sale>('POST', '/sales', body),
  pay: (id: string, body: Record<string, unknown>) => requestWithMeta<CustomerPayment>('POST', `/sales/${id}/payments`, body),
  return: (id: string, body: Record<string, unknown>) => requestWithMeta<SalesReturn>('POST', `/sales/${id}/returns`, body),
  cancel: (id: string, body: { reason: string; refundMethod?: string }) => api.post<Sale>(`/sales/${id}/cancel`, body),
};

export const returnService = {
  sales: (q?: Q) => api.get<Paged<SalesReturn>>('/returns/sales', q),
  purchases: (q?: Q) => api.get<Paged<any>>('/returns/purchases', q),
};

// ---------- purchases ----------
export const purchaseService = {
  list: (q?: Q) => api.get<Paged<Purchase>>('/purchases', q),
  get: (id: string) => api.get<Purchase>(`/purchases/${id}`),
  create: (body: Record<string, unknown>) => requestWithMeta<Purchase>('POST', '/purchases', body),
  update: (id: string, body: Record<string, unknown>) => api.put<Purchase>(`/purchases/${id}`, body),
  receive: (id: string) => api.post<Purchase>(`/purchases/${id}/receive`),
  cancel: (id: string, reason: string) => api.post<Purchase>(`/purchases/${id}/cancel`, { reason }),
  duplicate: (id: string) => api.post<Purchase>(`/purchases/${id}/duplicate`),
  pay: (id: string, body: Record<string, unknown>) => api.post<VendorPayment>(`/purchases/${id}/payments`, body),
  return: (id: string, body: Record<string, unknown>) => requestWithMeta<any>('POST', `/purchases/${id}/returns`, body),
};

// ---------- repairs ----------
export const repairService = {
  list: (q?: Q) => api.get<Paged<RepairJob>>('/repairs', q),
  get: (id: string) => api.get<Omit<RepairJob, 'sale'> & { sale?: Sale | null }>(`/repairs/${id}`),
  create: (body: Record<string, unknown>) => requestWithMeta<RepairJob>('POST', '/repairs', body),
  update: (id: string, body: Record<string, unknown>) => api.patch<RepairJob>(`/repairs/${id}`, body),
  status: (id: string, body: Record<string, unknown>) => api.patch<RepairJob>(`/repairs/${id}/status`, body),
  advance: (id: string, methods: Array<{ method: string; amount: number; reference?: string }>) => api.post<RepairJob>(`/repairs/${id}/advance`, { methods }),
  complete: (id: string, body: Record<string, unknown>) => requestWithMeta<{ repair: RepairJob; sale: Sale }>('POST', `/repairs/${id}/complete`, body),
  technicians: () => api.get<Array<{ _id: string; name: string; role: string }>>('/users/technicians'),
  warrantyLookup: (q: string) => api.get<{ sales: Sale[]; repairs: RepairJob[] }>('/warranty/lookup', { q }),
};

// ---------- expenses ----------
export const expenseService = {
  list: (q?: Q) => api.get<Paged<Expense> & { summary: { amount: number; paid: number; due: number } }>('/expenses', q),
  get: (id: string) => api.get<Expense>(`/expenses/${id}`),
  create: (body: Record<string, unknown>) => requestWithMeta<Expense>('POST', '/expenses', body),
  update: (id: string, body: Record<string, unknown>) => api.patch<Expense>(`/expenses/${id}`, body),
  pay: (id: string, body: Record<string, unknown>) => api.post<Expense>(`/expenses/${id}/payments`, body),
  cancel: (id: string, reason: string) => api.post<Expense>(`/expenses/${id}/cancel`, { reason }),
};

// ---------- reports / dashboard ----------
export interface DashboardSummary {
  todaySales: number;
  todaySalesCount: number;
  todayPurchases: number;
  todayPurchasesCount: number;
  todayExpenses: number;
  todayExpensesCount: number;
  todayGrossProfit: number;
  todayNetProfit: number;
  outstandingCustomerCredit: number;
  customersWithCredit: number;
  outstandingVendorCredit: number;
  vendorsWithCredit: number;
  lowStockItems: number;
  pendingRepairs: number;
}
export const reportService = {
  dashboard: () => api.get<DashboardSummary>('/dashboard/summary'),
  trend: (days = 7) => api.get<Array<{ date: string; total: number; count: number }>>('/dashboard/sales-trend', { days }),
  lowStock: () => api.get<Product[]>('/dashboard/low-stock'),
  profitLoss: (from: string, to: string) => api.get<any>('/reports/profit-loss', { from, to }),
  sales: (from: string, to: string) => api.get<any>('/reports/sales', { from, to }),
  purchases: (from: string, to: string) => api.get<any>('/reports/purchases', { from, to }),
  inventory: () => api.get<any>('/reports/inventory'),
  expenses: (from: string, to: string, groupBy: string) => api.get<any>('/reports/expenses', { from, to, groupBy }),
};

// ---------- settings / users ----------
export const settingsService = {
  get: () => api.get<ShopSettings>('/settings'),
  update: (body: Record<string, unknown>) => api.patch<ShopSettings>('/settings', body),
};
export const userService = {
  list: () => api.get<Array<{ _id: string; name: string; username: string; email?: string; role: string; isActive: boolean; lastLoginAt?: string }>>('/users'),
  create: (body: Record<string, unknown>) => api.post('/users', body),
  update: (id: string, body: Record<string, unknown>) => api.patch(`/users/${id}`, body),
  audit: (q?: Q) => api.get<Paged<{ _id: string; at: string; userName?: string; action: string; entity: string; refNo?: string; summary?: string }>>('/audit-logs', q),
};
