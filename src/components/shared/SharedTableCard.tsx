import { TablePresenceNotice } from './TablePresenceNotice';
import React from 'react';
import { Clock3, FileText, GitMerge, UsersRound } from 'lucide-react';
import { KomaWaiterGlyph } from './KomaWaiterGlyphs';
import type { Order, Table } from '../../types';
import type { TableOperationalProjection } from '../../domain/operationalState';
import { describeTableOrders, getTableCheckNumbers } from '../../domain/tableReadModel';

/** Presentation only: financial evidence wins emphasis, never changes production. */
export function tableCardPresentation(state: TableOperationalProjection, showProduction = true) {
  if (state.mergedIntoMesaId) return { key: 'merged', label: `Junto com mesa ${state.mergedIntoMesaId}` };
  if (state.hasPendingConfirmation) return { key: 'payment', label: 'Confirmar pagamento' };
  if (state.hasPaymentRequest) return { key: 'payment', label: 'Aguardando pagamento' };
  if (state.occupancy === 'FREE') return { key: 'free', label: 'Livre' };
  if (showProduction && state.production.hasReadyItems) return { key: 'ready', label: 'Tem item pronto' };
  if (showProduction && state.service === 'SERVED') return { key: 'served', label: 'Itens servidos' };
  return { key: 'occupied', label: showProduction && state.production.hasPreparingItems ? 'Em preparo' : 'Em atendimento' };
}

const tones: Record<string, string> = {
  free: 'koma-table-free-card border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0d1210] hover:border-emerald-500/50 text-emerald-700 dark:text-emerald-400 shadow-xs',
  occupied: 'border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-[#160d11] text-rose-800 dark:text-rose-300 shadow-xs',
  ready: 'border-emerald-300 dark:border-emerald-500/60 bg-emerald-50 dark:bg-[#0c1a14] text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-500/25 shadow-xs',
  payment: 'border-sky-200 dark:border-cyan-500/50 bg-sky-50 dark:bg-[#09151c] text-sky-800 dark:text-cyan-300 shadow-xs',
  served: 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 shadow-xs',
  merged: 'border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 text-zinc-600 dark:text-zinc-400 shadow-xs',
};

interface Props {
  id?: string;
  table: Table;
  orders: readonly Order[];
  operational: TableOperationalProjection;
  total: number;
  draftCount?: number;
  mergedSources?: readonly number[];
  otherWaitersServing?: readonly string[];
  showOperationalStatus?: boolean;
  onClick?: () => void;
  /** Visible label for the table-level reference. Internal identity stays unchanged. */
  identityLabel?: string;
  /** Lets a role-specific grid define a uniform row height without changing other consumers. */
  fillHeight?: boolean;
  /** Some operational views do not need item quantity inside each table card. */
  showItemCount?: boolean;
  /** Compatibility with cashier filters, not a second presentation authority. */
  filterStatus?: string;
  note?: string;
  /** Compact overview; complete account context stays in the caller's details. */
  density?: 'regular' | 'compact';
  /** Chooses the primary identifier without changing the shared operational state. */
  primaryIdentity?: 'table' | 'order';
  children?: React.ReactNode;
}

