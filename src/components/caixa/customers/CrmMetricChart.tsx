import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { KOMA_CHART_AXIS, KOMA_CHART_COLORS, KOMA_CHART_GRID } from '../../../config/chartTheme';

interface Props {
  title: string;
  unit?: 'BRL';
  rows: { label: string; value: number }[];
}

/** Descriptive counts only: no inferred sales or conversion probabilities. */
export function CrmMetricChart({ title, rows, unit }: Props) {
  const format = (value: number) => unit === 'BRL' ? value.toLocaleString('pt-BR', {style:'currency',currency:'BRL'}) : String(value);
  return (
    <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 space-y-3" aria-label={title}>
      <h4 className="text-sm font-bold text-koma-foreground">{title}</h4>
      <div className="h-40" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 16 }}>
            <CartesianGrid {...KOMA_CHART_GRID} />
            <XAxis {...KOMA_CHART_AXIS} type="number" allowDecimals={unit === 'BRL'} tickFormatter={format} domain={unit === 'BRL' ? [(min: number) => Math.min(0, min), (max: number) => Math.max(1, max)] : [0, (max: number) => Math.max(1, max)]} />
            <YAxis {...KOMA_CHART_AXIS} type="category" dataKey="label" width={120} />
            <Tooltip contentStyle={{ background: 'var(--koma-surface-panel)', borderRadius: 12 }} cursor={false} />
            <Bar dataKey="value" name={unit === 'BRL' ? 'Contribuição' : 'Clientes'} fill={KOMA_CHART_COLORS.primary} radius={[0, 5, 5, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
        {rows.map(row => <div key={row.label}><dt className="text-koma-muted">{row.label}</dt><dd className="font-bold text-koma-foreground">{format(row.value)}</dd></div>)}
      </dl>
    </section>
  );
}
