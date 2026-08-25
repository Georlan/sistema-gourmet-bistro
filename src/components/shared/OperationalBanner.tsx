import React from 'react';
import clsx from 'clsx';

export interface OperationalBannerMetric {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}

interface OperationalBannerProps {
  id: string;
  eyebrow: string;
  title: string;
  accent: string;
  description: string;
  metrics: OperationalBannerMetric[];
  isConnected?: boolean;
}

export function OperationalBanner({
  id,
  eyebrow,
  title,
  accent,
  description,
  metrics,
}: OperationalBannerProps) {
  return (
    <section className={clsx('orders-hero shrink-0', metrics.length === 0 && 'orders-hero--without-metrics')} aria-labelledby={id}>
      <div className="orders-hero__copy">
        <p className="orders-eyebrow"><span /> {eyebrow}</p>
        <h1 id={id}>{title} <em>{accent}</em></h1>
        <p>{description}</p>
      </div>
      {metrics.length > 0 && <div
        className="orders-hero__metrics"
        aria-label={`Resumo: ${title} ${accent}`}
        style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(4.6rem, auto))`, minWidth: `${Math.max(metrics.length * 6.2, 13)}rem` }}
      >
        {metrics.map(metric => (
          <div key={metric.label} className="orders-hero__metric">
            <strong className={clsx(metric.valueClassName)}>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>}
    </section>
  );
}
