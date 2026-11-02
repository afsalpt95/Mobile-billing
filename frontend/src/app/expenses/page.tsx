'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { DateRangeFilter, initialRange } from '@/components/ui/DateRange';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Field';
import { Card, DataTable, ErrorState, Pagination, SearchInput, StatCard, StatusBadge, Tabs } from '@/components/ui/Misc';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { SearchSelect, type Option } from '@/components/ui/SearchSelect';
import { MasterFormModal, VendorFormModal } from '@/features/masters/QuickCreate';
import { fetchMaster, fetchVendors, masterOption, vendorOption } from '@/features/masters/options';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce, useInvalidate, usePaymentMethods } from '@/hooks/useCommon';
import { errorMessage, newRequestId } from '@/lib/api';
import { financialKeys, qk } from '@/lib/queryKeys';
import { downloadCsv, formatDate, formatMoney, listRange, toDateInput } from '@/lib/utils';
import { expenseService, reportService } from '@/services';
import type { Expense, MasterItem, Vendor } from '@/types';
import { expenseSchema, type ExpenseValues } from '@/validations';

export default function ExpensesPage() {
  return (
    <AppShell permission="expenses.read">
      <Expenses />
    </AppShell>
  );
}

function Expenses() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'list' | 'report'>('list');
  const [range, setRange] = useState(initialRange('month'));
  const [form, setForm] = useState<{ expense?: Expense } | null>(null);
  return (
    <>
      <PageHeader
        title="Expenses"
        crumbs={[{ label: 'Expenses' }]}
        actions={
          can('expenses.write') && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({})}>
              Add expense
            </Button>
          )
        }
      />
      <div className="mb-3">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <div className="card">
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[{ value: 'list', label: 'Expenses & payables' }, { value: 'report', label: 'Summary report' }]} />
        {tab === 'list' ? <ExpenseList range={range} onEdit={(e) => setForm({ expense: e })} /> : <ExpenseReport range={range} />}
      </div>
      <ExpenseFormModal open={!!form} expense={form?.expense} onClose={() => setForm(null)} />
    </>
  );
}

