import { Clock3, Plus, ReceiptText, UsersRound } from 'lucide-react';
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

/** Cashier-only surface. All service and financial status comes from the shared projection. */
export function CashierSalonCard({ card, actions }: { card: SalonCard; actions: SalonActions }) {
  const { table, tableOrders, isMerged, isOccupied, hasPendingPayment, operational } = card;
  const presentation = tableCardPresentation(operational);
  const canInspect = isOccupied && tableOrders.length > 0;
  const actionLabel = canInspect ? 'Ver comanda' : isOccupied ? 'Adicionar consumo' : 'Abrir pedido';
  const fullName = table.nome?.trim() || `Mesa ${table.id}`;
  const namedNumber = fullName.match(/^mesa\s*(\d+)$/i);
  const number = String(table.id).padStart(2, '0');
  const displayNumber = namedNumber ? namedNumber[1].padStart(2, '0') : number;
  const customName = namedNumber ? null : table.nome?.trim();
  const elapsed = isOccupied && tableOrders.length > 0 ? operational.elapsed : null;

  return (
    <article
      className="koma-salon-card"
      data-density="compact"
      data-table-status={isMerged ? 'merged' : hasPendingPayment ? 'payment' : isOccupied ? 'occupied' : 'free'}
      data-operational-state={presentation.key}
      aria-label={`${fullName}: ${presentation.label}`}
    >
      <div className="koma-salon-card__top">
        <div className="koma-salon-card__identity">
          <span className="koma-salon-card__caption">Mesa</span>
          <strong className="koma-salon-card__number">{displayNumber}</strong>
        </div>
        <KomaWaiterGlyph
          name={symbols[presentation.key] || 'table-service'}
          size={20}
          className="koma-salon-card__glyph"
          aria-hidden="true"
        />
      </div>

      <div className="koma-salon-card__body">
        {customName && <strong className="koma-salon-card__custom-name" title={customName}>{customName}</strong>}
        <span className="koma-salon-card__status">
          <span className="koma-salon-card__status-dot" aria-hidden="true" />
          {presentation.label}
        </span>
        {isMerged ? (
          <span className="koma-salon-card__meta">Use a mesa de destino</span>
        ) : isOccupied ? (
          <div className="koma-salon-card__service">
            {card.total > 0 && <strong className="koma-salon-card__total">{currency(card.total)}</strong>}
            {elapsed && <span className="koma-salon-card__meta"><Clock3 size={13} aria-hidden="true" />{elapsed}</span>}
          </div>
        ) : table.capacidade > 0 ? (
          <span className="koma-salon-card__meta"><UsersRound size={13} aria-hidden="true" />{table.capacidade} lugares</span>
        ) : null}
      </div>

      {!isMerged && (
        <button
          type="button"
          className="koma-salon-card__action"
          onClick={() => canInspect ? actions.inspectTable(tableOrders) : actions.openTableOrder(table.id)}
        >
          {canInspect ? <ReceiptText size={15} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
          <span>{actionLabel}</span>
        </button>
      )}
    </article>
  );
}
