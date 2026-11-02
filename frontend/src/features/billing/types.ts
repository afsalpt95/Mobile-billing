import type { Option } from '@/components/ui/SearchSelect';
import type { Customer } from '@/types';

export type WarrantyStatus = 'NONE' | 'IN_WARRANTY' | 'OUT_OF_WARRANTY' | 'NEW_WARRANTY';

export interface BillItem {
  key: string;
  itemType: 'PRODUCT' | 'SERVICE';
  productId?: string;
  name: string;
  category?: string;
  description?: string;
  qty: number;
  unitPrice: number;
  discount: number;
  taxRate?: number;
  stock?: number;
  unit?: string;
  trackInventory?: boolean;
  trackSerial?: boolean;
  serials: string[];
  device?: {
    deviceCategoryId?: string;
    deviceCategoryName?: string;
    brandId?: string;
    brandName?: string;
    deviceModelId?: string;
    deviceModelName?: string;
    imei?: string;
  };
  complaint?: string;
  sparePart?: { productId: string; name: string; qty: number; stock?: number; dealerId?: string; dealerName?: string };
  warranty?: { status: WarrantyStatus; startDate?: string; expiryDate?: string };
}

export interface PaymentRow {
  method: string;
  amount: number | string;
  reference?: string;
}

export interface BillFormValues {
  customer: Option<Customer> | null;
  date: string;
  items: BillItem[];
  billDiscount: number | string;
  payments: PaymentRow[];
  dueDate: string;
  notes: string;
  allowStockOverride: boolean;
}
