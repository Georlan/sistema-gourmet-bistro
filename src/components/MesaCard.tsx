/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Clock } from 'lucide-react';
import { Table, Order } from '../types';
import { getTableTotal, formatElapsedTime } from '../domain';

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
}) => {
  const totalValue = getTableTotal(orders);
  
  // Calculate dynamic status:
  let status: 'livre' | 'ocupada' | 'pronto' | 'entregue' | 'mesclada' = 'livre';
  let firstOrderTimestamp: number | undefined;

  if (mergedIntoMesaId) {
    status = 'mesclada';
  } else if (orders.length > 0) {
    // Find the oldest order timestamp
    const timestamps = orders.map(o => o.timestamp);
    firstOrderTimestamp = Math.min(...timestamps);

    const allActiveItems = orders.flatMap(o => o.itens.filter(i => (i.status as string) !== 'cancelado'));
    const hasPronto = allActiveItems.some(item => item.status === 'pronto');
    const hasPreparando = allActiveItems.some(item => item.status === 'preparando');
    const allEntregue = allActiveItems.length > 0 && !hasPronto && !hasPreparando;

    if (hasPronto) {
      status = 'pronto';
    } else if (hasPreparando) {
      status = 'ocupada';
    } else if (allEntregue) {
      status = 'entregue';
    } else {
      status = 'ocupada';
    }
  }

  // Visual classes based on state
  const statusConfig = {
    livre: {
      borderColor: 'border-emerald-950/60 hover:border-emerald-500/30 focus:ring-emerald-500',
      bgColor: 'bg-emerald-950/80',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      label: 'Livre',
      textColor: 'text-emerald-400',
      glow: '',
    },
    ocupada: {
      borderColor: hasPendingPayment 
        ? 'border-amber-500 focus:ring-amber-500'
        : 'border-rose-950/60 hover:border-rose-500/30 focus:ring-rose-500',
      bgColor: hasPendingPayment
        ? 'bg-amber-950/70'
        : 'bg-rose-950/80',
      badgeColor: hasPendingPayment
        ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
        : 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      label: hasPendingPayment ? 'Aprovar Dinheiro' : 'Ocupada',
      textColor: hasPendingPayment ? 'text-amber-400' : 'text-rose-400',
      glow: '',
    },
    pronto: {
      borderColor: 'border-amber-500/20 hover:border-amber-500/40 focus:ring-amber-500',
      bgColor: 'bg-amber-950/80',
      badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      label: 'Pronto p/ Servir',
      textColor: 'text-amber-400',
      glow: '',
    },
    entregue: {
      borderColor: 'border-blue-500/30 hover:border-blue-500/50 focus:ring-blue-500',
      bgColor: 'bg-blue-950/85',
      badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      label: 'Aguardando Pgto.',
      textColor: 'text-blue-300',
      glow: '',
    },
    mesclada: {
      borderColor: 'border-dashed border-zinc-700 focus:ring-zinc-500',
      bgColor: 'bg-zinc-950/90',
      badgeColor: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
      label: `Mesclada na Mesa ${mergedIntoMesaId}`,
      textColor: 'text-zinc-400',
      glow: '',
    },
  };

  const currentConfig = statusConfig[status];
  const elapsed = formatElapsedTime(firstOrderTimestamp, currentTime);

  return (
    <button
      id={`mesa-card-${table.id}`}
      onClick={() => onClick(table.id)}
      className={`relative flex flex-col justify-between p-3 sm:p-5 lg:p-6 rounded-2xl border ${currentConfig.borderColor} ${currentConfig.bgColor} ${currentConfig.glow} cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full`}
    >
      {/* Top Section */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-2 sm:mb-4">
          <span className="font-serif text-base sm:text-2xl font-bold text-white tracking-tight">
            {table.nome && table.nome !== `Mesa ${table.id}` ? table.nome : `Mesa ${table.id}`}
            {mergedSources && mergedSources.length > 0 && ` + ${mergedSources.join(' + ')}`}
          </span>
        </div>
      </div>

      {/* Bottom Section */}
      {status === 'livre' ? (
        <div className="w-full mt-4 flex items-center justify-between border-t border-emerald-950/20 pt-4 text-[10px] text-emerald-500/40 uppercase font-sans tracking-widest font-bold">
          <div className="flex items-center gap-1.5">
            <span>Livre</span>
            {draftCount > 0 && (
              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded px-1.5 py-0.5 text-[8px] font-bold tracking-normal uppercase normal-case shrink-0">
                Rascunho ({draftCount})
              </span>
            )}
          </div>
          <span className="text-base font-normal">+</span>
        </div>
      ) : status === 'mesclada' ? (
        <div className="w-full mt-4 flex items-center justify-between border-t border-zinc-800/40 pt-4 text-[10px] text-zinc-500 uppercase font-sans tracking-widest font-bold">
          <span>Mesclada</span>
          <span className="text-zinc-500 font-mono">Mesa {mergedIntoMesaId}</span>
        </div>
      ) : (
        <div className="w-full pt-2 sm:pt-4 border-t border-[#27272A]">
          <div className="flex items-center justify-between text-[10px] sm:text-xs text-[#A1A1AA] mb-2 sm:mb-3 font-sans">
            {/* Timer since first order */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              <Clock size={11} className="text-emerald-400 shrink-0 sm:w-3 sm:h-3" />
              <span className="truncate">
                <strong className={status === 'entregue' ? 'text-blue-300 font-medium font-mono' : 'text-rose-400 font-medium font-mono'}>{elapsed}</strong>
              </span>
            </div>

            {/* Draft count */}
            {draftCount > 0 && (
              <div className="flex items-center gap-0.5 px-1 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20 font-bold text-[8px] sm:text-[10px]" title={`Rascunho: ${draftCount}`}>
                <span className="sm:inline hidden">Rascunho</span>
                <span>({draftCount})</span>
              </div>
            )}
          </div>

          {/* Concurrency alert */}
          {otherWaitersServing.length > 0 && (
            <div 
              className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded border border-amber-500/30 font-bold text-[8px] sm:text-[9px] mb-2 animate-pulse"
              title={`Outros garçons com rascunho nesta mesa: ${otherWaitersServing.join(', ')}`}
            >
              <span>⚠️</span>
              <span className="truncate">Editando: {otherWaitersServing.join(', ')}</span>
            </div>
          )}

          {/* Entregue — aguardando pagamento badge */}
          {status === 'entregue' && (
            <div className="flex items-center gap-1 px-1.5 py-1 bg-blue-500/10 text-blue-300 rounded-lg border border-blue-500/20 font-bold text-[8px] sm:text-[9px] mb-2 mt-1 w-full justify-center tracking-wider uppercase">
              <span>💳</span>
              <span>Aguardando Pagamento</span>
            </div>
          )}

          {/* Total Active Consumption */}
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between mt-1 sm:mt-2 font-sans">
            <span className="text-[8px] sm:text-[10px] text-[#A1A1AA] uppercase tracking-wider font-semibold">Total:</span>
            <span className={`text-xs sm:text-lg lg:text-xl font-bold font-mono ${totalValue > 0 ? 'text-emerald-400' : 'text-[#71717A]'}`}>
              R$ {totalValue.toFixed(2)}
            </span>
          </div>
        </div>
      )}

    </button>
  );
});
