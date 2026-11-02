export type Role = 'ADMIN' | 'CASHIER' | 'TECHNICIAN' | 'ACCOUNTANT';

export interface Me {
  id: string;
  name: string;
  username: string;
  email?: string;
  role: Role;
  permissions: string[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  summary?: Record<string, number>;
}

export interface Ref {
  _id: string;
  name: string;
}

export interface MasterItem {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  kind?: string;
  brand?: Ref | string;
  deviceCategory?: Ref | string;
}

export interface Customer {
  _id: string;
  name: string;
  mobile?: string;
  altMobile?: string;
  email?: string;
  address?: string;
  notes?: string;
  isWalkIn?: boolean;
  isActive: boolean;
  balance: number;
  totalSales: number;
  totalPaid: number;
  lastPurchaseAt?: string;
  stats?: { openInvoices: number; outstanding: number; overdue: number; repairs: number };
}

export interface Vendor {
  _id: string;
  name: string;
  contactPerson?: string;
  mobile?: string;
  altMobile?: string;
  email?: string;
  address?: string;
  taxId?: string;
  vendorType?: Ref;
  paymentTermsDays: number;
  notes?: string;
  isActive: boolean;
  balance: number;
  advanceBalance: number;
  totalPurchases: number;
  totalPaid: number;
  lastPaymentAt?: string;
  stats?: { openInvoices: number; outstanding: number; overdue: number };
}

export type ProductType = 'PHONE' | 'SPARE_PART' | 'ACCESSORY' | 'CONSUMABLE' | 'SERVICE' | 'OTHER';

export interface Product {
  _id: string;
  productCode: string;
  sku?: string;
  barcode?: string;
  name: string;
  productType: ProductType;
  category?: Ref | null;
  deviceCategory?: Ref | null;
  brand?: Ref | null;
  deviceModel?: Ref | null;
  description?: string;
  purchaseCost: number;
  avgCost: number;
  sellingPrice: number;
  taxRate?: number | null;
  stockQty: number;
  damagedQty: number;
  minStock: number;
  unit: string;
  preferredVendor?: Ref | null;
  warrantyMonths: number;
  trackSerial: boolean;
  trackInventory: boolean;
  isActive: boolean;
  stockValue?: number;
  isLowStock?: boolean;
}

export interface MethodSplit {
  method: string;
  amount: number;
  reference?: string;
}

export interface SaleItem {
  _id: string;
  itemType: 'PRODUCT' | 'SERVICE';
  product?: string;
  name: string;
  category?: string;
  description?: string;
  revenueType: 'PRODUCT' | 'SPARE_PART' | 'LABOR';
  qty: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  billDiscountShare: number;
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
  netTotal: number;
  unitCost: number;
  costTotal: number;
  serials: string[];
  returnedQty: number;
  returnedAmount?: number;
  device?: { deviceCategoryName?: string; brandName?: string; deviceModelName?: string; imei?: string };
  complaint?: string;
  sparePart?: { name?: string; qty?: number; dealerName?: string };
  warranty?: { status: string; startDate?: string; expiryDate?: string };
}

export interface CustomerPayment {
  _id: string;
  receiptNo: string;
  type: 'RECEIPT' | 'ADVANCE' | 'REFUND';
  customer: string;
  customerName?: string;
  customerMobile?: string;
  date: string;
  amount: number;
  methods: MethodSplit[];
  allocations: Array<{ sale: string; invoiceNo: string; amount: number }>;
  unallocated?: number;
  source?: string;
  notes?: string;
  status: 'ACTIVE' | 'CANCELLED';
  createdBy?: { name: string } | string;
}

export interface Sale {
  _id: string;
  invoiceNo: string;
  date: string;
  customer: string;
  customerName: string;
  customerMobile?: string;
  items: SaleItem[];
  subtotal: number;
  itemDiscount: number;
  billDiscount: number;
  taxableAmount: number;
  taxAmount: number;
  grandTotal: number;
  costTotal: number;
  amountPaid: number;
  returnedAmount: number;
  refundedAmount: number;
  balanceDue: number;
  changeDue: number;
  tendered: MethodSplit[];
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
  status: 'COMPLETED' | 'CANCELLED';
  returnStatus: 'NONE' | 'PARTIAL' | 'FULL';
  dueDate?: string;
  repairJob?: string;
  notes?: string;
  cancelReason?: string;
  createdBy?: { name: string };
  payments?: CustomerPayment[];
  returns?: SalesReturn[];
  customerDetails?: Customer;
}

export interface SalesReturn {
  _id: string;
  returnNo: string;
  date: string;
  sale: string;
  invoiceNo: string;
  customerName: string;
  items: Array<{ saleItemId: string; name: string; qty: number; amount: number; restock: boolean; serials?: string[] }>;
  reason: string;
  totalAmount: number;
  adjustedAgainstDue: number;
  refundAmount: number;
  refundMethod?: string;
}

export interface PurchaseItem {
  _id: string;
  product: string;
  name: string;
  sku?: string;
  qty: number;
  freeQty: number;
  unitCost: number;
  discount: number;
  taxRate: number;
  lineTotal: number;
  taxAmount: number;
  chargesShare: number;
  landedUnitCost: number;
  serials: string[];
  receivedQty: number;
  returnedQty: number;
}

export interface VendorPayment {
  _id: string;
  paymentNo: string;
  type: 'PAYMENT' | 'ADVANCE_APPLIED' | 'REFUND_RECEIVED';
  vendor: string;
  vendorName: string;
  date: string;
  amount: number;
  method?: string;
  reference?: string;
  allocations: Array<{ purchase: string; purchaseNo: string; amount: number }>;
  advanceAmount: number;
  notes?: string;
  status: 'ACTIVE' | 'CANCELLED';
  createdBy?: { name: string } | string;
}

export interface Purchase {
  _id: string;
  purchaseNo: string;
  vendor: string;
  vendorName: string;
  vendorInvoiceNo?: string;
  date: string;
  dueDate?: string;
  status: 'DRAFT' | 'RECEIVED' | 'CANCELLED';
  returnStatus: 'NONE' | 'PARTIAL' | 'FULL';
  items: PurchaseItem[];
  subtotal: number;
  discount: number;
  taxAmount: number;
  shippingCharges: number;
  otherCharges: number;
  grandTotal: number;
  amountPaid: number;
  returnedAmount: number;
  balanceDue: number;
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
  paymentTerms?: string;
  initialPayment?: { amount: number; method?: string; reference?: string };
  notes?: string;
  attachmentRef?: string;
  cancelReason?: string;
  payments?: VendorPayment[];
  returns?: Array<{ _id: string; returnNo: string; date: string; totalAmount: number; reason: string; settlement: string }>;
  vendorDetails?: Vendor;
}

export type RepairStatus =
  | 'RECEIVED'
  | 'DIAGNOSIS_PENDING'
  | 'WAITING_APPROVAL'
  | 'WAITING_PARTS'
  | 'IN_PROGRESS'
  | 'READY_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

export interface RepairJob {
  _id: string;
  jobNo: string;
  customer: string;
  customerName: string;
  contactNumber?: string;
  deviceCategory?: string;
  deviceCategoryName?: string;
  brand?: string;
  brandName?: string;
  deviceModel?: string;
  deviceModelName?: string;
  imei?: string;
  conditionAtReceipt?: string;
  accessoriesReceived?: string;
  complaint: string;
  diagnosis?: string;
  estimatedCost: number;
  approvedCost: number;
  technician?: string;
  technicianName?: string;
  receivedAt: string;
  expectedDeliveryAt?: string;
  status: RepairStatus;
  statusHistory: Array<{ status: RepairStatus; at: string; byName?: string; note?: string }>;
  parts: Array<{ _id: string; product: string; name: string; qty: number; unitPrice: number; consumed: boolean }>;
  laborCharge: number;
  discount: number;
  advancePaid: number;
  warrantyType: 'NONE' | 'PARTS' | 'LABOR' | 'FULL';
  warrantyDays: number;
  warrantyExpiry?: string;
  internalNotes?: string;
  customerNotes?: string;
  sale?: string;
  invoiceNo?: string;
  completedAt?: string;
  deliveredAt?: string;
  cancelReason?: string;
  estimate: { partsTotal: number; total: number; balanceDue: number };
  payments?: CustomerPayment[];
  customerDetails?: Customer;
}

export interface Expense {
  _id: string;
  expenseNo: string;
  date: string;
  category: string;
  categoryName: string;
  description: string;
  amount: number;
  paidTo?: string;
  vendor?: string | Ref;
  payments: Array<{ _id: string; date: string; amount: number; method: string; reference?: string }>;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
  attachmentRef?: string;
  notes?: string;
  status: 'ACTIVE' | 'CANCELLED';
  createdByName?: string;
}

export interface LedgerStatement {
  opening: number;
  entries: Array<{ _id: string; date: string; type: string; refNo?: string; debit: number; credit: number; narration?: string; runningBalance: number }>;
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

export interface ShopSettings {
  shopName: string;
  address: string;
  phone: string;
  email: string;
  logo: string;
  taxRegistrationNo: string;
  currencyCode: string;
  currencySymbol: string;
  currencyPrecision: number;
  numbering: Record<string, string | number>;
  tax: { enabled: boolean; name: string; defaultRate: number; purchaseTaxInCost: boolean };
  billing: {
    walkInEnabled: boolean;
    walkInCustomer?: string;
    maxCashierDiscountPercent: number;
    allowStockOverride: boolean;
    defaultPaymentMethod: string;
    invoiceFooter: string;
    creditDueDays: number;
  };
  warranty: { defaultProductMonths: number; defaultRepairDays: number; terms: string };
  inventory: { defaultMinStock: number };
  vendorPayments: { defaultAllocation: 'OLDEST_FIRST' | 'MANUAL' };
}

export interface PaymentMethod extends MasterItem {
  kind: 'CASH' | 'DIGITAL' | 'CARD' | 'BANK' | 'OTHER';
}
