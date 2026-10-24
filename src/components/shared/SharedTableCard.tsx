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
  free: 'koma-table-free-card border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111416] text-koma-foreground hover:border-emerald-500/50 shadow-xs',
  occupied: 'border-zinc-300 dark:border-zinc-700/80 bg-white dark:bg-[#131618] text-koma-foreground hover:border-amber-500/50 shadow-xs',
  ready: 'border-emerald-500/80 dark:border-emerald-500 bg-white dark:bg-[#0e1713] text-koma-foreground ring-1 ring-emerald-500/40 shadow-xs',
  payment: 'border-sky-300 dark:border-sky-700/70 bg-white dark:bg-[#0f161c] text-koma-foreground hover:border-sky-500/50 shadow-xs',
  served: 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-koma-foreground shadow-xs',
  merged: 'border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 text-koma-muted shadow-xs',
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
      className={`group relative flex min-w-0 min-h-[136px] flex-col justify-between overflow-hidden rounded-2xl border text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${fillHeight ? 'h-full' : ''} ${compact ? 'gap-2 p-3' : 'gap-2 p-3 sm:gap-2.5 sm:p-3.5'} ${tones[presentation.key]} ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}
    >
      <span className="absolute left-0 top-0 h-[2px] w-full bg-current opacity-40" aria-hidden="true" />
      <div className="flex items-start justify-between gap-1.5 min-w-0">
        <div className="min-w-0 flex-1">
          <strong
            className={`block min-w-0 text-koma-foreground font-black tracking-tight leading-tight ${emphasizeOrder ? 'whitespace-nowrap text-sm' : customName ? 'whitespace-normal break-words text-sm' : 'whitespace-nowrap text-base sm:text-lg'}`}
            title={emphasizeOrder ? prominentOrderLabel ?? undefined : customName ? table.nome : undefined}
          >
            {emphasizeOrder ? prominentOrderLabel : customName ? table.nome : tableDisplayName}
          </strong>
          {mergedSources.length > 0 && <span className="block text-[9px] text-koma-muted">+ mesas {mergedSources.join(', ')}</span>}
        </div>
        {primaryCheckNumber != null && !emphasizeOrder && (
          <span className="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-mono font-bold text-zinc-500 dark:text-zinc-400 bg-black/5 dark:bg-white/5 border border-current/15 leading-none" title={`${identityLabel} ${numbersText}`}>
            {identityLabel === 'Pedido' ? 'Ped.' : identityLabel} {primaryCheckNumber}
          </span>
        )}
      </div>

      {!occupied && (
        <div className="my-auto py-1 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>{presentation.label}</span>
          </div>
          {table.capacidade > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500 font-medium">
              <UsersRound size={11} className="opacity-70" /> {table.capacidade} lugares
            </span>
          )}
          {draftCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-950/30 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300" title={`${draftCount} no rascunho`}>
              <FileText size={10} />{draftCount} rascunho
            </span>
          )}
        </div>
      )}

      {occupied && (
        <div className="space-y-1.5 my-auto py-1">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className={`text-[10px] font-semibold tracking-wide inline-flex items-center gap-1.5 ${
              presentation.key === 'ready'
                ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                : presentation.key === 'payment'
                ? 'text-sky-600 dark:text-sky-400 font-bold'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}>
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
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              )}
              {presentation.key === 'payment' && (
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              )}
              {presentation.label}
            </span>
            {draftCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-950/30 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300" title={`${draftCount} no rascunho`}>
                <FileText size={10} />{draftCount}
              </span>
            )}
          </div>

          <div>
            {showItemCount ? (
              <div className="flex items-end justify-between gap-2">
                <div className="space-y-1 text-[10px] text-koma-secondary">
                  <span className="flex items-center gap-1 whitespace-nowrap font-mono"><Clock3 size={10} />{operational.elapsed}</span>
                  <span className="flex items-center gap-1"><UsersRound size={10} />{operational.production.activeItemCount} {operational.production.activeItemCount === 1 ? 'item' : 'itens'}</span>
                </div>
                <strong className="shrink-0 whitespace-nowrap font-mono text-xs text-koma-foreground">{formattedTotal}</strong>
              </div>
            ) : (
              <div className="flex items-baseline justify-between gap-1 pt-1 border-t border-zinc-200/50 dark:border-white/5">
                <span className="flex items-center gap-1 whitespace-nowrap font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  <Clock3 size={11} className="text-zinc-400 dark:text-zinc-500" />
                  {operational.elapsed}
                </span>
                <strong className="block whitespace-nowrap font-mono text-sm leading-none text-koma-foreground font-black">
                  {formattedTotal}
                </strong>
              </div>
            )}
          </div>
          {operational.mergedIntoMesaId && <span className="flex items-center gap-1 text-[9px] text-koma-muted"><GitMerge size={11} />Atendimento junto · M{operational.mergedIntoMesaId}</span>}
          {note && <p className="text-[9px] text-koma-muted">{note}</p>}
          <TablePresenceNotice names={otherWaitersServing} compact />
        </div>
      )}
      {children}
    </Container>
  );
}
