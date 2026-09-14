import React from 'react';
import clsx from 'clsx';
import './operationalHeader.css';

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

/**
 * Cabeçalho operacional compacto.
 *
 * O nome da exportação é mantido por compatibilidade com as telas existentes,
 * mas o antigo hero/banner foi removido visualmente. O componente agora ocupa
 * apenas uma linha de contexto e leva os indicadores úteis para perto do
 * conteúdo, sem repetir uma grande área decorativa em cada módulo.
 */
export function OperationalBanner({
  id,
  eyebrow,
  title,
  accent,
  description,
  metrics,
}: OperationalBannerProps) {
  return (
    <section
      className={clsx('orders-hero operational-header shrink-0', metrics.length === 0 && 'operational-header--plain')}
      aria-labelledby={id}
    >
      <div className="operational-header__identity">
        <h1 id={id}>
          {title}
          {accent ? <em> {accent}</em> : null}
        </h1>
        <span className="sr-only">{eyebrow}. {description}</span>
      </div>

      {metrics.length > 0 && (
        <dl className="operational-header__metrics" aria-label={`Resumo: ${title} ${accent}`.trim()}>
          {metrics.map(metric => (
            <div key={metric.label} className="operational-header__metric">
              <dt>{metric.label}</dt>
              <dd className={clsx(metric.valueClassName)}>{metric.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
