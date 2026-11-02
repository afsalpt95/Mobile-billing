export const ROLES = ['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  role: Role;
}

/**
 * Permission matrix enforced by the backend (the frontend only uses it to hide controls).
 */
export const PERMISSIONS = {
  'dashboard.view': ['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT'],
  'customers.read': ['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT'],
  'customers.write': ['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT'],
  'vendors.read': ['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT'],
  'vendors.write': ['ADMIN', 'ACCOUNTANT', 'CASHIER'],
  'masters.read': ['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT'],
  'masters.write': ['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT'],
  'masters.manage': ['ADMIN'],
  'products.write': ['ADMIN', 'ACCOUNTANT', 'CASHIER'],
  'sales.read': ['ADMIN', 'CASHIER', 'ACCOUNTANT', 'TECHNICIAN'],
  'sales.create': ['ADMIN', 'CASHIER'],
  'sales.manualItem': ['ADMIN', 'CASHIER'],
  'sales.unlimitedDiscount': ['ADMIN'],
  'sales.stockOverride': ['ADMIN'],
  'sales.cancel': ['ADMIN'],
  'returns.sales': ['ADMIN', 'ACCOUNTANT', 'CASHIER'],
  'returns.purchases': ['ADMIN', 'ACCOUNTANT'],
  'customerPayments.create': ['ADMIN', 'CASHIER', 'ACCOUNTANT'],
  'customerPayments.cancel': ['ADMIN', 'ACCOUNTANT'],
  'purchases.read': ['ADMIN', 'ACCOUNTANT'],
  'purchases.write': ['ADMIN', 'ACCOUNTANT'],
  'purchases.cancel': ['ADMIN'],
  'vendorPayments.read': ['ADMIN', 'ACCOUNTANT'],
  'vendorPayments.create': ['ADMIN', 'ACCOUNTANT'],
  'vendorPayments.cancel': ['ADMIN'],
  'repairs.read': ['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT'],
  'repairs.write': ['ADMIN', 'CASHIER', 'TECHNICIAN'],
  'repairs.complete': ['ADMIN', 'CASHIER', 'TECHNICIAN'],
  'inventory.read': ['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT'],
  'inventory.adjust': ['ADMIN'],
  'expenses.read': ['ADMIN', 'ACCOUNTANT'],
  'expenses.write': ['ADMIN', 'ACCOUNTANT'],
  'reports.sales': ['ADMIN', 'ACCOUNTANT', 'CASHIER'],
  'reports.financial': ['ADMIN', 'ACCOUNTANT'],
  'settings.read': ['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT'],
  'settings.write': ['ADMIN'],
  'users.manage': ['ADMIN'],
  'audit.read': ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
