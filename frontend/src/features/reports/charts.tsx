'use client';

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '@/lib/utils';

/** Categorical slots in fixed order (validated reference palette): never cycled, follow the series. */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const;
const GRID = '#e2e8f0';
const AXIS = { fontSize: 11, fill: '#64748b' };
const shortDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : d);
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k` : String(v));

const tooltip = {
  formatter: (v: number, name: string) => [formatMoney(v), name] as [string, string],
  labelFormatter: shortDate,
  contentStyle: { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 },
  cursor: { fill: 'rgba(148,163,184,0.12)' },
};

export function GroupedBars({ data, xKey, series, height = 260 }: { data: Array<Record<string, unknown>>; xKey: string; series: Array<{ key: string; label: string }>; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} tickFormatter={shortDate} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis tick={AXIS} tickFormatter={compact} axisLine={false} tickLine={false} width={44} />
          <Tooltip {...tooltip} />
          {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={28} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Lines({ data, xKey, series, height = 260 }: { data: Array<Record<string, unknown>>; xKey: string; series: Array<{ key: string; label: string }>; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} tickFormatter={shortDate} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis tick={AXIS} tickFormatter={compact} axisLine={false} tickLine={false} width={44} />
          <Tooltip {...tooltip} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
          {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES[i]} strokeWidth={2} dot={data.length <= 14 ? { r: 4 } : false} activeDot={{ r: 5 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal magnitude bars (single hue) for category breakdowns. */
export function HBars({ data, labelKey, valueKey, height }: { data: Array<Record<string, unknown>>; labelKey: string; valueKey: string; height?: number }) {
  return (
    <div style={{ height: height ?? Math.max(120, data.length * 32 + 20) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={AXIS} tickFormatter={compact} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey={labelKey} tick={AXIS} width={120} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v: number) => formatMoney(v)} contentStyle={tooltip.contentStyle} cursor={tooltip.cursor} />
          <Bar dataKey={valueKey} fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
