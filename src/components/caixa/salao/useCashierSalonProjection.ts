import { useMemo, useState } from 'react';
import {
  formatCashierOldestAge as formatOldestAge,
} from '../../../domain/cashierOrderProjection';
import { projectCashierSalonTables } from '../../../domain/cashierSalonProjection';
import type { Order, Table } from '../../../types';

type BoundaryProps = {
  salonTables: Table[];
  orders: Order[];
  pagamentosPendentes: any[];
  nowTimestamp: number;
};

/** Owns the salon filter and derives views from the canonical table projection. */
export function useCashierSalonProjection({
  salonTables,
  orders,
  pagamentosPendentes,
  nowTimestamp,
}: BoundaryProps) {
  const [tableStatusFilter, setTableStatusFilter] = useState<'all' | 'free' | 'occupied' | 'payment'>('all');
  const [tableSearch, setTableSearch] = useState('');

  const salonTableCards = useMemo(
    () => projectCashierSalonTables(salonTables, orders, pagamentosPendentes, nowTimestamp),
    [orders, pagamentosPendentes, salonTables, nowTimestamp],
  );

  const tableStatusCounts = useMemo(
    () => ({
      all: salonTableCards.length,
      free: salonTableCards.filter((card) => !card.isOccupied && !card.isMerged).length,
      occupied: salonTableCards.filter((card) => card.isOccupied && !card.hasPendingPayment).length,
      payment: salonTableCards.filter((card) => card.hasPendingPayment).length,
    }),
    [salonTableCards],
  );

  const salonInsights = useMemo(() => {
    const activeCards = salonTableCards.filter((card) => card.isOccupied && !card.isMerged);
    const openValue = activeCards.reduce((total, card) => total + card.total, 0);
    const timestamps = activeCards.flatMap((card) =>
      card.tableOrders.map(
        (order) =>
          (order as any).aberta_em ||
          (order as any).data_abertura ||
          (order as any).aberto_em ||
          order.created_at ||
          order.timestamp ||
          (order as any).criadoEm,
      ),
    );
    return {
      occupancy:
        salonTableCards.length > 0 ? Math.round((activeCards.length / salonTableCards.length) * 100) : 0,
      openValue,
      oldestService: formatOldestAge(timestamps, nowTimestamp),
    };
  }, [salonTableCards, nowTimestamp]);

  const pdvTableOptions = useMemo(
    () =>
      salonTableCards
        .map((card) => {
          const isOccupied = card.isOccupied || card.hasPendingPayment;

          return {
            ...card,
            isOccupied,
            label: card.table.nome?.trim() || `Mesa ${card.table.id}`,
          };
        })
        .sort((left, right) => left.table.id - right.table.id),
    [salonTableCards],
  );

  const visibleSalonTableCards = useMemo(() => {
    const query = tableSearch.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    return salonTableCards.filter((card) => {
      if (tableStatusFilter === 'free' && (card.isOccupied || card.isMerged)) return false;
      if (tableStatusFilter === 'occupied' && (!card.isOccupied || card.hasPendingPayment)) return false;
      if (tableStatusFilter === 'payment' && !card.hasPendingPayment) return false;
      if (!query) return true;
      const haystack = String(card.table.id) + ' ' + String(card.table.id).padStart(2, '0') + ' mesa ' + (card.table.nome || '');
      return haystack.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').includes(query);
    });
  }, [salonTableCards, tableStatusFilter, tableSearch]);
  return {
    tableStatusFilter,
    setTableStatusFilter,
    tableSearch,
    setTableSearch,
    salonTableCards,
    tableStatusCounts,
    salonInsights,
    pdvTableOptions,
    visibleSalonTableCards,
  };
}
