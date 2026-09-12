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

  return (
    <div className="relative min-w-0">
      <SharedTableCard
        {...view}
        id={`mesa-card-${table.id}`}
        table={table}
        orders={orders}
        operational={operational}
        total={getTableTotal(orders)}
        onClick={() => onClick(table.id)}
      />
      {canQuickOrder && (
        <button
          id={`quick-order-table-${table.id}`}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onQuickOrder?.(table.id);
          }}
          aria-label={`Novo pedido na Mesa ${table.id}`}
          title="Adicionar pedido sem abrir o consumo"
          className="absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500 text-zinc-950 shadow-lg transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        >
          <Plus size={17} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
});
