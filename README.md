# Mobile Shop POS — Billing, Repairs, Inventory & Accounts

A local-first point-of-sale and back-office system for a mobile phone shop: fast billing,
repair job cards, purchases, stock with IMEI tracking, customer and vendor credit, expenses,
returns and a Profit & Loss report.

```
mobile-shop-pos/
├── backend/    Express + TypeScript + Mongoose REST API (port 5000, prefix /api/v1)
├── frontend/   Next.js 15 + React 19 + TypeScript + Tailwind + TanStack Query (port 3000)
└── README.md
```

The frontend talks to the backend **only** through REST. The MongoDB connection string
lives only in `backend/.env`.

---

## 1. Requirements

- Node.js 20+ (tested with Node 24)
- MongoDB 6/7 running locally **as a replica set** (needed for transactions — see §2)

## 2. MongoDB setup

### Why a replica set?
Every financial posting (an invoice plus its stock deduction, payment and ledger entries) is
written in a **single multi-document transaction**, so a failure can never leave stock or
balances half-updated. MongoDB only supports transactions on a replica set. A **single-node**
replica set on your own PC is enough.

If the backend connects to a standalone server, it starts but **refuses postings** with HTTP 503
and a clear message. For development only, you can set
`MONGODB_REQUIRE_TRANSACTIONS=false`; then partial failures *can* leave data inconsistent.

### Option A — install MongoDB Community Server (recommended for the shop PC)
1. Download the MSI from https://www.mongodb.com/try/download/community and install it
   "as a Service" (or run `winget install MongoDB.Server`).
2. Enable the replica set. Edit `C:\Program Files\MongoDB\Server\<version>\bin\mongod.cfg` and add:
   ```yaml
   replication:
     replSetName: rs0
   ```
3. Restart the service (an elevated terminal): `net stop MongoDB && net start MongoDB`
4. Initialise the replica set once, using `mongosh` (install "MongoDB Shell" if needed):
   ```js
   rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] })
   rs.status().ok   // -> 1
   ```
5. Verify with `mongosh "mongodb://127.0.0.1:27017/?replicaSet=rs0" --eval "db.hello().setName"` (prints `rs0`).

### Option B — no installation (development)
```bash
cd backend
npm run db:local
```
This downloads a MongoDB binary (via `mongodb-memory-server`, ~600 MB once) and runs a
**persistent** single-node replica set on `127.0.0.1:27017`, storing data in
`backend/.mongo-data`. Keep that terminal open while you use the app.

### Connection string
`backend/.env`:
```
MONGODB_URI=mongodb://127.0.0.1:27017/mobile_shop_pos?replicaSet=rs0&directConnection=true
MONGODB_DB_NAME=mobile_shop_pos
```

## 3. First run

```bash
# 1. backend
cd backend
npm install
cp .env.example .env          # then set a long random JWT_SECRET
npm run seed                  # master data + development admin (idempotent)
npm run dev                   # http://localhost:5000/api/v1

# 2. frontend (second terminal)
cd frontend
npm install
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
npm run dev                   # http://localhost:3000
```

Sign in with **admin / Admin@12345** (from `SEED_ADMIN_*` in `.env`) and change the
password under **Settings → My account**. Then set the shop profile, tax and invoice prefixes
under **Settings**, and add staff under **Settings → Users & roles**.

> Open the app as `http://localhost:3000` (not `127.0.0.1:3000`): the session cookie is set
> for `localhost`, and mixing hosts makes the browser treat the API as cross-site.

### Running both together
Use two terminals as above, or for example `npx concurrently "npm --prefix backend run dev" "npm --prefix frontend run dev"`.

### Scripts

| Backend | |
|---|---|
| `npm run dev` | API with auto-reload (tsx) |
| `npm run build` / `npm start` | compile to `dist/` and run |
| `npm test` | Vitest + Supertest against an in-memory **replica set** |
| `npm run seed` | default categories, brands, models, expense categories, payment methods, vendor types, walk-in customer, admin |
| `npm run db:indexes` | create all collections and indexes (also runs at every start) |
| `npm run db:local` | persistent local replica set without installing MongoDB |
| `npm run typecheck` | TypeScript check |

| Frontend | |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Next.js |
| `npm test` | unit tests for the client-side bill calculator |
| `npm run typecheck` | TypeScript check |