/** Common shell; caller owns navigation, payment and any role-specific actions. */
export function SharedTableCard({
  id, table, orders, operational, total, draftCount = 0, mergedSources = [],
  otherWaitersServing = [], showOperationalStatus = true, onClick, identityLabel = 'Comanda', fillHeight = false,
  showItemCount = true, filterStatus, note, density = 'regular', primaryIdentity = 'table', children,
}: Props) {
  const presentation = tableCardPresentation(operational, showOperationalStatus);
  const checkNumbers = getTableCheckNumbers(orders);
  const principalOrders = orders.filter((order) =>
    order.mesaOrigemId == null || order.mesaOrigemId === table.id);
  const primaryCheckNumber = getTableCheckNumbers(principalOrders)[0] ?? checkNumbers[0];
  const numbersText = primaryCheckNumber ? `#${primaryCheckNumber}` : '';
  const orderContext = describeTableOrders(orders);
  const customName = table.nome && table.nome !== `Mesa ${table.id}`;
  const Container = onClick ? 'button' : 'article';
  const occupied = operational.occupancy === 'IN_SERVICE' && !operational.mergedIntoMesaId;
  const compact = density === 'compact';
  const latestDisplayNumber = [...orderContext.launches].reverse().find((launch) => launch.displayNumber)?.displayNumber;
  const prominentOrderLabel = occupied
    ? latestDisplayNumber
      ? `Pedido ${latestDisplayNumber}`
      : checkNumbers.length > 0
        ? `Pedido #${checkNumbers[checkNumbers.length - 1]}`
        : null
    : null;
  const emphasizeOrder = primaryIdentity === 'order' && Boolean(prominentOrderLabel);
  const tableDisplayName = table.nome?.trim() || `Mesa ${String(table.id).padStart(2, '0')}`;
  const formattedTotal = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <Container
      id={id}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={`${customName ? table.nome : `Mesa ${table.id}`}: ${presentation.label}${numbersText ? `, ${identityLabel.toLocaleLowerCase('pt-BR')} ${numbersText}` : ''}`}
      data-table-status={filterStatus}
      data-operational-state={presentation.key}
      data-density={density}
      className={`group relative flex min-w-0 min-h-[132px] flex-col justify-between overflow-hidden rounded-2xl border text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${fillHeight ? 'h-full' : ''} ${compact ? 'gap-2 p-3' : 'gap-2 p-3 sm:gap-2 sm:p-3.5'} ${tones[presentation.key]} ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}
    >
      <span className="absolute left-0 top-0 h-[3px] w-full bg-current opacity-70" aria-hidden="true" />
      <div className={compact ? 'flex items-start justify-between gap-2' : 'min-w-0'}>
        <div className="min-w-0">
          <div className={!compact ? 'flex items-start justify-between gap-1' : undefined}>
            <span className="block text-[9px] font-mono font-bold uppercase tracking-widest text-koma-muted">
              {emphasizeOrder ? tableDisplayName : 'Mesa'}
            </span>
            {!compact && (
              <div className="flex items-center gap-1.5 shrink-0">
                {primaryCheckNumber != null && !emphasizeOrder && (
                  <span className="shrink-0 whitespace-nowrap rounded-md border border-current/20 px-1 py-1 text-[8px] font-mono" title={`${identityLabel} ${numbersText}`}>
                    {identityLabel === 'Pedido' ? 'Ped.' : identityLabel} {primaryCheckNumber}
                  </span>
                )}
                <KomaWaiterGlyph
                  name={
                    presentation.key === 'ready'
                      ? 'table-ready'
                      : presentation.key === 'payment'
                      ? 'table-payment'
                      : presentation.key === 'merged'
                      ? 'table-merged'
                      : presentation.key === 'served'
                      ? 'table-served'
                      : presentation.key === 'occupied'
                      ? 'table-service'
                      : 'table-free'
                  }
                  size={16}
                  className="opacity-70"
                />
              </div>
            )}
          </div>
          <strong
            className={`block min-w-0 text-koma-foreground ${emphasizeOrder ? 'whitespace-nowrap text-sm leading-tight' : customName ? 'whitespace-normal break-words text-sm leading-tight' : 'whitespace-nowrap font-serif text-3xl leading-none'}`}
            title={emphasizeOrder ? prominentOrderLabel ?? undefined : customName ? table.nome : undefined}
          >
            {emphasizeOrder ? prominentOrderLabel : customName ? table.nome : table.id}
          </strong>
          {mergedSources.length > 0 && <span className="block text-[9px] text-koma-muted">+ mesas {mergedSources.join(', ')}</span>}
        </div>
        {compact && occupied && <strong className="shrink-0 whitespace-nowrap font-mono text-xs text-koma-foreground">{formattedTotal}</strong>}
      </div>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className={`${compact ? 'text-[11px]' : 'text-[9px]'} font-bold uppercase tracking-wide inline-flex items-center gap-1.5`}>
            {presentation.key === 'ready' && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
            )}
            {presentation.key === 'free' && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            )}
            {presentation.key === 'occupied' && (
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            )}
            {presentation.label}
          </span>
          {draftCount > 0 && <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-950/30 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300" title={`${draftCount} no rascunho`}><FileText size={10} />{draftCount}</span>}
        </div>
        {occupied && compact && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-koma-secondary">
          <span className="inline-flex items-center gap-1 font-mono"><Clock3 size={11} aria-hidden="true" />{operational.elapsed}</span>
          {showItemCount && operational.production.activeItemCount > 0 && <span>{operational.production.activeItemCount} {operational.production.activeItemCount === 1 ? 'item' : 'itens'}</span>}
        </div>}
        {occupied && !compact && (
          <div className="border-t border-koma-border-subtle pt-2">
            {showItemCount ? (
              <div className="flex items-end justify-between gap-2">
                <div className="space-y-1 text-[10px] text-koma-secondary">
                  <span className="flex items-center gap-1 whitespace-nowrap font-mono"><Clock3 size={10} />{operational.elapsed}</span>
                  <span className="flex items-center gap-1"><UsersRound size={10} />{operational.production.activeItemCount} {operational.production.activeItemCount === 1 ? 'item' : 'itens'}</span>
                </div>
                <strong className="shrink-0 whitespace-nowrap font-mono text-xs text-koma-foreground">{formattedTotal}</strong>
              </div>
            ) : (
              <div className="space-y-1.5">
                <span className="flex items-center gap-1 whitespace-nowrap font-mono text-[10px] text-koma-secondary"><Clock3 size={10} />{operational.elapsed}</span>
                <strong className="block whitespace-nowrap font-mono text-sm leading-none text-koma-foreground">{formattedTotal}</strong>
              </div>
            )}
          </div>
        )}
        {occupied && showOperationalStatus && operational.financial === 'AWAITING_PAYMENT' && operational.production.hasPreparingItems && <p className="text-[9px] text-koma-secondary">{operational.production.preparingItemCount} em preparo</p>}
        {operational.mergedIntoMesaId && <span className="flex items-center gap-1 text-[9px]"><GitMerge size={11} />Atendimento junto · M{operational.mergedIntoMesaId}</span>}
        {note && <p className="text-[9px] text-koma-muted">{note}</p>}
        <TablePresenceNotice names={otherWaitersServing} compact />
      </div>
      {children}
    </Container>
  );
}
