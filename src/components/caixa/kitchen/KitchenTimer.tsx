import { Clock3 } from 'lucide-react';
import { getKdsWaitInfo } from './kdsProjection';

/** Display only; the KDS workspace owns a single interval for every ticket. */
export function KitchenTimer({ itemTimestamp, status, now }: {
  itemTimestamp?: unknown;
  status: 'preparando' | 'pronto';
  now: number;
}) {
  if (status === 'pronto') return <span className="kds-ticket__ready-label">Pronto</span>;
  const time = getKdsWaitInfo(itemTimestamp, now);
  return (
    <span className="kds-ticket__timer" data-wait-level={time.level} title="Tempo desde o lançamento do pedido">
      <Clock3 size={14} aria-hidden="true" />
      <span>{time.label}</span>
      {time.level === 'late' && <span className="kds-ticket__wait-caption">Atenção</span>}
    </span>
  );
}
