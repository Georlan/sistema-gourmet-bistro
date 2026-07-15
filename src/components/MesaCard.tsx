/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Clock, FileText, GitMerge } from 'lucide-react';
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
      className={`relative flex flex-col justify-between p-2.5 sm:p-4 rounded-xl border min-h-[100px] sm:min-h-[130px] ${currentConfig.borderColor} ${currentConfig.bgColor} cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full`}
    >
      {/* Top Section */}
      <div className="w-full">
        <div className="flex items-start justify-between mb-1.5 sm:mb-3">
          <span className="font-serif text-sm sm:text-lg font-bold text-white tracking-tight leading-tight">
            {table.nome && table.nome !== `Mesa ${table.id}` ? table.nome : `Mesa ${table.id}`}
            {mergedSources && mergedSources.length > 0 && (
              <span className="text-[10px] font-normal text-zinc-400 ml-1">+{mergedSources.join('+')}</span>
            )}
          </span>
        </div>
      </div>

      {/* Bottom Section */}
      {status === 'livre' ? (
        <div className="w-full mt-3 flex items-center justify-between border-t border-emerald-950/20 pt-2 text-[9px] text-emerald-500/40 uppercase font-sans tracking-widest font-bold">
          <div className="flex items-center gap-1">
            <span>Livre</span>
            {draftCount > 0 && (
              <span className="flex items-center gap-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded px-1 py-0.5 text-[8px] font-bold">
                <FileText size={9} className="shrink-0" />
                <span>{draftCount}</span>
              </span>
            )}
          </div>
          <span className="text-sm font-normal">+</span>
        </div>
      ) : status === 'mesclada' ? (
        <div className="w-full mt-3 flex items-center justify-between border-t border-[#27272A] pt-2 text-[9px] text-zinc-500 font-sans font-bold uppercase tracking-wider">
          <div className="flex items-center gap-1">
            <GitMerge size={10} className="text-zinc-500 shrink-0" />
            <span>Mesclada</span>
          </div>
          <span className="text-zinc-400 font-mono text-[9px]">M{mergedIntoMesaId}</span>
        </div>
      ) : (
        <div className="w-full pt-2 border-t border-[#27272A]">
          <div className="flex items-center justify-between">
            {/* Timer */}
            <div className="flex items-center gap-1">
              <Clock size={10} className="text-emerald-400 shrink-0" />
              <strong className={`text-[10px] font-mono ${status === 'entregue' ? 'text-blue-300' : 'text-rose-400'}`}>{elapsed}</strong>
            </div>

            {/* Right side: draft icon + total */}
            <div className="flex items-center gap-1.5">
              {draftCount > 0 && (
                <div className="flex items-center gap-0.5 px-1 py-0.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20 text-[9px]" title={`Rascunho: ${draftCount}`}>
                  <FileText size={10} className="shrink-0" />
                  <span className="font-bold">{draftCount}</span>
                </div>
              )}
              {otherWaitersServing.length > 0 && (
                <span title={`Editando: ${otherWaitersServing.join(', ')}`} className="text-amber-400 text-[11px]">⚠️</span>
              )}
              <span className={`text-xs sm:text-sm font-bold font-mono ${totalValue > 0 ? 'text-emerald-400' : 'text-[#71717A]'}`}>
                {totalValue > 0 ? `R$${totalValue.toFixed(0)}` : (status === 'entregue' ? '💳' : '+')}
              </span>
            </div>
          </div>
        </div>
      )}

    </button>
  );
});
