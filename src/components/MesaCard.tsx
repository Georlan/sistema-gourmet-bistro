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

  return (
    <div
      id={`mesa-card-${table.id}`}
      role="region"
      aria-label={accessibleLabel}
      data-waiter-action={actionLabel}
      onClick={() => onClick(table.id)}
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
        <span className="mt-auto inline-flex w-full min-w-0 max-w-full items-center justify-center whitespace-normal rounded-lg border border-current/20 bg-black/5 px-2 py-1 text-center text-[9px] font-bold uppercase leading-tight tracking-wide dark:bg-white/5">
          {actionLabel}
        </span>
      </SharedTableCard>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClick(table.id);
        }}
        aria-label={`${actionLabel} na ${tableLabel}`}
        title={`${actionLabel} · ${tableLabel}`}
        className="absolute inset-0 z-10 h-full w-full rounded-2xl bg-transparent transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
      />
    </div>
  );
});
