/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Activity, Search, X } from 'lucide-react';
import { Table, Order, DraftItem } from '../../types';
import { MesaCard } from '../MesaCard';
import { countWaiterSalonTables, projectWaiterSalonTables, type WaiterSalonRow } from '../../domain/waiterSalonProjection';

export interface MesasViewProps {
  salonTables: Table[];
  orders?: Order[];
  draftItemsMap?: Record<number, DraftItem[]>;
  activeDrafts?: Record<number, Record<string, { garcomNome: string }>>;
  pagamentosPendentes?: any[];
  activeWaiterId?: string;
  currentTime?: number;
  onTableClick?: (tableId: number, targetTab?: 'consumo' | 'lancamento') => void;
  onOpenOrderEntry?: (tableId: number) => void;
  onOpenConsumption?: (tableId: number) => void;
  tableFilter?: 'todos' | 'livres' | 'ocupadas' | 'prontas';
  onFilterChange?: (filter: 'todos' | 'livres' | 'ocupadas' | 'prontas') => void;
  showOperationalStatus?: boolean;
  readOnly?: boolean;
  rows?: readonly WaiterSalonRow[];
}

export function waiterTableMatchesQuery(table: Table, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  if (!normalized) return true;
  const numberQuery = normalized.replace(/^mesa\s*/i, '').trim();
  const customName = String(table.nome || '').toLocaleLowerCase('pt-BR');
  return String(table.id).includes(numberQuery)
    || customName.includes(normalized)
    || customName.includes(numberQuery);
}

