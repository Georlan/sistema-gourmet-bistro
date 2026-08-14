/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CirclePlus, Clock3, FileText, GitMerge, ReceiptText, UsersRound } from 'lucide-react';
import { Table, Order } from '../types';
import { getTableTotal, formatElapsedTime, normalizeOperationalTimestamp } from '../domain';

interface MesaCardProps {
  table: Table;
  orders: Order[];
  draftCount: number;
  otherWaitersServing?: string[];
  currentTime: number;
  activeWaiterId: string;
  onClick: (tableId: number) => void;
  hasPendingPayment?: boolean;
  mergedSources?: number[];
  mergedIntoMesaId?: number | null;
  showOperationalStatus?: boolean;
}

export const MesaCard = React.memo<MesaCardProps>(({
  table,
  orders,
  draftCount,
  otherWaitersServing = [],
  currentTime,
  onClick,
  hasPendingPayment = false,
  mergedSources = [],
  mergedIntoMesaId = null,
  showOperationalStatus = true,
}) => {
  const totalValue = getTableTotal(orders);
  let status: 'livre' | 'ocupada' | 'pronto' | 'entregue' | 'mesclada' = 'livre';
  let firstOrderTimestamp: number | undefined;

  if (mergedIntoMesaId) {
    status = 'mesclada';
  } else if (orders.length > 0) {
    const validTimestamps = orders
      .map((order) => (order as any).created_at || order.timestamp)
      .map((t) => normalizeOperationalTimestamp(t, currentTime))
      .filter((t): t is number => t !== null);
    if (validTimestamps.length > 0) {
      firstOrderTimestamp = Math.min(...validTimestamps);
    }
    const activeItems = orders.flatMap((order) => order.itens.filter((item) => (item.status as string) !== 'cancelado'));
    const hasReady = activeItems.some((item) => item.status === 'pronto');
    const hasPreparing = activeItems.some((item) => item.status === 'preparando');
    const allDelivered = activeItems.length > 0 && !hasReady && !hasPreparing;
    status = showOperationalStatus
      ? (hasReady ? 'pronto' : hasPreparing ? 'ocupada' : allDelivered ? 'entregue' : 'ocupada')
      : 'ocupada';
  }

  const statusConfig = {
    livre: {
      surface: 'bg-[#0b1713] hover:bg-[#0e211a]',
      border: 'border-emerald-900/50 hover:border-emerald-600/60 focus-visible:ring-emerald-400',
      accent: 'bg-[#00b894]',
      dot: 'bg-[#00d9a6]',
      label: 'Livre',
      labelColor: 'text-[#00d9a6]',
    },
    ocupada: {
      surface: hasPendingPayment ? 'bg-[#20180b] hover:bg-[#2a1f0c]' : 'bg-[#1b0d10] hover:bg-[#251014]',
      border: hasPendingPayment
        ? 'border-amber-800/60 hover:border-amber-500/60 focus-visible:ring-amber-400'
        : 'border-rose-950 hover:border-rose-700/70 focus-visible:ring-rose-400',
      accent: hasPendingPayment ? 'bg-amber-400' : 'bg-rose-500',
      dot: hasPendingPayment ? 'bg-amber-400' : 'bg-rose-400',
      label: hasPendingPayment ? 'Aprovar dinheiro' : 'Em atendimento',
      labelColor: hasPendingPayment ? 'text-amber-300' : 'text-rose-300',
    },
    pronto: {
      surface: 'bg-[#211707] hover:bg-[#2b1e08]',
      border: 'border-amber-800/60 hover:border-amber-500/70 focus-visible:ring-amber-400',
      accent: 'bg-amber-400',
      dot: 'bg-amber-400 animate-pulse',
      label: 'Pronto para servir',
      labelColor: 'text-amber-300',
    },
    entregue: {
      surface: 'bg-[#0b1621] hover:bg-[#0d1d2c]',
      border: 'border-sky-900/60 hover:border-sky-600/60 focus-visible:ring-sky-400',
      accent: 'bg-sky-400',
      dot: 'bg-sky-400',
      label: 'Aguardando conta',
      labelColor: 'text-sky-300',
    },
    mesclada: {
      surface: 'bg-koma-panel hover:bg-koma-card',
      border: 'border-dashed border-koma-border hover:border-zinc-600 focus-visible:ring-zinc-400',
      accent: 'bg-zinc-600',
      dot: 'bg-zinc-600',
      label: `Unida à mesa ${mergedIntoMesaId}`,
      labelColor: 'text-koma-subtle',
    },
  }[status];

  const elapsed = formatElapsedTime(firstOrderTimestamp, currentTime);
  const activeItemCount = orders.reduce((total, order) => (
    total + order.itens.filter((item) => (item.status as string) !== 'cancelado').length
  ), 0);
  const defaultName = `Mesa ${table.id}`;
  const hasCustomName = Boolean(table.nome && table.nome !== defaultName);

  return (
    <button
      id={`mesa-card-${table.id}`}
      type="button"
      onClick={() => onClick(table.id)}
      aria-label={`${hasCustomName ? table.nome : defaultName}: ${statusConfig.label}`}
      className={`group relative min-w-0 min-h-[112px] sm:min-h-[132px] overflow-hidden rounded-2xl border p-3 sm:p-4 text-left transition-all duration-200 ${statusConfig.surface} ${statusConfig.border} hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(0,0,0,0.24)] active:translate-y-0 active:scale-[0.98] focus:outline-none focus-visible:ring-2`}
    >
      <span className={`absolute left-0 top-0 h-[3px] w-full ${statusConfig.accent}`} aria-hidden="true" />
      <span className="absolute -right-5 -top-8 font-serif text-[72px] sm:text-[88px] font-black leading-none text-koma-foreground/[0.025]" aria-hidden="true">
        {table.id}
      </span>

      <div className="relative flex h-full flex-col justify-between gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="block text-[8px] sm:text-[9px] font-mono font-bold uppercase tracking-[0.16em] text-koma-muted">
              {hasCustomName ? `Mesa ${table.id}` : 'Mesa'}
            </span>
            <strong className={`${hasCustomName ? 'text-xs sm:text-sm font-bold tracking-tight leading-tight line-clamp-2 break-words' : 'text-2xl sm:text-3xl font-serif font-black tracking-[-0.05em] leading-none'} mt-0.5 block text-koma-foreground`}>
              {hasCustomName ? table.nome : table.id}
            </strong>
            {mergedSources.length > 0 && (
              <span className="mt-1 block text-[9px] font-mono text-koma-subtle">+ mesas {mergedSources.join(', ')}</span>
            )}
          </div>
          {status === 'livre' ? (
            <CirclePlus size={18} className="shrink-0 text-emerald-500 transition-transform group-hover:rotate-90" />
          ) : status === 'mesclada' ? (
            <GitMerge size={17} className="shrink-0 text-koma-muted" />
          ) : (
            <div className="flex items-center gap-1.5 rounded-full border border-koma-border-subtle bg-black/20 px-2 py-1">
              <span className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot}`} />
              <span className="hidden 2xl:inline text-[8px] font-bold uppercase tracking-wider text-koma-subtle">Ativa</span>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <span className={`min-w-0 truncate text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.11em] ${statusConfig.labelColor}`}>
              {statusConfig.label}
            </span>
            {draftCount > 0 && (
              <span className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                <FileText size={9} /> {draftCount}
              </span>
            )}
          </div>

          {status !== 'livre' && status !== 'mesclada' && (
            <div className="mt-2 flex items-end justify-between gap-2 border-t border-koma-border-subtle pt-2">
              <div className="min-w-0 space-y-1">
                <span className="flex items-center gap-1 text-[9px] sm:text-[10px] font-mono font-bold text-koma-secondary">
                  <Clock3 size={10} className="shrink-0 text-koma-muted" /> {elapsed}
                </span>
                <span className="flex items-center gap-1 text-[8px] sm:text-[9px] text-koma-muted">
                  <UsersRound size={9} /> {activeItemCount} {activeItemCount === 1 ? 'item' : 'itens'}
                </span>
              </div>
              <span className={`shrink-0 font-mono text-xs sm:text-sm font-bold ${status === 'pronto' ? 'text-amber-200' : status === 'entregue' ? 'text-sky-200' : 'text-rose-100'}`}>
                {totalValue > 0 ? `R$ ${totalValue.toFixed(0)}` : <ReceiptText size={15} />}
              </span>
            </div>
          )}

          {status === 'mesclada' && (
            <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[9px] text-koma-muted">
              <span>Atendimento unificado</span>
              <span className="font-mono">M{mergedIntoMesaId}</span>
            </div>
          )}

          {otherWaitersServing.length > 0 && (
            <p className="mt-1.5 truncate text-[8px] text-amber-400" title={`Em atendimento por ${otherWaitersServing.join(', ')}`}>
              Em edição por {otherWaitersServing.join(', ')}
            </p>
          )}
        </div>
      </div>
    </button>
  );
});
