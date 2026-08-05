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

  // Visual classes based on state (Cores aveludadas e mais escuras para conforto visual)
  const statusConfig = {
    livre: {
      borderColor: 'border-emerald-900/40 hover:border-emerald-700/60 focus:ring-emerald-500',
      bgColor: 'bg-[#041a12] hover:bg-[#072c1e]',
      badgeColor: 'text-emerald-500',
      label: '',
      textColor: 'text-emerald-200/90',
    },
    ocupada: {
      borderColor: hasPendingPayment 
        ? 'border-amber-600/50 focus:ring-amber-500'
        : 'border-rose-950/80 hover:border-rose-900/80 focus:ring-rose-500',
      bgColor: hasPendingPayment
        ? 'bg-[#241505]'
        : 'bg-[#220a0e] hover:bg-[#2e0e14]',
      badgeColor: hasPendingPayment
        ? 'text-amber-400'
        : 'text-rose-400',
      label: hasPendingPayment ? 'Aprovar Dinheiro' : 'Ocupada',
      textColor: 'text-rose-200/90',
    },
    pronto: {
      borderColor: 'border-amber-900/40 hover:border-amber-700/60 focus:ring-amber-500',
      bgColor: 'bg-[#241505] hover:bg-[#2e1c07]',
      badgeColor: 'text-amber-400',
      label: 'Pronto p/ Servir',
      textColor: 'text-amber-200/90',
    },
    entregue: {
      borderColor: 'border-blue-900/40 hover:border-blue-700/60 focus:ring-blue-500',
      bgColor: 'bg-[#081524] hover:bg-[#0d2138]',
      badgeColor: 'text-blue-300',
      label: 'Aguardando Pgto.',
      textColor: 'text-blue-200/90',
    },
    mesclada: {
      borderColor: 'border-dashed border-zinc-800 focus:ring-zinc-500',
      bgColor: 'bg-[#0f1013]',
      badgeColor: 'text-zinc-500',
      label: `Mesclada na Mesa ${mergedIntoMesaId}`,
      textColor: 'text-zinc-500',
    },
  };

  const currentConfig = statusConfig[status];
  const elapsed = formatElapsedTime(firstOrderTimestamp, currentTime);

  return (
    <button
      id={`mesa-card-${table.id}`}
      onClick={() => onClick(table.id)}
      className={`relative flex flex-col justify-between p-2 sm:p-3 rounded-xl border min-h-[85px] sm:min-h-[95px] ${currentConfig.borderColor} ${currentConfig.bgColor} cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full transition-all active:scale-95`}
    >
      {/* Top Section */}
      <div className="w-full">
        <div className="flex items-start justify-between">
          <span className="font-bold text-xs sm:text-sm text-zinc-100 tracking-tight leading-tight">
            {table.nome && table.nome !== `Mesa ${table.id}` ? table.nome : `Mesa ${table.id}`}
            {mergedSources && mergedSources.length > 0 && (
              <span className="text-[10px] font-normal text-zinc-400 ml-1">+{mergedSources.join('+')}</span>
            )}
          </span>
        </div>
      </div>

      {/* Bottom Section */}
      {status === 'livre' ? (
        <div className="w-full mt-1.5 flex items-center justify-between text-[10px] text-emerald-400 font-bold">
          <span>LIVRE</span>
          {draftCount > 0 ? (
            <span className="flex items-center gap-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded px-1 py-0.5 text-[9px] font-bold">
              <FileText size={9} className="shrink-0" />
              <span>{draftCount}</span>
            </span>
          ) : (
            <span className="text-xs font-bold">+</span>
          )}
        </div>
      ) : status === 'mesclada' ? (
        <div className="w-full mt-1.5 flex items-center justify-between text-[9px] text-zinc-400 font-sans">
          <div className="flex items-center gap-1">
            <GitMerge size={10} className="text-zinc-500 shrink-0" />
            <span>Mesclada</span>
          </div>
          <span className="font-mono text-[9px]">M{mergedIntoMesaId}</span>
        </div>
      ) : (
        <div className="w-full mt-1 flex items-center justify-between text-xs text-rose-200 font-bold">
          {/* Timer */}
          <div className="flex items-center gap-1">
            <Clock size={10} className="text-rose-300 shrink-0" />
            <span className="text-[10px] sm:text-[11px] font-mono font-bold text-rose-200">{elapsed}</span>
          </div>

          {/* Total Value */}
          <div className="flex items-center gap-1">
            {draftCount > 0 && (
              <div
                className="flex items-center gap-0.5 px-1 py-0.5 bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30 text-[9px]"
                title={`Rascunho: ${draftCount}`}
              >
                <FileText size={9} className="shrink-0" />
                <span className="font-bold">{draftCount}</span>
              </div>
            )}
            {otherWaitersServing.length > 0 && (
              <span title={`Editando: ${otherWaitersServing.join(', ')}`} className="text-amber-400 text-[10px]">
                ⚠️
              </span>
            )}
            <span className="text-xs text-rose-200 font-bold font-mono">
              {totalValue > 0 ? `R$${totalValue.toFixed(0)}` : status === 'entregue' ? '💳' : '+'}
            </span>
          </div>
        </div>
      )}
    </button>
  );
});
