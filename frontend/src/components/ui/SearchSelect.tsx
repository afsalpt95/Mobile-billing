'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, Plus, X } from 'lucide-react';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { useDebounce } from '@/hooks/useCommon';
import { cn } from '@/lib/utils';

export interface Option<T = unknown> {
  value: string;
  label: string;
  sublabel?: ReactNode;
  right?: ReactNode;
  disabled?: boolean;
  data?: T;
}

export interface SearchSelectHandle {
  focus: () => void;
}

interface Props<T> {
  value: Option<T> | null;
  onChange: (option: Option<T> | null) => void;
  /** Server-side search; results are cached per search text by TanStack Query. */
  fetchOptions: (search: string) => Promise<Option<T>[]>;
  queryKey: readonly unknown[];
  placeholder?: string;
  /** Shows a "+" button beside the field and an "Add new ..." row; receives the typed text. */
  onAddNew?: (text: string) => void;
  addLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  clearable?: boolean;
  id?: string;
  className?: string;
  emptyText?: string;
  /** Called after Enter selects an option (e.g. to move focus to the next field). */
  onSelected?: (option: Option<T>) => void;
}

function SearchSelectInner<T>(
  { value, onChange, fetchOptions, queryKey, placeholder = 'Search...', onAddNew, addLabel = 'Add new', disabled, invalid, clearable = true, id, className, emptyText = 'No matches', onSelected }: Props<T>,
  ref: React.Ref<SearchSelectHandle>,
) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const search = useDebounce(text, 200);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  const { data = [], isFetching } = useQuery({
    queryKey: [...queryKey, 'search', search],
    queryFn: () => fetchOptions(search),
    enabled: open,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const showAdd = Boolean(onAddNew && text.trim() && !data.some((o) => o.label.toLowerCase() === text.trim().toLowerCase()));
  const rows = data.length + (showAdd ? 1 : 0);

  useEffect(() => {
    setActive(0);
  }, [search, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setText('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (opt: Option<T>) => {
    if (opt.disabled) return;
    onChange(opt);
    setOpen(false);
    setText('');
    onSelected?.(opt);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, rows - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      if (active < data.length && data[active]) choose(data[active]);
      else if (showAdd) {
        onAddNew!(text.trim());
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
        setText('');
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
      setText('');
    }
  };

  return (
    <div ref={wrapRef} className={cn('relative flex gap-1.5', className)}>
      <div className="relative min-w-0 flex-1">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          autoComplete="off"
          disabled={disabled}
          className={cn('input pr-14', invalid && 'input-error', value && !open && 'font-medium')}
          placeholder={value ? value.label : placeholder}
          value={open ? text : value?.label ?? ''}
          onChange={(e) => {
            setText(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-slate-400">
          {isFetching && open ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
        </div>
        {clearable && value && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Clear selection"
            className="absolute inset-y-0 right-7 flex items-center text-slate-400 hover:text-slate-700"
            onClick={() => {
              onChange(null);
              inputRef.current?.focus();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {open && (
          <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-72 w-full min-w-[16rem] overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
            {data.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={value?.value === o.value}
                aria-disabled={o.disabled}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                  i === active && 'bg-brand-50',
                  o.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800">{o.label}</div>
                  {o.sublabel && <div className="truncate text-xs text-slate-500">{o.sublabel}</div>}
                </div>
                {o.right && <div className="shrink-0 text-xs text-slate-500">{o.right}</div>}
                {value?.value === o.value && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
              </li>
            ))}
            {!data.length && !showAdd && <li className="px-3 py-3 text-center text-sm text-slate-500">{isFetching ? 'Searching…' : emptyText}</li>}
            {showAdd && (
              <li
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onAddNew!(text.trim());
                  setOpen(false);
                }}
                onMouseEnter={() => setActive(data.length)}
                className={cn('flex cursor-pointer items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm font-medium text-brand-700', active === data.length && 'bg-brand-50')}
              >
                <Plus className="h-4 w-4" /> {addLabel} “{text.trim()}”
              </li>
            )}
          </ul>
        )}
      </div>
      {onAddNew && (
        <button
          type="button"
          onClick={() => onAddNew(text.trim())}
          disabled={disabled}
          title={addLabel}
          aria-label={addLabel}
          className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export const SearchSelect = forwardRef(SearchSelectInner) as <T>(p: Props<T> & { ref?: React.Ref<SearchSelectHandle> }) => ReturnType<typeof SearchSelectInner>;