function ExpenseList({ range, onEdit }: { range: { from: string; to: string }; onEdit: (e: Expense) => void }) {
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const { data: methods = [] } = usePaymentMethods();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<Option<MasterItem> | null>(null);
  const [payment, setPayment] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [payFor, setPayFor] = useState<Expense | null>(null);
  const [cancelFor, setCancelFor] = useState<Expense | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('Cash');
  const search = useDebounce(q, 300);
  const params = { q: search, ...listRange(range), category: category?.value, paymentStatus: payment || undefined, status, page, limit: 25 };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [...qk.expenses, params], queryFn: () => expenseService.list(params), placeholderData: keepPreviousData });

  const pay = useMutation({
    mutationFn: () => expenseService.pay(payFor!._id, { amount: Number(payAmount), method: payMethod }),
    onSuccess: async () => {
      toast.success('Payment recorded');
      setPayFor(null);
      await invalidate(...financialKeys);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => expenseService.cancel(cancelFor!._id, reason),
    onSuccess: async () => {
      toast.success('Expense cancelled');
      setCancelFor(null);
      await invalidate(...financialKeys);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <div className="grid grid-cols-1 gap-3 border-b border-slate-100 p-3 sm:grid-cols-3">
        <StatCard label="Total expenses" value={formatMoney(data?.summary?.amount)} tone="red" loading={isLoading} />
        <StatCard label="Paid" value={formatMoney(data?.summary?.paid)} tone="green" loading={isLoading} />
        <StatCard label="Unpaid (payable)" value={formatMoney(data?.summary?.due)} tone="amber" loading={isLoading} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Expense no, description, paid to…" className="w-full sm:w-64" />
        <div className="w-56">
          <SearchSelect value={category} onChange={(o) => { setCategory(o); setPage(1); }} queryKey={qk.master('expense-categories')} fetchOptions={fetchMaster('expense-categories')} placeholder="All categories" />
        </div>
        <Select className="h-9 w-auto py-1" value={payment} onChange={(e) => setPayment(e.target.value)} aria-label="Payment status">
          <option value="">Paid & unpaid</option>
          <option value="PAID">Paid</option>
          <option value="UNPAID,PARTIAL">Unpaid / partial (payables)</option>
        </Select>
        <Select className="h-9 w-auto py-1" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="ACTIVE">Active</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="ALL">All</option>
        </Select>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <DataTable<Expense>
          loading={isLoading}
          rows={data?.items}
          columns={[
            { key: 'no', header: 'No', cell: (e) => <span className="font-medium">{e.expenseNo}</span> },
            { key: 'date', header: 'Date', cell: (e) => formatDate(e.date) },
            { key: 'cat', header: 'Category', cell: (e) => e.categoryName },
            { key: 'desc', header: 'Description', cell: (e) => (<div><div>{e.description}</div><div className="text-xs text-slate-500">{e.paidTo}</div></div>) },
            { key: 'm', header: 'Paid via', cell: (e) => [...new Set(e.payments.map((p) => p.method))].join(', ') || '—' },
            { key: 'amt', header: 'Amount', align: 'right', cell: (e) => <span className="font-medium">{formatMoney(e.amount)}</span> },
            { key: 'due', header: 'Unpaid', align: 'right', cell: (e) => (e.balanceDue > 0 ? <span className="text-amber-700">{formatMoney(e.balanceDue)}</span> : '—') },
            { key: 'st', header: 'Status', cell: (e) => (e.status === 'CANCELLED' ? <StatusBadge status="CANCELLED" /> : <StatusBadge status={e.paymentStatus} />) },
            {
              key: 'act',
              header: '',
              cell: (e) =>
                e.status === 'ACTIVE' &&
                can('expenses.write') && (
                  <div className="flex justify-end gap-1">
                    {e.balanceDue > 0 && (
                      <Button size="sm" onClick={() => { setPayFor(e); setPayAmount(String(e.balanceDue)); }}>
                        Pay
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => onEdit(e)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setCancelFor(e)}>
                      Cancel
                    </Button>
                  </div>
                ),
            },
          ]}
        />
      )}
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      <Modal
        open={!!payFor}
        onClose={() => setPayFor(null)}
        size="sm"
        title={`Pay ${payFor?.expenseNo}`}
        description={`Outstanding ${formatMoney(payFor?.balanceDue)}`}
        footer={
          <Button onClick={() => pay.mutate()} loading={pay.isPending} disabled={!(Number(payAmount) > 0)}>
            Record payment
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <MoneyInput value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
          </Field>
          <Field label="Method">
            <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              {methods.map((m) => (
                <option key={m._id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
      <ConfirmDialog
        open={!!cancelFor}
        onClose={() => setCancelFor(null)}
        title={`Cancel expense ${cancelFor?.expenseNo}?`}
        message="The expense will be excluded from reports. It is kept for audit."
        confirmLabel="Cancel expense"
        requireReason
        loading={cancel.isPending}
        onConfirm={(reason) => cancel.mutate(reason)}
      />
    </>
  );
}

function ExpenseReport({ range }: { range: { from: string; to: string } }) {
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const { data, isLoading } = useQuery({ queryKey: [...qk.reports, 'expenses', range, groupBy], queryFn: () => reportService.expenses(range.from, range.to, groupBy) });
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-slate-100 p-1">
          {(['day', 'week', 'month'] as const).map((g) => (
            <button key={g} type="button" onClick={() => setGroupBy(g)} className={`rounded-md px-3 py-1 text-xs font-medium ${groupBy === g ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`}>
              {g === 'day' ? 'Daily' : g === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" disabled={!data?.byCategory?.length} onClick={() => downloadCsv(`expenses-${range.from}-${range.to}.csv`, data.byCategory)}>
          Export CSV
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard loading={isLoading} label="Total" value={formatMoney(data?.summary?.amount)} tone="red" sub={`${data?.summary?.count ?? 0} entries`} />
        <StatCard loading={isLoading} label="Paid" value={formatMoney(data?.summary?.paid)} tone="green" />
        <StatCard loading={isLoading} label="Outstanding" value={formatMoney(data?.summary?.outstanding)} tone="amber" />
        <StatCard loading={isLoading} label="Categories" value={data?.byCategory?.length ?? 0} tone="slate" />
      </div>
      <Card title={`Expenses by ${groupBy}`}>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={data?.byPeriod ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => formatMoney(v)} />
              <Bar dataKey="amount" fill="#2a78d6" radius={[4, 4, 0, 0]} name="Expenses" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="By category" bodyClassName="p-0">
          <DataTable loading={isLoading} rows={data?.byCategory} columns={[{ key: 'n', header: 'Category', cell: (r: any) => r.name }, { key: 'c', header: 'Entries', align: 'right', cell: (r: any) => r.count }, { key: 'a', header: 'Amount', align: 'right', cell: (r: any) => formatMoney(r.amount) }]} />
        </Card>
        <Card title="Payments by method (paid in period)" bodyClassName="p-0">
          <DataTable loading={isLoading} rows={data?.byPaymentMethod} columns={[{ key: 'm', header: 'Method', cell: (r: any) => r.method }, { key: 'c', header: 'Payments', align: 'right', cell: (r: any) => r.count }, { key: 'a', header: 'Amount', align: 'right', cell: (r: any) => formatMoney(r.amount) }]} />
        </Card>
      </div>
    </div>
  );
}

function ExpenseFormModal({ open, onClose, expense }: { open: boolean; onClose: () => void; expense?: Expense }) {
  const invalidate = useInvalidate();
  const { data: methods = [] } = usePaymentMethods();
  const [category, setCategory] = useState<Option<MasterItem> | null>(null);
  const [vendor, setVendor] = useState<Option<Vendor> | null>(null);
  const [nested, setNested] = useState<{ kind: 'category' | 'vendor'; text: string } | null>(null);
  const requestId = useRef(newRequestId());
  const form = useForm<ExpenseValues>({ resolver: zodResolver(expenseSchema) });
  const defaultMethod = methods[0]?.name ?? 'Cash';
  useEffect(() => {
    if (!open) return;
    requestId.current = newRequestId();
    setCategory(expense ? { value: expense.category, label: expense.categoryName } : null);
    setVendor(expense?.vendor && typeof expense.vendor === 'object' ? { value: expense.vendor._id, label: expense.vendor.name } : null);
    form.reset({
      date: expense ? toDateInput(new Date(expense.date)) : toDateInput(),
      categoryId: expense?.category ?? '',
      description: expense?.description ?? '',
      amount: expense?.amount ?? ('' as unknown as number),
      paidTo: expense?.paidTo ?? '',
      paymentStatus: expense ? expense.paymentStatus : 'PAID',
      amountPaid: undefined,
      method: defaultMethod,
      reference: '',
      attachmentRef: expense?.attachmentRef ?? '',
      notes: expense?.notes ?? '',
    });
  }, [open, expense, form, defaultMethod]);
  const status = form.watch('paymentStatus');
  const save = useMutation({
    mutationFn: async (v: ExpenseValues) => {
      const base = {
        date: v.date,
        categoryId: v.categoryId,
        description: v.description,
        amount: Number(v.amount),
        paidTo: v.paidTo || undefined,
        vendorId: vendor?.value ?? (expense ? null : undefined),
        attachmentRef: v.attachmentRef || undefined,
        notes: v.notes || undefined,
      };
      if (expense) return expenseService.update(expense._id, base);
      const amountPaid = v.paymentStatus === 'PAID' ? Number(v.amount) : v.paymentStatus === 'PARTIAL' ? Number(v.amountPaid) : 0;
      return (await expenseService.create({ ...base, clientRequestId: requestId.current, amountPaid, method: amountPaid > 0 ? v.method : undefined, reference: v.reference || undefined })).data;
    },
    onSuccess: async (e) => {
      toast.success(expense ? 'Expense updated' : `Expense ${e.expenseNo} saved`);
      await invalidate(...financialKeys);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const err = form.formState.errors;
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={expense ? `Edit ${expense.expenseNo}` : 'Add expense'}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>
              Save
            </Button>
          </>
        }
      >
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Field label="Date" required error={err.date?.message}>
            <Input type="date" max={toDateInput()} {...form.register('date')} />
          </Field>
          <Field label="Category" required error={err.categoryId?.message}>
            <Controller
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <SearchSelect
                  value={category}
                  onChange={(o) => {
                    setCategory(o);
                    field.onChange(o?.value ?? '');
                  }}
                  queryKey={qk.master('expense-categories')}
                  fetchOptions={fetchMaster('expense-categories')}
                  onAddNew={(t) => setNested({ kind: 'category', text: t })}
                  addLabel="Add category"
                  invalid={!!err.categoryId}
                />
              )}
            />
          </Field>
          <Field label="Description" required error={err.description?.message} className="sm:col-span-2">
            <Input {...form.register('description')} invalid={!!err.description} />
          </Field>
          <Field label="Amount" required error={err.amount?.message}>
            <MoneyInput {...form.register('amount')} invalid={!!err.amount} />
          </Field>
          <Field label="Paid to">
            <Input {...form.register('paidTo')} />
          </Field>
          <Field label="Vendor (optional)" className="sm:col-span-2">
            <SearchSelect value={vendor} onChange={setVendor} queryKey={qk.vendors} fetchOptions={fetchVendors} onAddNew={(t) => setNested({ kind: 'vendor', text: t })} addLabel="Add vendor" />
          </Field>
          {!expense && (
            <>
              <Field label="Payment" required>
                <Select {...form.register('paymentStatus')}>
                  <option value="PAID">Paid in full</option>
                  <option value="PARTIAL">Partly paid</option>
                  <option value="UNPAID">Unpaid (track as payable)</option>
                </Select>
              </Field>
              {status === 'PARTIAL' && (
                <Field label="Amount paid" error={err.amountPaid?.message}>
                  <MoneyInput {...form.register('amountPaid')} />
                </Field>
              )}
              {status !== 'UNPAID' && (
                <>
                  <Field label="Payment method" error={err.method?.message}>
                    <Select {...form.register('method')}>
                      {methods.map((m) => (
                        <option key={m._id} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Transaction / reference no.">
                    <Input {...form.register('reference')} />
                  </Field>
                </>
              )}
            </>
          )}
          <Field label="Receipt / attachment reference" className="sm:col-span-2">
            <Input {...form.register('attachmentRef')} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea {...form.register('notes')} />
          </Field>
          <button type="submit" hidden />
        </form>
      </Modal>
      <MasterFormModal
        master="expense-categories"
        label="Expense category"
        open={nested?.kind === 'category'}
        initialName={nested?.text}
        onClose={() => setNested(null)}
        onSaved={(m) => {
          setCategory(masterOption(m));
          form.setValue('categoryId', m._id, { shouldValidate: true });
        }}
      />
      <VendorFormModal open={nested?.kind === 'vendor'} initialName={nested?.text} onClose={() => setNested(null)} onSaved={(v) => setVendor(vendorOption(v))} />
    </>
  );
}
