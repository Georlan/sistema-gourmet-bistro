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
  isConnected,
}: OperationalBannerProps) {
  const showConnectionStatus = typeof isConnected === 'boolean';

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
        {showConnectionStatus && (
          <div className={clsx('orders-hero__status', isConnected ? 'is-live' : 'is-offline')}>
            <span className="orders-live-dot" />
            <span>{isConnected ? 'Tempo real ativo' : 'Reconectando'}</span>
          </div>
        )}
      </div>
    </section>
  );
}
