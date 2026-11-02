'use client';

import { presetRange, type DatePreset } from '@/lib/utils';
import { cn } from '@/lib/utils';

const presets: Array<{ value: DatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'prevMonth', label: 'Previous month' },
  { value: 'custom', label: 'Custom' },
];

export interface RangeValue {
  preset: DatePreset;
  from: string;
  to: string;
}

export const initialRange = (preset: DatePreset = 'month'): RangeValue => ({ preset, ...presetRange(preset) });

/** Date filter with Today / Yesterday / This week / This month / Previous month / Custom. */
export function DateRangeFilter({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1">
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value === 'custom' ? { ...value, preset: 'custom' } : { preset: p.value, ...presetRange(p.value) })}
            className={cn('rounded-md px-2.5 py-1 text-xs font-medium', value.preset === p.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="flex items-center gap-1">
          <input type="date" className="input h-8 w-auto py-1" value={value.from} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="From date" />
          <span className="text-slate-400">–</span>
          <input type="date" className="input h-8 w-auto py-1" value={value.to} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="To date" />
        </div>
      )}
    </div>
  );
}
