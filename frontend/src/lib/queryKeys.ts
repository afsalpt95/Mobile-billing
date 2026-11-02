/** Central query-key factory so mutations can invalidate precisely. */
export const qk = {
  me: ['me'] as const,
  settings: ['settings'] as const,
  dashboard: ['dashboard'] as const,
  customers: ['customers'] as const,
  customer: (id: string) => ['customers', 'detail', id] as const,
  customerCredit: ['customer-credit'] as const,
  vendors: ['vendors'] as const,
  vendor: (id: string) => ['vendors', 'detail', id] as const,
  vendorCredit: ['vendor-credit'] as const,
  products: ['products'] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  master: (name: string) => ['master', name] as const,
  sales: ['sales'] as const,
  sale: (id: string) => ['sales', 'detail', id] as const,
  purchases: ['purchases'] as const,
  purchase: (id: string) => ['purchases', 'detail', id] as const,
  repairs: ['repairs'] as const,
  repair: (id: string) => ['repairs', 'detail', id] as const,
  inventory: ['inventory'] as const,
  expenses: ['expenses'] as const,
  payments: ['payments'] as const,
  returns: ['returns'] as const,
  reports: ['reports'] as const,
  users: ['users'] as const,
};

/** Everything that changes when money or stock moves. */
export const financialKeys = [qk.dashboard, qk.reports, qk.inventory, qk.products, qk.customers, qk.customerCredit, qk.vendors, qk.vendorCredit, qk.payments, qk.sales, qk.purchases, qk.repairs, qk.returns, qk.expenses];
