/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import type { Table, Order } from '../types';
import { getTableTotal } from '../domain';
import { deriveTableOperationalState, type TableOperationalProjection } from '../domain/operationalState';
import { getTableCheckNumbers } from '../domain/tableReadModel';
import { SharedTableCard, tableCardPresentation } from './shared/SharedTableCard';

interface MesaCardProps {
  table: Table;
  orders: Order[];
  draftCount: number;
  otherWaitersServing?: string[];
  currentTime: number;
  activeWaiterId: string;
  onClick: (tableId: number, targetTab?: 'consumo' | 'lancamento') => void;
  onOpenOrderEntry?: (tableId: number) => void;
  onOpenConsumption?: (tableId: number) => void;
  hasPendingPayment?: boolean;
  mergedSources?: number[];
  mergedIntoMesaId?: number | null;
  showOperationalStatus?: boolean;
  operational?: TableOperationalProjection;
}

/** Waiter variant owns only its navigation callback, not cashier actions. */
export const MesaCard = React.memo<MesaCardProps>(({
  table, orders, currentTime, onClick, onOpenOrderEntry, onOpenConsumption,
  hasPendingPayment = false, mergedIntoMesaId = null,
  operational: projectedState, ...view
}) => {
  const operational = projectedState ?? deriveTableOperationalState({
    table, orders, hasPendingPayment, mergedIntoMesaId, now: currentTime,
  });
  const tableLabel = table.nome && table.nome !== `Mesa ${table.id}` ? table.nome : `Mesa ${table.id}`;
  const presentation = tableCardPresentation(operational, true);
  const checkNumbers = getTableCheckNumbers(orders);
  const numbersText = checkNumbers.map(number => `#${number}`).join(' + ');
  const accessibleLabel = `${tableLabel}: ${presentation.label}${numbersText ? `, pedido ${numbersText}` : ''}`;
  const actionLabel = operational.mergedIntoMesaId
    ? 'Ver atendimento'
    : operational.occupancy === 'FREE'
      ? 'Novo pedido'
      : operational.production.hasReadyItems
        ? 'Ver itens prontos'
        : 'Ver consumo';

  const isFree = operational.occupancy === 'FREE';
  const isMerged = Boolean(operational.mergedIntoMesaId);
  const isPayment = operational.financial === 'AWAITING_PAYMENT' || operational.hasPendingConfirmation || hasPendingPayment;
  const canAppendOrder = !isMerged && !isPayment;

  const handlePrimaryClick = () => {
    if (isFree) {
      if (onOpenOrderEntry) onOpenOrderEntry(table.id);
      else onClick(table.id);
    } else {
      if (onOpenConsumption) onOpenConsumption(table.id);
      else onClick(table.id);
    }
  };

  const handleOrderEntryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenOrderEntry) onOpenOrderEntry(table.id);
    else onClick(table.id);
  };

  return (
    <div
      id={`mesa-card-${table.id}`}
      role="region"
      aria-label={accessibleLabel}
      data-waiter-action={actionLabel}
      onClick={handlePrimaryClick}
      className="relative h-full w-full min-w-0"
    >
      <SharedTableCard
        {...view}
        table={table}
        orders={orders}
        operational={operational}
        total={getTableTotal(orders)}
        identityLabel="Pedido"
        fillHeight
        showItemCount={false}
      >
        <div className="mt-auto pt-2 w-full min-w-0 max-w-full">
          {isFree ? (
            <span
              aria-label={`${actionLabel} na ${tableLabel}`}
              className="inline-flex h-8 w-full min-w-0 max-w-full items-center justify-center whitespace-normal rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-center text-[9px] font-bold uppercase leading-tight tracking-wide text-emerald-700 dark:text-emerald-400 shadow-xs"
            >
              {actionLabel}
            </span>
          ) : canAppendOrder ? (
            <button
              type="button"
              id={`mesa-card-launch-${table.id}`}
              onClick={handleOrderEntryClick}
              aria-label={`Lançar pedido na ${tableLabel}`}
              title={`+ Lançar pedido · ${tableLabel}`}
              className="inline-flex h-8 w-full min-w-0 max-w-full items-center justify-center whitespace-nowrap rounded-xl border border-emerald-500/40 bg-emerald-500/15 dark:bg-emerald-500/20 px-2.5 py-1 text-center text-xs font-bold leading-tight tracking-wide text-emerald-800 dark:text-emerald-200 transition-all hover:bg-emerald-500/30 active:scale-[0.98] shadow-xs cursor-pointer"
            >
              + Lançar
            </button>
          ) : (
            <span
              aria-label={`${actionLabel} na ${tableLabel}`}
              className="inline-flex h-8 w-full min-w-0 max-w-full items-center justify-center whitespace-normal rounded-xl border border-current/20 bg-black/5 px-2 py-1 text-center text-[9px] font-bold uppercase leading-tight tracking-wide dark:bg-white/5 shadow-xs"
            >
              {actionLabel}
            </span>
          )}
        </div>
      </SharedTableCard>
    </div>
  );
});
