/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
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
  hasPendingPayment?: boolean;
  mergedSources?: number[];
  mergedIntoMesaId?: number | null;
  showOperationalStatus?: boolean;
  operational?: TableOperationalProjection;
}

/** Waiter variant owns only its navigation callback, not cashier actions. */
export const MesaCard = React.memo<MesaCardProps>(({
  table, orders, currentTime, onClick, hasPendingPayment = false, mergedIntoMesaId = null,
  operational: projectedState, ...view
}) => {
  const operational = projectedState ?? deriveTableOperationalState({
    table, orders, hasPendingPayment, mergedIntoMesaId, now: currentTime,
  });
  const tableLabel = table.nome && table.nome !== `Mesa ${table.id}` ? table.nome : `Mesa ${table.id}`;

  return (
    <div className="relative h-full w-full min-w-0">
      <SharedTableCard
        {...view}
        table={table}
        orders={orders}
        operational={operational}
        total={getTableTotal(orders)}
        identityLabel="Pedido"
        fillHeight
        showItemCount={false}
      />
      <button
        id={`mesa-card-${table.id}`}
        type="button"
        onClick={() => onClick(table.id)}
        aria-label={`Abrir ${tableLabel}`}
        title={`Abrir ${tableLabel}`}
        className="absolute inset-0 z-10 h-full w-full rounded-2xl bg-transparent transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
      />
    </div>
  );
});
