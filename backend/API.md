# REST API reference

Base URL: `http://localhost:5000/api/v1`. All bodies are JSON.

**Auth.** `POST /auth/login` sets an httpOnly cookie (`pos_token`). Browsers send it with
`credentials: 'include'`; other clients may send `Authorization: Bearer <token>` (the token
is also returned by login).

**Responses.**
```json
{ "success": true, "data": { ... }, "meta": { "duplicate": true } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [{ "path": "items.0.qty", "message": "..." }] } }
```
Lists return `data: { items, total, page, limit, pages }` and accept `page`, `limit` (max 200),
`q`, `from`, `to` (ISO date or datetime) plus the filters noted below.

**Status codes.** `200` OK (also an idempotent replay, with `meta.duplicate`), `201` created,
`401` not signed in, `403` role not permitted, `404`, `409` business conflict (codes such as
`INSUFFICIENT_STOCK`, `DUPLICATE_MOBILE`, `ALREADY_COMPLETED`, `ALREADY_CANCELLED`), `422`
validation, `503` transactions unavailable.

**Idempotency.** Posting endpoints accept `clientRequestId` (8–64 characters, for example a
UUID per form submission). Re-sending the same id returns the original record.

Money fields are decimals at the configured currency precision. Dates for reports are
`YYYY-MM-DD` in the shop's local time zone.

## Auth & users
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{username, password}` (rate limited) |
| POST | `/auth/logout` | clears cookie |
| GET | `/auth/me` | current user + permissions |
| POST | `/auth/change-password` | `{currentPassword, newPassword}` |
| GET/POST | `/users` | admin |
| PATCH | `/users/:id` | `{name, email, role, isActive, password}` |
| GET | `/users/technicians` | for repair assignment |
| GET | `/audit-logs` | admin |

## Dashboard & reports
| GET | Path | |
|---|---|---|
| | `/dashboard/summary` | today's figures |
| | `/dashboard/sales-trend?days=7` | |
| | `/dashboard/low-stock` | |
| | `/reports/profit-loss?from&to` | statement + `series`, `byCategory`, `byProduct`, `expenseBreakdown` |
| | `/reports/sales?from&to` | summary, daily, byCategory, topProducts, byUser, paymentMethods |
| | `/reports/purchases?from&to` | summary, byVendor, daily, topItems |
| | `/reports/inventory` | valuation, by category, low stock, damaged |
| | `/reports/expenses?from&to&groupBy=day\|week\|month` | |

## Customers & customer payments
| Method | Path | Notes |
|---|---|---|
| GET | `/customers` | `withBalance`, `active=true\|false\|all`, `includeWalkIn`, `sort=name\|-balance\|-lastPurchase\|-totalSales` |
| POST | `/customers` | `{name, mobile, altMobile, email, address, notes, allowDuplicate}` (409 `DUPLICATE_MOBILE` with `details.matches`) |
| GET/PATCH | `/customers/:id` | |
| GET | `/customers/check-mobile?mobile=` | duplicate warning |
| GET | `/customers/:id/ledger?from&to` | `{opening, entries[runningBalance], closing}` |
| GET | `/customers/:id/open-invoices` | |
| GET | `/customers/:id/history` | sales, repairs, payments |
| GET | `/customers/:id/warranties` | |
| GET | `/customer-credit` | customers with non-zero balance + overdue |
| GET | `/customer-payments` | `customer`, `type` |
| POST | `/customer-payments` | `{customerId, methods:[{method, amount, reference}], allocationMode: OLDEST_FIRST\|MANUAL, allocations:[{saleId, amount}]}` |
| GET | `/customer-payments/:id` | |
| POST | `/customer-payments/:id/cancel` | `{reason}` — reverses allocations |

## Vendors & vendor payments
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/vendors` | |
| GET/PATCH | `/vendors/:id` | |
| GET | `/vendors/:id/ledger?from&to` | running balance = payable − advance |
| GET | `/vendors/:id/open-purchases` | |
| GET | `/vendor-credit?q&all=true` | payables summary per vendor |
| GET | `/vendor-payments` | `vendor` |
| POST | `/vendor-payments` | `{vendorId, amount, method, reference, allocationMode, allocations:[{purchaseId, amount}], recordExcessAsAdvance}` |
| POST | `/vendor-payments/apply-advance` | `{vendorId, amount, allocationMode, allocations}` |
| POST | `/vendor-payments/refund` | refund received against an advance |
| GET | `/vendor-payments/:id` | |
| POST | `/vendor-payments/:id/cancel` | `{reason}` |

