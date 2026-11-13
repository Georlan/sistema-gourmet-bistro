import { ChevronRight } from 'lucide-react';
import { KomaWaiterGlyph, type KomaGlyphName } from '../../shared/KomaWaiterGlyphs';
import { tableCardPresentation } from '../../shared/SharedTableCard';
import type { SalonActions, SalonCard } from './cashierSalonContracts';

const symbols: Record<string, KomaGlyphName> = {
  free: 'table-free',
  occupied: 'table-service',
  ready: 'table-ready',
  payment: 'table-payment',
  served: 'table-served',
  merged: 'table-merged',
};

const currency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * One tap target per table, no nested button. The canonical projection decides
 * status, amount and merged destination; the Caixa remains the owner of actions.
 */
export function CashierSalonCard({ card, actions }: { card: SalonCard; actions: SalonActions }) {
  const { table, tableOrders, isMerged, isOccupied, hasPendingPayment, operational } = card;
  const presentation = tableCardPresentation(operational);
  const canInspect = tableOrders.length > 0 && (isOccupied || hasPendingPayment || isMerged);
  const destinationId = card.displayMesaId;
  // Merged origins can only inspect an existing destination; never start a second service.
  const canActivate = !isMerged || canInspect;
  const actionLabel = isMerged
    ? canInspect ? `Ver mesa ${String(destinationId).padStart(2, '0')}` : 'Mesa unida'
    : canInspect ? 'Ver comanda' : isOccupied || hasPendingPayment ? 'Adicionar consumo' : 'Abrir pedido';
  const displayNumber = String(table.id).padStart(2, '0');
  const fullName = table.nome?.trim() || `Mesa ${displayNumber}`;
  const defaultName = /^mesa\s*0*\d+$/i.test(fullName);
  const customName = defaultName ? null : fullName;
  const accessibleName = `Mesa ${displayNumber}${customName ? `, ${customName}` : ''}`;
  const elapsed = (isOccupied || hasPendingPayment) && tableOrders.length > 0
    ? operational.elapsed : null;

  const handleActivate = () => {
    if (canInspect) {
      actions.inspectTable(tableOrders);
    } else {
      actions.openTableOrder(destinationId);
    }
  };

  return (
    <article
      className="koma-salon-card"
      data-density="compact"
      data-table-status={isMerged ? 'merged' : hasPendingPayment ? 'payment' : isOccupied ? 'occupied' : 'free'}
      data-operational-state={presentation.key}
    >
      <button
        type="button"
        className="koma-salon-card__tap"
        onClick={canActivate ? handleActivate : undefined}
        disabled={!canActivate}
        aria-label={`${actionLabel} · ${accessibleName} · ${presentation.label}`}
        title={`${accessibleName}: ${presentation.label}`}
      >
        <span className="koma-salon-card__identity">
          <strong className="koma-salon-card__number">{displayNumber}</strong>
          <KomaWaiterGlyph name={symbols[presentation.key] || 'table-service'} size={19} className="koma-salon-card__glyph" aria-hidden="true" />
        </span>

        <span className="koma-salon-card__context">
          {customName && <strong className="koma-salon-card__name">{customName}</strong>}
          <span className="koma-salon-card__state">{presentation.label}</span>
          {isMerged ? (
            <span className="koma-salon-card__meta">Atendimento na mesa {String(destinationId).padStart(2, '0')}</span>
          ) : isOccupied || hasPendingPayment ? (
            <>
              {card.total > 0 && <strong className="koma-salon-card__total">{currency(card.total)}</strong>}
              {elapsed && <span className="koma-salon-card__meta">{elapsed}</span>}
            </>
          ) : table.capacidade > 0 ? (
            <span className="koma-salon-card__meta">{table.capacidade} lugares</span>
          ) : null}
        </span>

        <span className="koma-salon-card__action" aria-hidden="true">
          <span>{actionLabel}</span>
          {canActivate && <ChevronRight size={15} strokeWidth={2.2} />}
        </span>
      </button>
    </article>
  );
}
