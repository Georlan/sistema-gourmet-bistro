import React from 'react';
import { Clock3, FileText, GitMerge, UsersRound } from 'lucide-react';
import type { Order, Table } from '../../types';
import type { TableOperationalProjection } from '../../domain/operationalState';

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
  free: 'koma-table-free-card text-emerald-800 dark:text-emerald-300',
  occupied: 'border-rose-400/70 bg-rose-50 dark:border-rose-900 dark:bg-[#1b0d10] text-rose-900 dark:text-rose-300',
  ready: 'border-amber-400/80 bg-amber-50 dark:border-amber-800/60 dark:bg-[#211707] text-amber-900 dark:text-amber-300',
  payment: 'border-sky-400/80 bg-sky-50 dark:border-sky-800/60 dark:bg-[#0b1621] text-sky-900 dark:text-sky-300',
  served: 'border-koma-border bg-koma-panel text-koma-secondary',
  merged: 'border-dashed border-koma-border bg-koma-panel text-koma-muted',
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
  /** Compatibility with cashier filters, not a second presentation authority. */
  filterStatus?: string;
  note?: string;
  children?: React.ReactNode;
}

/** Common shell; caller owns navigation, payment and any role-specific actions. */
export function SharedTableCard({
  id, table, orders, operational, total, draftCount = 0, mergedSources = [],
  otherWaitersServing = [], showOperationalStatus = true, onClick, filterStatus, note, children,
}: Props) {
  const presentation = tableCardPresentation(operational, showOperationalStatus);
  const checkNumbers = Array.from(new Set(orders
    .flatMap(order => order.numeroPedidos?.length ? order.numeroPedidos : [order.numeroPedido])
    .map(Number).filter(number => Number.isFinite(number) && number > 0)));
  const numbersText = checkNumbers.map(number => `#${number}`).join(' + ');
  const customName = table.nome && table.nome !== `Mesa ${table.id}`;
  const Container = onClick ? 'button' : 'article';
  const occupied = operational.occupancy === 'IN_SERVICE' && !operational.mergedIntoMesaId;
  return (
    <Container
      id={id}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={`${customName ? table.nome : `Mesa ${table.id}`}: ${presentation.label}${numbersText ? `, comanda ${numbersText}` : ''}`}
      data-table-status={filterStatus}
      data-operational-state={presentation.key}
      className={`group relative flex min-w-0 min-h-[132px] flex-col justify-between gap-3 overflow-hidden rounded-2xl border p-3 sm:p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${tones[presentation.key]} ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}
    >
      <span className="absolute left-0 top-0 h-[3px] w-full bg-current opacity-70" aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-[9px] font-mono font-bold uppercase tracking-widest text-koma-muted">{customName ? `Mesa ${table.id}` : 'Mesa'}</span>
          <strong className={`block text-koma-foreground ${customName ? 'break-words text-sm' : 'font-serif text-3xl leading-none'}`}>{customName ? table.nome : table.id}</strong>
          {mergedSources.length > 0 && <span className="block text-[9px] text-koma-muted">+ mesas {mergedSources.join(', ')}</span>}
        </div>
        {checkNumbers.length > 0 && <span className="max-w-[55%] break-words rounded-md border border-current/20 px-1.5 py-1 text-[9px] font-mono" title={`Comanda ${numbersText}`}>Comanda {checkNumbers[0]}{checkNumbers.length > 1 ? ` +${checkNumbers.length - 1}` : ''}</span>}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className="text-[9px] font-bold uppercase tracking-wide">{presentation.label}</span>
          {draftCount > 0 && <span className="inline-flex items-center gap-1 rounded-md border border-current/20 px-1.5 text-[10px]"><FileText size={10} />{draftCount}</span>}
        </div>
        {occupied && <div className="flex flex-wrap items-end justify-between gap-2 border-t border-koma-border-subtle pt-2">
          <div className="space-y-1 text-[10px] text-koma-secondary">
            <span className="flex items-center gap-1 font-mono"><Clock3 size={10} />{operational.elapsed}</span>
            <span className="flex items-center gap-1"><UsersRound size={10} />{operational.production.activeItemCount} {operational.production.activeItemCount === 1 ? 'item' : 'itens'}</span>
          </div>
          <strong className="font-mono text-xs text-koma-foreground">{`R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</strong>
        </div>}
        {occupied && showOperationalStatus && operational.financial === 'AWAITING_PAYMENT' && operational.production.hasPreparingItems && <p className="text-[9px] text-koma-secondary">{operational.production.preparingItemCount} em preparo</p>}
        {operational.mergedIntoMesaId && <span className="flex items-center gap-1 text-[9px]"><GitMerge size={11} />Atendimento junto · M{operational.mergedIntoMesaId}</span>}
        {note && <p className="text-[9px] text-koma-muted">{note}</p>}
        {otherWaitersServing.length > 0 && <p className="truncate text-[9px] text-koma-secondary" title={`Em atendimento por ${otherWaitersServing.join(', ')}`}>Atendida por {otherWaitersServing.join(', ')}</p>}
      </div>
      {children}
    </Container>
  );
}
