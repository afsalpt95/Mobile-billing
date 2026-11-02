'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Card, DataTable, Pagination, SearchInput, Spinner, StatusBadge, Tabs } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { DeviceModelFormModal, MasterFormModal } from '@/features/masters/QuickCreate';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce, useSettings } from '@/hooks/useCommon';
import { errorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatDateTime, titleCase } from '@/lib/utils';
import { authService, masterService, userService, settingsService, type MasterName } from '@/services';
import type { MasterItem, ShopSettings } from '@/types';
import { userSchema, type UserValues } from '@/validations';

type Tab = 'shop' | 'billing' | 'numbering' | 'masters' | 'users' | 'audit' | 'account';

export default function SettingsPage() {
  return (
    <AppShell permission="settings.read">
      <Settings />
    </AppShell>
  );
}

function Settings() {
  const { can } = useAuth();
  const admin = can('settings.write');
  const [tab, setTab] = useState<Tab>(admin ? 'shop' : 'masters');
  return (
    <>
      <PageHeader title="Settings" crumbs={[{ label: 'Settings' }]} subtitle={admin ? undefined : 'Shop settings can only be changed by an administrator.'} />
      <div className="card">
        <Tabs<Tab>
          className="px-3"
          value={tab}
          onChange={setTab}
          tabs={[
            ...(admin
              ? ([
                  { value: 'shop', label: 'Shop profile' },
                  { value: 'billing', label: 'Billing, tax & defaults' },
                  { value: 'numbering', label: 'Numbering' },
                ] as const)
              : []),
            { value: 'masters', label: 'Master data' },
            ...(can('users.manage') ? ([{ value: 'users', label: 'Users & roles' }, { value: 'audit', label: 'Audit log' }] as const) : []),
            { value: 'account', label: 'My account' },
          ]}
        />
        <div className="p-4">
          {tab === 'shop' && <ShopTab />}
          {tab === 'billing' && <BillingTab />}
          {tab === 'numbering' && <NumberingTab />}
          {tab === 'masters' && <MastersTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'audit' && <AuditTab />}
          {tab === 'account' && <AccountTab />}
        </div>
      </div>
    </>
  );
}

function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => settingsService.update(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.settings });
      toast.success('Settings saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function ShopTab() {
  const { data: s, isLoading } = useSettings();
  const save = useSaveSettings();
  const form = useForm<Partial<ShopSettings>>();
  useEffect(() => {
    if (s) form.reset({ shopName: s.shopName, address: s.address, phone: s.phone, email: s.email, taxRegistrationNo: s.taxRegistrationNo, currencyCode: s.currencyCode, currencySymbol: s.currencySymbol, currencyPrecision: s.currencyPrecision, logo: s.logo });
  }, [s, form]);
  const logo = form.watch('logo');
  if (isLoading) return <Spinner />;
  return (
    <form className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate({ ...v, currencyPrecision: Number(v.currencyPrecision) }))}>
      <Field label="Shop name" required className="sm:col-span-2">
        <Input {...form.register('shopName', { required: true })} />
      </Field>
      <Field label="Address" className="sm:col-span-2">
        <Textarea rows={3} {...form.register('address')} />
      </Field>
      <Field label="Phone">
        <Input {...form.register('phone')} />
      </Field>
      <Field label="Email">
        <Input {...form.register('email')} />
      </Field>
      <Field label="Tax registration no. (e.g. GSTIN)" hint="Printed on invoices when set">
        <Input {...form.register('taxRegistrationNo')} />
      </Field>
      <Field label="Logo" hint="PNG/JPG under 250 KB, printed on invoices">
        <div className="flex items-center gap-3">
          {logo ? <img src={logo} alt="Shop logo" className="h-10 w-10 rounded object-contain ring-1 ring-slate-200" /> : null}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 250_000) return toast.error('Logo must be under 250 KB');
              const reader = new FileReader();
              reader.onload = () => form.setValue('logo', String(reader.result), { shouldDirty: true });
              reader.readAsDataURL(file);
            }}
          />
          {logo && (
            <Button size="sm" variant="ghost" onClick={() => form.setValue('logo', '', { shouldDirty: true })}>
              Remove
            </Button>
          )}
        </div>
      </Field>
      <Field label="Currency code">
        <Input {...form.register('currencyCode')} />
      </Field>
      <Field label="Currency symbol">
        <Input {...form.register('currencySymbol')} />
      </Field>
      <Field label="Currency precision (decimals)" hint="Locked once invoices exist">
        <Select {...form.register('currencyPrecision')}>
          {[0, 1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" loading={save.isPending}>
          Save shop profile
        </Button>
      </div>
    </form>
  );
}

