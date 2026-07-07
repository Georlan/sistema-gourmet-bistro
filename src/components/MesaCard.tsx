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
}

export const MesaCard = React.memo<MesaCardProps>(({
  table,
  orders,
  draftCount,
  otherWaitersServing = [],
  currentTime,
  onClick,
}) => {
  const totalValue = getTableTotal(orders);
  
  // Calculate dynamic status:
  // - Verde (Livre): No orders
  // - Azul (Pronto): At least one item in 'pronto' status
  // - Vermelho (Ocupada): Has orders, but none is 'pronto' (all either 'preparando' or 'entregue')
  let status: 'livre' | 'ocupada' | 'pronto' = 'livre';
  let firstOrderTimestamp: number | undefined;

  if (orders.length > 0) {
    // Find the oldest order timestamp
    const timestamps = orders.map(o => o.timestamp);
    firstOrderTimestamp = Math.min(...timestamps);

    const hasPronto = orders.some(order => 
      order.itens.some(item => item.status === 'pronto')
    );
    
    status = hasPronto ? 'pronto' : 'ocupada';
  }

  // Visual classes based on state
  const statusConfig = {
    livre: {
      borderColor: 'border-emerald-950 hover:border-emerald-500/50 focus:ring-emerald-500',
      bgColor: 'bg-emerald-950/10 hover:bg-emerald-950/20 backdrop-blur-md',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      label: 'Livre',
      textColor: 'text-emerald-400',
      glow: 'hover:translate-y-[-2px] hover:shadow-[0_0_20px_rgba(16,185,129,0.08)] active:translate-y-[0px]',
    },
    ocupada: {
      borderColor: 'border-rose-950 hover:border-rose-500/50 focus:ring-rose-500',
      bgColor: 'bg-rose-950/10 hover:bg-rose-950/20 backdrop-blur-md',
      badgeColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      label: 'Ocupada',
      textColor: 'text-rose-400',
      glow: 'hover:translate-y-[-2px] hover:shadow-[0_0_20px_rgba(244,63,94,0.08)] active:translate-y-[0px]',
    },
    pronto: {
      borderColor: 'border-amber-500/30 hover:border-amber-500/60 focus:ring-amber-500',
      bgColor: 'bg-amber-950/10 hover:bg-amber-950/20 backdrop-blur-md',
      badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      label: 'Pediu a Conta',
      textColor: 'text-amber-400',
      glow: 'animate-pulse-subtle hover:translate-y-[-2px] hover:shadow-[0_0_25px_rgba(245,158,11,0.15)] active:translate-y-[0px]',
    },
  };

  const currentConfig = statusConfig[status];
  const elapsed = formatElapsedTime(firstOrderTimestamp, currentTime);

  return (
    <button
      id={`mesa-card-${table.id}`}
      onClick={() => onClick(table.id)}
      className={`relative flex flex-col justify-between p-3 sm:p-5 lg:p-6 rounded-2xl border ${currentConfig.borderColor} ${currentConfig.bgColor} ${currentConfig.glow} transition-all duration-300 cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-[#C5A880] w-full`}
    >
      {/* Top Section */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-2 sm:mb-4">
          <span className="font-serif text-base sm:text-2xl font-bold text-white tracking-tight">
            Mesa {table.id}
          </span>
        </div>
      </div>

      {/* Bottom Section */}
      {status === 'livre' ? (
        <div className="w-full mt-4 flex items-center justify-between border-t border-emerald-950/20 pt-4 text-[10px] text-emerald-500/40 uppercase font-sans tracking-widest font-bold">
          <div className="flex items-center gap-1.5">
            <span>Livre</span>
            {draftCount > 0 && (
              <span className="bg-[#C5A880]/20 text-[#C5A880] border border-[#C5A880]/30 rounded px-1.5 py-0.5 text-[8px] font-bold tracking-normal uppercase normal-case shrink-0">
                Rascunho ({draftCount})
              </span>
            )}
          </div>
          <span className="text-base font-normal">+</span>
        </div>
      ) : (
        <div className="w-full pt-2 sm:pt-4 border-t border-[#27272A]">
          <div className="flex items-center justify-between text-[10px] sm:text-xs text-[#A1A1AA] mb-2 sm:mb-3 font-sans">
            {/* Timer since first order */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              <Clock size={11} className="text-[#C5A880] shrink-0 sm:w-3 sm:h-3" />
              <span className="truncate">
                <strong className="text-rose-400 font-medium font-mono">{elapsed}</strong>
              </span>
            </div>

            {/* Draft count */}
            {draftCount > 0 && (
              <div className="flex items-center gap-0.5 px-1 bg-[#C5A880]/10 text-[#C5A880] rounded border border-[#C5A880]/20 font-bold text-[8px] sm:text-[10px]" title={`Rascunho: ${draftCount}`}>
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

          {/* Total Active Consumption */}
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between mt-1 sm:mt-2 font-sans">
            <span className="text-[8px] sm:text-[10px] text-[#A1A1AA] uppercase tracking-wider font-semibold">Total:</span>
            <span className={`text-xs sm:text-lg lg:text-xl font-bold font-mono ${totalValue > 0 ? 'text-[#C5A880]' : 'text-[#71717A]'}`}>
              R$ {totalValue.toFixed(2)}
            </span>
          </div>
        </div>
      )}

    </button>
  );
});
