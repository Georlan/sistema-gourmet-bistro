/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Plus } from 'lucide-react';
import type { Table, Order } from '../types';
import { getTableTotal } from '../domain';
import { deriveTableOperationalState, type TableOperationalProjection } from '../domain/operationalState';
import { SharedTableCard } from './shared/SharedTableCard';

interface MesaCardProps {
  table: Table;
  orders: Order[];
  draftCount: number;
  otherWaitersServing?: string[];
  currentTime: number;
  activeWaiterId: string;
  onClick: (tableId: number) => void;
  onQuickOrder?: (tableId: number) => void;
  hasPendingPayment?: boolean;
  mergedSources?: number[];
  mergedIntoMesaId?: number | null;
  showOperationalStatus?: boolean;
  operational?: TableOperationalProjection;
}

/** Waiter variant owns only its navigation callbacks, not cashier actions. */
export const MesaCard = React.memo<MesaCardProps>(({
  table, orders, currentTime, onClick, onQuickOrder, hasPendingPayment = false, mergedIntoMesaId = null,
  operational: projectedState, ...view
}) => {
  const operational = projectedState ?? deriveTableOperationalState({
    table, orders, hasPendingPayment, mergedIntoMesaId, now: currentTime,
  });
  const canQuickOrder = Boolean(
    onQuickOrder
    && operational.occupancy === 'IN_SERVICE'
    && !operational.mergedIntoMesaId,
  );
  const tableLabel = table.nome && table.nome !== `Mesa ${table.id}` ? table.nome : `Mesa ${table.id}`;

  const quickOrderAction = canQuickOrder ? (
    <button
      id={`quick-order-table-${table.id}`}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onQuickOrder?.(table.id);
      }}
      aria-label={`Novo pedido na Mesa ${table.id}`}
      title="Adicionar pedido sem abrir o consumo"
      className="relative z-20 inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-emerald-400/25 bg-emerald-500/[0.06] px-2 text-[10px] font-semibold text-emerald-700 transition-colors hover:border-emerald-400/45 hover:bg-emerald-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 dark:text-emerald-300"
    >
      <Plus size={12} strokeWidth={2.25} aria-hidden="true" />
      <span className="hidden min-[560px]:inline">Pedido</span>
    </button>
  ) : undefined;

  return (
    <div className="relative h-[176px] min-w-0 sm:h-[184px]">
      <SharedTableCard
        {...view}
        table={table}
        orders={orders}
        operational={operational}
        total={getTableTotal(orders)}
        footerAction={quickOrderAction}
        fillHeight
      />
      <button
        id={`mesa-card-${table.id}`}
        type="button"
        onClick={() => onClick(table.id)}
        aria-label={`Abrir ${tableLabel}`}
        title={`Abrir ${tableLabel}`}
        className="absolute inset-0 z-10 rounded-2xl bg-transparent transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
      />
    </div>
  );
});