function BillingTab() {
  const { data: s, isLoading } = useSettings();
  const { data: methods = [] } = useQuery({ queryKey: qk.master('payment-methods'), queryFn: masterService.paymentMethods });
  const save = useSaveSettings();
  const form = useForm<any>();
  useEffect(() => {
    if (s) form.reset({ tax: s.tax, billing: s.billing, warranty: s.warranty, inventory: s.inventory, vendorPayments: s.vendorPayments });
  }, [s, form]);
  if (isLoading) return <Spinner />;
  const submit = form.handleSubmit((v) =>
    save.mutate({
      tax: { enabled: v.tax.enabled, name: v.tax.name, defaultRate: Number(v.tax.defaultRate), purchaseTaxInCost: v.tax.purchaseTaxInCost },
      billing: {
        walkInEnabled: v.billing.walkInEnabled,
        maxCashierDiscountPercent: Number(v.billing.maxCashierDiscountPercent),
        allowStockOverride: v.billing.allowStockOverride,
        defaultPaymentMethod: v.billing.defaultPaymentMethod,
        invoiceFooter: v.billing.invoiceFooter,
        creditDueDays: Number(v.billing.creditDueDays),
      },
      warranty: { defaultProductMonths: Number(v.warranty.defaultProductMonths), defaultRepairDays: Number(v.warranty.defaultRepairDays), terms: v.warranty.terms },
      inventory: { defaultMinStock: Number(v.inventory.defaultMinStock) },
      vendorPayments: { defaultAllocation: v.vendorPayments.defaultAllocation },
    }),
  );
  return (
    <form className="grid gap-4 lg:grid-cols-2" onSubmit={submit}>
      <Card title="Tax">
        <div className="grid grid-cols-2 gap-3">
          <Checkbox className="col-span-2" label="Charge tax on invoices" {...form.register('tax.enabled')} />
          <Field label="Tax name">
            <Input {...form.register('tax.name')} />
          </Field>
          <Field label="Default rate %" hint="Products can override">
            <Input type="number" step="any" min={0} max={100} {...form.register('tax.defaultRate')} />
          </Field>
          <Checkbox className="col-span-2" label="Purchase tax is part of inventory cost (not recoverable)" {...form.register('tax.purchaseTaxInCost')} />
        </div>
      </Card>
      <Card title="Billing">
        <div className="grid grid-cols-2 gap-3">
          <Checkbox className="col-span-2" label="Enable walk-in customer for quick cash sales" {...form.register('billing.walkInEnabled')} />
          <Field label="Max cashier discount %">
            <Input type="number" min={0} max={100} {...form.register('billing.maxCashierDiscountPercent')} />
          </Field>
          <Field label="Default credit period (days)">
            <Input type="number" min={0} {...form.register('billing.creditDueDays')} />
          </Field>
          <Field label="Default payment method">
            <Select {...form.register('billing.defaultPaymentMethod')}>
              {methods.map((m) => (
                <option key={m._id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox className="col-span-2" label="Allow admins to sell beyond available stock (override)" {...form.register('billing.allowStockOverride')} />
          <Field label="Invoice footer" className="col-span-2">
            <Input {...form.register('billing.invoiceFooter')} />
          </Field>
        </div>
      </Card>
      <Card title="Warranty defaults">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Product warranty (months)">
            <Input type="number" min={0} {...form.register('warranty.defaultProductMonths')} />
          </Field>
          <Field label="Repair warranty (days)">
            <Input type="number" min={0} {...form.register('warranty.defaultRepairDays')} />
          </Field>
          <Field label="Warranty terms" className="col-span-2">
            <Textarea {...form.register('warranty.terms')} />
          </Field>
        </div>
      </Card>
      <Card title="Inventory & vendor payments">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default low-stock threshold" hint="Used for new products">
            <Input type="number" min={0} {...form.register('inventory.defaultMinStock')} />
          </Field>
          <Field label="Vendor payment allocation">
            <Select {...form.register('vendorPayments.defaultAllocation')}>
              <option value="OLDEST_FIRST">Oldest invoice first</option>
              <option value="MANUAL">Manual allocation</option>
            </Select>
          </Field>
        </div>
      </Card>
      <div className="lg:col-span-2">
        <Button type="submit" loading={save.isPending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}

function NumberingTab() {
  const { data: s, isLoading } = useSettings();
  const save = useSaveSettings();
  const form = useForm<Record<string, string | number>>();
  useEffect(() => {
    if (s) form.reset(s.numbering);
  }, [s, form]);
  if (isLoading) return <Spinner />;
  const fields: Array<[string, string]> = [
    ['invoicePrefix', 'Invoice'],
    ['purchasePrefix', 'Purchase'],
    ['repairPrefix', 'Repair job'],
    ['expensePrefix', 'Expense'],
    ['receiptPrefix', 'Customer receipt'],
    ['vendorPaymentPrefix', 'Vendor payment'],
    ['salesReturnPrefix', 'Sales return'],
    ['purchaseReturnPrefix', 'Purchase return'],
    ['adjustmentPrefix', 'Stock adjustment'],
  ];
  return (
    <form className="max-w-3xl space-y-3" onSubmit={form.handleSubmit((v) => save.mutate({ numbering: { ...Object.fromEntries(fields.map(([k]) => [k, v[k]])), padding: Number(v.padding) } }))}>
      <p className="text-sm text-slate-500">Numbers continue from the current sequence; changing a prefix affects new documents only. Numbers are always unique.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {fields.map(([k, label]) => (
          <Field key={k} label={`${label} prefix`}>
            <Input {...form.register(k)} />
          </Field>
        ))}
        <Field label="Number padding (digits)">
          <Input type="number" min={3} max={10} {...form.register('padding')} />
        </Field>
      </div>
      <Button type="submit" loading={save.isPending}>
        Save numbering
      </Button>
    </form>
  );
}

const MASTERS: Array<{ name: MasterName; label: string }> = [
  { name: 'product-categories', label: 'Product categories' },
  { name: 'device-categories', label: 'Device categories' },
  { name: 'brands', label: 'Brands' },
  { name: 'device-models', label: 'Device models' },
  { name: 'expense-categories', label: 'Expense categories' },
  { name: 'vendor-types', label: 'Vendor types' },
  { name: 'payment-methods', label: 'Payment methods' },
];

function MastersTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [master, setMaster] = useState<MasterName>('brands');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<MasterItem | null | undefined>(undefined);
  const search = useDebounce(q, 250);
  const label = MASTERS.find((m) => m.name === master)!.label;
  const { data, isLoading } = useQuery({ queryKey: [...qk.master(master), 'admin', search], queryFn: () => masterService.list(master, { q: search, active: 'all', limit: 500 }) });
  const toggle = useMutation({
    mutationFn: (m: MasterItem) => masterService.update(master, m._id, { isActive: !m.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.master(master) }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canAdd = can('masters.write') && (master !== 'payment-methods' || can('masters.manage'));
  const singular = label.replace(/ies$/, 'y').replace(/s$/, '');
  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <nav className="flex gap-1 overflow-x-auto md:flex-col">
        {MASTERS.map((m) => (
          <button key={m.name} type="button" onClick={() => setMaster(m.name)} className={`rounded-lg px-3 py-2 text-left text-sm font-medium whitespace-nowrap ${m.name === master ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>
            {m.label}
          </button>
        ))}
      </nav>
      <div className="rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={setQ} placeholder={`Search ${label.toLowerCase()}…`} className="w-full sm:w-64" />
          {canAdd && (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit(null)}>
              Add {singular.toLowerCase()}
            </Button>
          )}
        </div>
        <DataTable<MasterItem>
          loading={isLoading}
          rows={data}
          columns={[
            { key: 'n', header: 'Name', cell: (m) => <span className="font-medium">{m.name}</span> },
            ...(master === 'device-models' ? [{ key: 'b', header: 'Brand', cell: (m: MasterItem) => (typeof m.brand === 'object' ? m.brand?.name : '—') }] : []),
            ...(master === 'expense-categories' || master === 'payment-methods' ? [{ key: 'k', header: 'Type', cell: (m: MasterItem) => titleCase(m.kind) }] : []),
            { key: 'd', header: 'Description', cell: (m) => <span className="text-slate-500">{m.description}</span> },
            { key: 's', header: 'Status', cell: (m) => <StatusBadge status={m.isActive ? 'ACTIVE' : 'CANCELLED'} label={m.isActive ? 'Active' : 'Inactive'} /> },
            {
              key: 'a',
              header: '',
              cell: (m) =>
                can('masters.manage') && (
                  <div className="flex justify-end gap-1">
                    {master !== 'device-models' && (
                      <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(m)}>
                        Edit
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" icon={<Power className="h-3.5 w-3.5" />} onClick={() => toggle.mutate(m)}>
                      {m.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                ),
            },
          ]}
        />
      </div>
      {master === 'device-models' ? (
        <DeviceModelFormModal open={edit === null} onClose={() => setEdit(undefined)} />
      ) : (
        <MasterFormModal master={master} label={singular} open={edit !== undefined} item={edit} onClose={() => setEdit(undefined)} />
      )}
    </div>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: qk.users, queryFn: userService.list });
  const [add, setAdd] = useState(false);
  const [reset, setReset] = useState<{ id: string; name: string } | null>(null);
  const [pwd, setPwd] = useState('');
  const form = useForm<UserValues>({ resolver: zodResolver(userSchema), defaultValues: { role: 'CASHIER' } });
  const create = useMutation({
    mutationFn: (v: UserValues) => userService.create({ ...v, email: v.email || undefined }),
    onSuccess: async () => {
      toast.success('User created');
      setAdd(false);
      form.reset({ role: 'CASHIER' });
      await qc.invalidateQueries({ queryKey: qk.users });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => userService.update(id, body),
    onSuccess: async () => {
      toast.success('User updated');
      setReset(null);
      setPwd('');
      await qc.invalidateQueries({ queryKey: qk.users });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const e = form.formState.errors;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Admin: everything · Cashier: billing, customers, repairs, collections · Technician: repairs · Accountant: purchases, vendor payments, expenses, reports.</p>
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdd(true)}>
          Add user
        </Button>
      </div>
      <DataTable
        loading={isLoading}
        rows={data}
        columns={[
          { key: 'n', header: 'Name', cell: (u) => (<div><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500">{u.username}</div></div>) },
          {
            key: 'r',
            header: 'Role',
            cell: (u) => (
              <Select className="h-8 w-40 py-1" value={u.role} disabled={u._id === me?.id} onChange={(ev) => update.mutate({ id: u._id, body: { role: ev.target.value } })}>
                {['ADMIN', 'CASHIER', 'TECHNICIAN', 'ACCOUNTANT'].map((r) => (
                  <option key={r} value={r}>
                    {titleCase(r)}
                  </option>
                ))}
              </Select>
            ),
          },
          { key: 'l', header: 'Last login', cell: (u) => formatDateTime(u.lastLoginAt) },
          { key: 's', header: 'Status', cell: (u) => <StatusBadge status={u.isActive ? 'ACTIVE' : 'CANCELLED'} label={u.isActive ? 'Active' : 'Inactive'} /> },
          {
            key: 'a',
            header: '',
            cell: (u) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setReset({ id: u._id, name: u.name })}>
                  Reset password
                </Button>
                {u._id !== me?.id && (
                  <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: u._id, body: { isActive: !u.isActive } })}>
                    {u.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <Modal open={add} onClose={() => setAdd(false)} title="Add user" footer={<Button onClick={form.handleSubmit((v) => create.mutate(v))} loading={create.isPending}>Create user</Button>}>
        <form className="grid grid-cols-2 gap-3" onSubmit={form.handleSubmit((v) => create.mutate(v))}>
          <Field label="Full name" required error={e.name?.message} className="col-span-2">
            <Input {...form.register('name')} />
          </Field>
          <Field label="Username" required error={e.username?.message}>
            <Input autoComplete="off" {...form.register('username')} />
          </Field>
          <Field label="Role" required>
            <Select {...form.register('role')}>
              {['CASHIER', 'TECHNICIAN', 'ACCOUNTANT', 'ADMIN'].map((r) => (
                <option key={r} value={r}>
                  {titleCase(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Email" error={e.email?.message}>
            <Input {...form.register('email')} />
          </Field>
          <Field label="Password" required error={e.password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <button type="submit" hidden />
        </form>
      </Modal>
      <Modal open={!!reset} onClose={() => setReset(null)} size="sm" title={`Reset password — ${reset?.name}`} footer={<Button onClick={() => reset && update.mutate({ id: reset.id, body: { password: pwd } })} loading={update.isPending} disabled={pwd.length < 8}>Set password</Button>}>
        <Field label="New password" hint="At least 8 characters">
          <Input type="password" value={pwd} onChange={(ev) => setPwd(ev.target.value)} autoComplete="new-password" />
        </Field>
      </Modal>
    </div>
  );
}

function AuditTab() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounce(q, 300);
  const { data, isLoading } = useQuery({ queryKey: ['audit', search, page], queryFn: () => userService.audit({ q: search, page, limit: 30 }), placeholderData: keepPreviousData });
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="border-b border-slate-100 p-3">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Reference or summary…" className="w-full sm:w-72" />
      </div>
      <DataTable
        loading={isLoading}
        rows={data?.items}
        columns={[
          { key: 't', header: 'When', cell: (a) => formatDateTime(a.at) },
          { key: 'u', header: 'User', cell: (a) => a.userName ?? '—' },
          { key: 'a', header: 'Action', cell: (a) => titleCase(a.action) },
          { key: 'e', header: 'Record', cell: (a) => `${a.entity}${a.refNo ? ` ${a.refNo}` : ''}` },
          { key: 's', header: 'Summary', cell: (a) => <span className="text-slate-600">{a.summary}</span> },
        ]}
      />
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
    </div>
  );
}

function AccountTab() {
  const { user } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => authService.changePassword(cur, next),
    onSuccess: () => {
      toast.success('Password changed');
      setCur('');
      setNext('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="max-w-sm space-y-3">
      <p className="text-sm text-slate-600">
        Signed in as <b>{user?.name}</b> ({user?.username}) · {titleCase(user?.role)}
      </p>
      <Field label="Current password">
        <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
      </Field>
      <Field label="New password" hint="At least 8 characters">
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Field>
      <Button onClick={() => change.mutate()} loading={change.isPending} disabled={!cur || next.length < 8}>
        Change password
      </Button>
    </div>
  );
}