export function MesasView({
  salonTables,
  orders = [],
  draftItemsMap = {},
  activeDrafts = {},
  pagamentosPendentes = [],
  activeWaiterId = '',
  currentTime = Date.now(),
  onTableClick,
  onOpenOrderEntry,
  onOpenConsumption,
  tableFilter: externalFilter,
  onFilterChange,
  showOperationalStatus = true,
  readOnly = false,
  rows,
}: MesasViewProps) {
  const [internalFilter, setInternalFilter] = useState<'todos' | 'livres' | 'ocupadas' | 'prontas'>('todos');
  const currentFilter = externalFilter ?? internalFilter;

  const tableRows = useMemo(() =>
    rows ?? projectWaiterSalonTables(salonTables, orders, pagamentosPendentes, currentTime),
  [rows, orders, salonTables, pagamentosPendentes, currentTime]);

  const counts = useMemo(() => countWaiterSalonTables(tableRows, showOperationalStatus),
    [tableRows, showOperationalStatus]);

  const filteredRows = useMemo(() => tableRows.filter(({ operationalState }) => {
    if (currentFilter === 'livres') return operationalState.occupancy === 'FREE';
    if (currentFilter === 'ocupadas') return operationalState.occupancy === 'IN_SERVICE';
    if (currentFilter === 'prontas') return showOperationalStatus && operationalState.production.hasReadyItems;
    return true;
  }), [currentFilter, tableRows, showOperationalStatus]);

  const handleFilterSelect = (filter: typeof currentFilter) => {
    if (onFilterChange) onFilterChange(filter);
    else setInternalFilter(filter);
  };

  const filters = [
    { id: 'todos' as const, label: 'Todas', count: counts.todos },
    { id: 'livres' as const, label: 'Livres', count: counts.livres },
    { id: 'ocupadas' as const, label: 'Ocupadas', count: counts.ocupadas },
    { id: 'prontas' as const, label: 'Prontas', count: counts.prontas },
  ];

  return (
    <div className="w-full text-koma-foreground font-sans select-none space-y-2">
      <h2 className="sr-only">Salão</h2>

      {/* Sticky status filter bar with integrated pill track */}
      <div className="sticky top-[49px] sm:top-[56px] z-20 -mx-3 sm:-mx-6 lg:-mx-10 px-3 sm:px-6 lg:px-10 py-2 sm:py-2.5 bg-koma-page/98 dark:bg-[#0a0d0e]/98 backdrop-blur-md border-b border-zinc-200/60 dark:border-white/[0.05]">
        <div role="group" aria-label="Filtrar mesas por status" className="flex w-full min-w-0 max-w-full items-center p-1 rounded-2xl bg-zinc-200/50 dark:bg-zinc-900/80 border border-zinc-300/40 dark:border-white/[0.06] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden gap-1">
          {filters.map((filter) => {
            const isActive = currentFilter === filter.id;
            return (
              <button
                key={filter.id}
                id={`waiter-filter-${filter.id}`}
                type="button"
                onClick={() => !readOnly && handleFilterSelect(filter.id)}
                aria-pressed={isActive}
                className={`inline-flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-semibold transition-all text-center border flex-1 ${
                  readOnly ? 'cursor-default' : 'cursor-pointer active:scale-[0.98]'
                } ${
                  isActive
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white border-zinc-200/80 dark:border-white/10 shadow-xs font-bold'
                    : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-white/40 dark:hover:bg-white/5'
                }`}
              >
                {filter.id === 'prontas' && filter.count > 0 ? (
                  <span className="relative flex h-2 w-2 mr-0.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                ) : (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      filter.id === 'livres'
                        ? 'bg-emerald-500'
                        : filter.id === 'ocupadas'
                        ? 'bg-amber-500'
                        : filter.id === 'prontas'
                        ? 'bg-emerald-400'
                        : 'bg-zinc-400'
                    }`}
                    aria-hidden="true"
                  />
                )}
                {filter.label}{' '}
                <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md ${isActive ? 'bg-zinc-100 dark:bg-white/10 text-zinc-900 dark:text-white font-black' : 'text-zinc-500 dark:text-zinc-400 font-semibold'}`}>
                  {filter.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Responsive contract reference: grid-cols-2 min-[380px]:grid-cols-3 sm:grid-cols-4 */}
      <div className="grid w-full auto-rows-[208px] grid-cols-1 min-[340px]:grid-cols-2 sm:auto-rows-[184px] sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 items-stretch gap-3 pt-1">
        {filteredRows.length === 0 ? (
          <div className="col-span-full py-16 rounded-2xl border border-dashed border-koma-border text-center text-koma-muted text-sm">
            Nenhuma mesa encontrada neste status.
          </div>
        ) : filteredRows.map(({ table, tableOrders, operationalState }) => {
          const waiterDrafts = draftItemsMap[table.id] || [];
          const draftQtyCount = waiterDrafts.reduce((sum, item) => sum + (item.quantidade || 1), 0);
          const otherWaitersServing = Object.keys(activeDrafts[table.id] || {})
            .filter((waiterId) => waiterId !== activeWaiterId)
            .map((waiterId) => activeDrafts[table.id][waiterId].garcomNome);
          const hasPendingPayment = operationalState.hasPendingConfirmation;
          const mergedSources = tableOrders
            .map((order) => order.mesaOrigemId)
            .filter((id): id is number => id !== null && id !== undefined && id !== table.id);
          const mergedIntoMesaId = operationalState.mergedIntoMesaId;

          return (
            <MesaCard
              key={table.id}
              table={table}
              orders={tableOrders}
              operational={operationalState}
              draftCount={draftQtyCount}
              otherWaitersServing={otherWaitersServing}
              currentTime={tableOrders.length > 0 ? currentTime : 0}
              activeWaiterId={activeWaiterId}
              onClick={(id, tab) => {
                if (readOnly) return;
                if (tab === 'lancamento' && onOpenOrderEntry) onOpenOrderEntry(id);
                else if (tab === 'consumo' && onOpenConsumption) onOpenConsumption(id);
                else if (onTableClick) onTableClick(id, tab);
              }}
              onOpenOrderEntry={!readOnly ? onOpenOrderEntry : undefined}
              onOpenConsumption={!readOnly ? onOpenConsumption : undefined}
              hasPendingPayment={hasPendingPayment}
              mergedSources={mergedSources}
              mergedIntoMesaId={mergedIntoMesaId}
              showOperationalStatus={showOperationalStatus}
            />
          );
        })}
      </div>
    </div>
  );
}
