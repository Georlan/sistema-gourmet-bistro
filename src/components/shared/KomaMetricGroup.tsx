import type { LucideIcon } from 'lucide-react';

export interface KomaMetric {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  /** Observed fraction of the population described by note; null means unmeasured. */
  ratio?: number | null;
}

/** Small operational metrics using the existing theme; no fetching or inferred values. */
export function KomaMetricGroup({ label, metrics }: { label: string; metrics: KomaMetric[] }) {
  return <section aria-label={label} className="grid grid-cols-2 gap-3 xl:grid-cols-4">
    {metrics.map(({ label: title, icon: Icon, value, note, ratio }) => {
      const percentage = ratio != null && Number.isFinite(ratio)
        ? Math.min(100, Math.max(0, ratio * 100)) : null;
      return <article key={title} className="min-w-0 rounded-xl bg-koma-panel p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h4 className="text-xs font-medium text-koma-muted">{title}</h4>
          <Icon size={16} aria-hidden="true" className="shrink-0 text-koma-muted" />
        </div>
        <strong className="block break-words text-2xl font-semibold tracking-tight tabular-nums text-koma-foreground sm:text-3xl">{value}</strong>
        <p className="mt-2 text-xs text-koma-muted">{note}</p>
        {percentage !== null ? <div role="img" aria-label={`${Math.round(percentage)}% · ${title}`} className="mt-3 h-1 overflow-hidden rounded-full bg-koma-raised">
          <div className="h-full rounded-full bg-koma-accent" style={{ width: `${percentage}%` }} />
        </div> : null}
      </article>;
    })}
  </section>;
}
