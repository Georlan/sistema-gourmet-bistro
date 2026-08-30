/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import type { Table, Order } from '../types';
import { getTableTotal } from '../domain';
import { deriveTableOperationalState } from '../domain/operationalState';
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
}

/** Waiter variant owns only its navigation callback, not cashier actions. */
export const MesaCard = React.memo<MesaCardProps>(({
  table, orders, currentTime, onClick, hasPendingPayment = false, mergedIntoMesaId = null, ...view
}) => {
  const operational = deriveTableOperationalState({
    table, orders, hasPendingPayment, mergedIntoMesaId, now: currentTime,
  });
  return <SharedTableCard
    {...view}
    id={`mesa-card-${table.id}`}
    table={table}
    orders={orders}
    operational={operational}
    total={getTableTotal(orders)}
    onClick={() => onClick(table.id)}
  />;
});