The seed creates **no transactions**: every dashboard figure comes from your own postings.

---

## 4. Modules

| Module | Highlights |
|---|---|
| **Home** | POS grid of 14 module cards and 8 live figures (today's sales, purchases, expenses, gross profit, customer credit, vendor credit, low stock, pending repairs) |
| **Billing** | Searchable customer field with **+ Add** popup and "Add new …" from typed text, walk-in sales, barcode / SKU / IMEI scan, product and service lines (device, brand, model, IMEI, complaint, spare used + dealer, warranty), IMEI picker, line and bill discounts within role limits, tax, split / partial / credit payments, change due, idempotent save, print, preview, PDF. Shortcuts: F2 item, F4 customer, F8 payment, F9 save, F10 save & print |
| **Repairs** | Job card with condition, accessories, diagnosis, technician, estimates, reserved spares, labour, warranty, advances, status workflow and history, printable receipt; **Complete & invoice** deducts spares exactly once |
| **Purchases** | Draft → Receive, free qty, discounts, tax, shipping and other charges spread into landed cost, IMEI entry, initial payment, duplicate vendor-invoice check, cancel with full reversal, copy to new draft |
| **Inventory** | Stock list, low-stock filter, valuation, movement ledger linked to source documents, adjustments (in / out / damaged), IMEI history per product |
| **Customers / Customer credit** | Profiles, invoices, repairs, payments, warranty, ledger and statement (print and CSV), oldest-first or manual payment allocation, receipts, overdue figures |
| **Vendors / Vendor payments** | Payables per vendor (outstanding, overdue, oldest unpaid, next due, last payment), pay with oldest-first or manual allocation, excess as advance only when chosen explicitly, apply advance, refund received, cancel, statements |
| **Expenses** | Category master with popup add, paid / partial / unpaid (payables), pay later, edit, cancel, daily / weekly / monthly report, by category and by method |
| **Returns** | Customer returns (restock or damaged, refund or adjust against due) and vendor returns (credit note or refund), quantity limits, IMEI handling |
| **Reports** | Profit & Loss (statement, charts, by category / product, expense breakdown, CSV, print), sales report, purchase report |
| **Settings** | Shop profile and logo, currency, tax, billing rules, warranty defaults, numbering, all master data, users and roles, audit log |

## 5. Accounting & costing policy

**Inventory costing: weighted average.** Receiving stock recomputes
`avg = (onHand × avg + qty × landedUnitCost) / (onHand + qty)`.
Landed cost = line value after discount, plus purchase tax if *Settings → purchase tax is cost*
is on, plus a value-proportional share of shipping and other charges, divided by paid + free
units. Each sale line stores the average cost **at the moment of sale**, so later purchases never
change historical profit. A purchase cancellation or vendor return removes stock at the cost it
came in at, and backs it out of the average.

**Profit & Loss: accrual-basis management report.**

| Line | Source |
|---|---|
| Product sales revenue | Retail product lines on completed invoices, after line and bill discounts, **excluding tax** |
| Spare-part revenue | Parts billed on repair invoices |
| Repair labour revenue | Service / labour lines |
| Sales returns | Taxable value returned, on the return date |
| Cost of goods sold | Recorded cost of retail lines sold, less cost of those returned |
| Spare-part cost in repairs | Cost of parts on repair invoices and of spares consumed inside service lines |
| Inventory write-offs | Lost / damaged adjustments, damaged customer returns, losses on vendor returns, less stock found |
| Operating / other expenses | Expenses on their **expense date**, paid or not (category group decides operating vs other) |

- Purchases are **not** expenses. Stock reaches the P&L only as cost when sold, so paying a
  vendor never counts the same cost twice.
- Cancelled invoices are excluded from every period. Returns are recognised on the return date.
- Tax collected is shown separately as a liability, not as revenue.

**Balances.** `Customer.balance`, `Vendor.balance` and `Vendor.advanceBalance` change only in
`ledger.service.ts`, always together with a ledger entry in the same transaction. The test
suite asserts that every cached balance equals its ledger, and every product's stock equals
the sum of its stock movements.

## 6. Data integrity & security

- Multi-document **transactions** for every posting; automatic retry on write conflicts.
- **Atomic stock checks**: a conditional `$inc` with `stockQty >= qty`, so two cashiers can never
  sell the last unit twice.
- **Idempotency**: every posting form sends a `clientRequestId` (unique index). A retry or
  double-click returns the original document (`200` with `meta.duplicate`) instead of creating a
  second invoice, payment or stock movement.
- One-way state transitions: Draft → Received is a conditional update; a repair can only be
  completed while `sale == null`, and each spare carries a `consumed` flag.
- Nothing financial is deleted. Cancellations post reversing entries and are kept with a reason,
  and the audit log records who did what.
- JWT in an **httpOnly, SameSite=Lax cookie** (never readable by JavaScript); bcrypt (12 rounds);
  login rate limiting (10 attempts per 15 minutes); helmet headers; CORS restricted to
  `CORS_ORIGINS`; Zod validation on every request; sanitised error responses; regex search input
  escaped.
- Role-based access is enforced **on the backend** (`backend/src/types/index.ts`):

| Role | Can |
|---|---|
| Admin | everything, including cancellations, stock adjustments and override, settings, users |
| Cashier | billing (discounts up to the configured %), customers, repairs, customer payments, sales returns |
| Technician | repairs (create, update, complete), customers, read stock |
| Accountant | purchases, vendor payments, expenses, returns, all reports |

## 7. Tests

`backend/tests/workflows.test.ts` runs the required scenarios against a real (in-memory) replica
set. It covers: quick-create customer, category, brand and model; cash sale with stock deduction
and change; partial payment to customer credit; purchase receipt and landed cost; credit purchase
and payable; partial vendor payment; customer credit payment and ledger; expense reporting; repair
with spares (deducted once, double completion refused); sales return; vendor return; cancellation
of invoice, payment and purchase with reversals; low-stock alerts; exact P&L figures;
unauthorised and unauthenticated access; duplicate and concurrent submissions; last-unit race;
ledger and stock consistency; figures unchanged after reconnect. Pure calculation tests live in
`tests/calc.test.ts`, and the frontend mirror in `frontend/src/lib/money.test.ts`.

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `Could not connect to MongoDB` | Start the service (`net start MongoDB`) or `npm run db:local`; check `MONGODB_URI` |
| 503 "Database transactions are not available" | MongoDB is standalone. Configure the replica set (§2) and include `replicaSet=rs0` in the URI |
| `rs.initiate` host errors / server selection timeout | Use `127.0.0.1:27017` as the member host and add `directConnection=true` to the URI |
| Transaction write conflicts in logs | Normal under concurrency; they are retried automatically |
| CORS error in the browser console | `CORS_ORIGINS` in `backend/.env` must exactly match the frontend origin (`http://localhost:3000`) |
| Logged out immediately / 401 after login | Open the app via `localhost`, not `127.0.0.1`; check that the browser accepts cookies for localhost |
| `Port 5000 is already in use` | Change `PORT` in `backend/.env` and `NEXT_PUBLIC_API_URL` in `frontend/.env.local`, or stop the other process (`netstat -ano \| findstr :5000`) |
| Frontend on another port | `npm run dev -- -p 3001` and add that origin to `CORS_ORIGINS` |
| "Insufficient stock" | Receive a purchase or adjust stock; admins can enable *Allow stock override* in Settings |
| Forgot the admin password | Another admin can reset it in Settings → Users; or delete the `admin` user in MongoDB and re-run `npm run seed` |

## 9. Known limitations (initial version)

- **Partial receiving** of a purchase is not supported. A purchase goes Draft → Received in
  full. Received purchases are corrected by cancelling them (full reversal) and using *Copy to
  new draft*.
- **Other income** is not recorded separately (shown as 0 in the P&L).
- Customer **advances** exist only as repair-job advances; a customer payment larger than the
  outstanding invoices is rejected rather than held as credit.
- **Repair invoices** cannot be cancelled outright; use a sales return.
- **Serial-tracked items** cannot be adjusted manually; IMEIs move only through purchases, sales
  and returns.
- Tax is a single rate per line (no CGST/SGST/IGST split or HSN summary).
- Attachments (purchase invoices, expense receipts) are stored as **references** (text), not
  uploaded files. Only the shop logo is uploaded.
- Single shop, single currency; no multi-branch stock.
- Frontend automated tests cover only the bill calculator. The UI workflows are exercised
  through the backend API tests and a scripted end-to-end run of the same requests the forms
  send.

See [`backend/API.md`](backend/API.md) for the endpoint reference.
