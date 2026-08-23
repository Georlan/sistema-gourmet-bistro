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
    <section className="orders-hero shrink-0" aria-labelledby={id}>
      <div className="orders-hero__copy">
        <p className="orders-eyebrow"><span /> {eyebrow}</p>
        <h1 id={id}>{title} <em>{accent}</em></h1>
        <p>{description}</p>
      </div>
      <div className="orders-hero__metrics" aria-label={`Resumo: ${title} ${accent}`}>
        {metrics.map(metric => (
          <div key={metric.label} className="orders-hero__metric">
            <strong className={clsx(metric.valueClassName)}>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