## Products, spare parts & inventory
| Method | Path | Notes |
|---|---|---|
| GET | `/products` | `type` (comma list), `category`, `brand`, `deviceModel`, `lowStock`, `inStock`, `active`, `sort` |
| POST | `/products` | `{name, productType, sku, barcode, categoryId, brandId, deviceModelId, sellingPrice, taxRate, minStock, trackSerial, openingStock:{qty, unitCost, serials}}` |
| GET/PATCH | `/products/:id` | stock / cost cannot be edited directly |
| GET | `/products/lookup?code=` | barcode / SKU / code / IMEI |
| GET | `/products/:id/serials?status=IN_STOCK` | |
| GET/POST | `/spare-parts` | products with `productType=SPARE_PART` |
| GET | `/inventory/stock` | stock items |
| GET | `/inventory/movements` | `product`, `type` |
| GET/POST | `/inventory/adjustments` | `{productId, type: ADJUSTMENT_IN\|ADJUSTMENT_OUT\|DAMAGED, qty, unitCost, reason}` (admin) |
| GET | `/inventory/valuation` | |

## Sales
| Method | Path | Notes |
|---|---|---|
| GET | `/sales` | `customer`, `status`, `paymentStatus` (comma list); `q` matches invoice, name, mobile, IMEI |
| POST | `/sales` | see below |
| GET | `/sales/:id` | includes payments and returns |
| GET | `/sales/:id/pdf` | invoice PDF |
| POST | `/sales/:id/payments` | `{methods:[...]}` — pays this invoice |
| POST | `/sales/:id/returns` | `{items:[{saleItemId, qty, restock, serials}], reason, refundMethod}` |
| POST | `/sales/:id/cancel` | `{reason, refundMethod}` (admin) |

`POST /sales` body:
```json
{
  "clientRequestId": "uuid",
  "customerId": "<id or walk-in id>",
  "items": [
    { "itemType": "PRODUCT", "productId": "...", "qty": 1, "unitPrice": 250, "discount": 0, "serials": ["IMEI"] },
    { "itemType": "SERVICE", "name": "Screen replacement", "qty": 1, "unitPrice": 1500,
      "device": { "deviceCategoryId": "...", "brandId": "...", "deviceModelId": "...", "imei": "..." },
      "complaint": "Cracked display", "sparePart": { "productId": "...", "qty": 1, "dealerId": "..." },
      "warranty": { "status": "NEW_WARRANTY", "startDate": "2026-10-12", "expiryDate": "2027-01-10" } }
  ],
  "billDiscount": 0,
  "payments": [{ "method": "Cash", "amount": 1000 }, { "method": "UPI", "amount": 500, "reference": "..." }],
  "dueDate": "2026-11-12",
  "allowStockOverride": false
}
```

## Purchases
| Method | Path | Notes |
|---|---|---|
| GET | `/purchases` | `vendor`, `status`, `paymentStatus` |
| POST | `/purchases` | `{vendorId, vendorInvoiceNo, date, dueDate, items:[{productId, qty, freeQty, unitCost, discount, taxRate, serials}], shippingCharges, otherCharges, initialPayment:{amount, method, reference}, receive}` |
| GET | `/purchases/:id` | |
| PUT | `/purchases/:id` | drafts only |
| POST | `/purchases/:id/receive` | posts stock + payable (once) |
| POST | `/purchases/:id/cancel` | `{reason}` |
| POST | `/purchases/:id/duplicate` | new draft copy |
| POST | `/purchases/:id/payments` | `{amount, method, reference}` |
| POST | `/purchases/:id/returns` | `{items:[{purchaseItemId, qty, serials}], reason, settlement: CREDIT_NOTE\|REFUND, refundMethod}` |
| GET | `/returns/sales`, `/returns/purchases` | return lists |

## Repairs
| Method | Path | Notes |
|---|---|---|
| GET | `/repairs` | `status` (comma list), `customer`, `technician` |
| POST | `/repairs` | job fields + `parts:[{productId, qty, unitPrice}]`, `advance:{methods}` |
| GET/PATCH | `/repairs/:id` | edit while open |
| PATCH | `/repairs/:id/status` | `{status, note, refundMethod}`; `CANCELLED` refunds advances |
| POST | `/repairs/:id/advance` | `{methods}` |
| POST | `/repairs/:id/complete` | `{payments, deliver}` — creates the invoice, consumes spares once |
| GET | `/warranty/lookup?q=` | by IMEI, invoice, job or mobile |

## Expenses
| Method | Path | Notes |
|---|---|---|
| GET | `/expenses` | `category`, `paymentStatus`, `status=ACTIVE\|CANCELLED\|ALL`, `method` (returns `summary`) |
| POST | `/expenses` | `{date, categoryId, description, amount, paidTo, vendorId, amountPaid, method, reference}` |
| GET/PATCH | `/expenses/:id` | |
| POST | `/expenses/:id/payments` | `{amount, method}` |
| POST | `/expenses/:id/cancel` | `{reason}` |

## Settings & master data
| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/settings` | PATCH admin; nested partial updates |
| GET/POST | `/{master}` | `product-categories` (alias `categories`), `device-categories`, `brands`, `device-models` (`?brand=`), `expense-categories`, `vendor-types`, `payment-methods`; query `q`, `active`, `limit` |
| PATCH | `/{master}/:id` | admin (rename / activate) |
