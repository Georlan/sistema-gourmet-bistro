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

/** Mesmo vocabulário do Garçom; ações e valores permanecem exclusivamente do Caixa. */
export function CashierSalonCard({ card, actions }: { card: SalonCard; actions: SalonActions }) {
  const { table, tableOrders, isMerged, isOccupied, hasPendingPayment, operational } = card;
  const presentation = tableCardPresentation(operational);
  const canInspect = isOccupied && tableOrders.length > 0;
  const actionLabel = canInspect ? 'Ver comanda' : isOccupied ? 'Adicionar consumo' : 'Abrir pedido';
  const fullName = table.nome?.trim() || `Mesa ${table.id}`;
  const namedNumber = fullName.match(/^mesa\s*(\d+)$/i);
  const displayNumber = namedNumber ? namedNumber[1].padStart(2, '0') : String(table.id).padStart(2, '0');
  const customName = namedNumber ? null : table.nome?.trim();
  const elapsed = isOccupied && tableOrders.length > 0 ? operational.elapsed : null;
  // Preparation is actionable; a generic 'Em atendimento' repeated on every mesa is not.
  const detailStatus = presentation.key !== 'free'
    && (presentation.key !== 'occupied' || presentation.label !== 'Em atendimento');

  return (
    <article
      className="koma-salon-card"
      data-density="compact"
      data-table-status={isMerged ? 'merged' : hasPendingPayment ? 'payment' : isOccupied ? 'occupied' : 'free'}
      data-operational-state={presentation.key}
      aria-label={`${fullName}: ${presentation.label}`}
    >
      <div className="koma-salon-card__identity">
        <strong title={fullName} className={customName ? 'koma-salon-card__name' : 'koma-salon-card__number'}>
          {customName || displayNumber}
        </strong>
        <KomaWaiterGlyph name={symbols[presentation.key] || 'table-service'} size={18} className="koma-salon-card__glyph" aria-hidden="true" />
      </div>

      <div className="koma-salon-card__context">
        {detailStatus && <span className="koma-salon-card__state">{presentation.label}</span>}
        {isMerged ? (
          <span className="koma-salon-card__meta">Use a mesa de destino</span>
        ) : isOccupied ? (
          <>
            {card.total > 0 && <strong className="koma-salon-card__total">{currency(card.total)}</strong>}
            {elapsed && <span className="koma-salon-card__meta">{elapsed}</span>}
            {card.total <= 0 && !elapsed && !detailStatus && <span className="koma-salon-card__meta">Em atendimento</span>}
          </>
        ) : table.capacidade > 0 ? (
          <span className="koma-salon-card__meta">{table.capacidade} lugares</span>
        ) : null}
      </div>

      {!isMerged && (
        <button
          type="button"
          className="koma-salon-card__action"
          onClick={() => canInspect ? actions.inspectTable(tableOrders) : actions.openTableOrder(table.id)}
        >
          {actionLabel}
        </button>
      )}
    </article>
  );
}
