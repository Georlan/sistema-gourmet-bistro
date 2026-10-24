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
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handlePrimaryClick();
        }
      }}
      className={`kw-table-target relative h-full w-full min-w-0 ${getTableTotal(orders) >= 100000 ? 'min-[360px]:col-span-2' : ''}`}
    >
      <SharedTableCard
        {...view}
        table={table}
        orders={orders}
        operational={operational}
        total={getTableTotal(orders)}
        identityLabel="Pedido"
        waiterOverview
        fillHeight
        showItemCount={false}
      >
        <div className="kw-table__footer mt-auto w-full min-w-0 max-w-full">
          {isFree ? (
            <span
              aria-label={`${actionLabel} na ${tableLabel}`}
              className="kw-table__action "
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
              className="kw-table__action kw-table__action--launch"
            >
              Lançar
            </button>
          ) : (
            <span
              aria-label={`${actionLabel} na ${tableLabel}`}
              className="kw-table__action "
            >
              {isMerged ? 'Ver mesa' : actionLabel}
            </span>
          )}
        </div>
      </SharedTableCard>
    </div>
  );
});
