/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Activity, CheckCircle2, Grid2X2, Utensils } from 'lucide-react';
import { Table, Order, DraftItem } from '../../types';
import { MesaCard } from '../MesaCard';
import { deriveTableOperationalState } from '../../domain/operationalState';

export interface MesasViewProps {
  salonTables: Table[];
  orders?: Order[];
  draftItemsMap?: Record<number, DraftItem[]>;
  activeDrafts?: Record<number, Record<string, { garcomNome: string }>>;
  pagamentosPendentes?: any[];
  activeWaiterId?: string;
  currentTime?: number;
  onTableClick?: (tableId: number) => void;
  tableFilter?: 'todos' | 'livres' | 'ocupadas' | 'prontas';
  onFilterChange?: (filter: 'todos' | 'livres' | 'ocupadas' | 'prontas') => void;
  showOperationalStatus?: boolean;
  readOnly?: boolean;
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
  tableFilter: externalFilter,
  onFilterChange,
  showOperationalStatus = true,
  readOnly = false,
}: MesasViewProps) {
  const [internalFilter, setInternalFilter] = useState<'todos' | 'livres' | 'ocupadas' | 'prontas'>('todos');
  const currentFilter = externalFilter ?? internalFilter;

  const tableRows = useMemo(() => (salonTables || []).map((table) => {
    const tableOrders = orders.filter((order) => order.mesaId === table.id);
    const operationalState = deriveTableOperationalState({
      table,
      orders: tableOrders,
      pendingPayments: pagamentosPendentes,
      mergedIntoMesaId: orders.find((order) => order.mesaOrigemId === table.id)?.mesaId || null,
      now: currentTime,
    });
    const isReady = showOperationalStatus && operationalState.production.hasReadyItems;
    return { table, tableOrders, operationalState, isReady };
  }), [orders, salonTables, pagamentosPendentes, currentTime, showOperationalStatus]);

  const counts = useMemo(() => ({
    todos: tableRows.length,
    livres: tableRows.filter(({ operationalState }) => operationalState.occupancy === 'FREE').length,
    ocupadas: tableRows.filter(({ operationalState }) => operationalState.occupancy === 'IN_SERVICE').length,
    prontas: tableRows.filter(({ isReady }) => isReady).length,
  }), [tableRows]);

  const filteredRows = useMemo(() => tableRows.filter(({ operationalState, isReady }) => {
    if (currentFilter === 'livres') return operationalState.occupancy === 'FREE';
    if (currentFilter === 'ocupadas') return operationalState.occupancy === 'IN_SERVICE';
    if (currentFilter === 'prontas') return isReady;
    return true;
  }), [currentFilter, tableRows]);

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
    <div className="w-full text-koma-foreground font-sans select-none space-y-4 sm:space-y-5">
      <section className="waiter-salon-stage relative overflow-hidden rounded-[24px] sm:rounded-[30px] border border-koma-border bg-koma-panel px-4 py-5 sm:px-7 sm:py-6 lg:px-9 lg:py-7">
        <div className="waiter-salon-stage__plane" aria-hidden="true" />
        <span className="waiter-salon-stage__word" aria-hidden="true">SALÃO</span>

        <div className="relative z-10 flex flex-col xl:flex-row xl:items-end xl:justify-between gap-5 xl:gap-8">
          <div className="max-w-2xl">
            <div className="flex items-end gap-3 sm:gap-4">
              <h2 className="font-serif text-[2rem] sm:text-4xl lg:text-5xl font-black tracking-[-0.055em] leading-none text-koma-foreground">
                Salão
              </h2>
              <span className="hidden sm:inline-block mb-1.5 h-1 w-14 bg-koma-accent -rotate-2" aria-hidden="true" />
            </div>
            <p className="mt-2.5 max-w-xl text-xs sm:text-sm text-koma-subtle leading-relaxed">
              As mesas mudam de aparência conforme o atendimento. Toque para abrir ou agir.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-koma-border bg-koma-border-subtle w-full xl:w-auto xl:min-w-[470px]">
            <div className="bg-koma-panel px-3 py-3 sm:px-4 sm:py-3.5">
              <div className="flex items-center gap-1.5 text-koma-muted">
                <Grid2X2 size={12} />
                <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider">Livres</span>
              </div>
              <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-koma-foreground">{counts.livres}</p>
            </div>
            <div className="bg-koma-panel px-3 py-3 sm:px-4 sm:py-3.5">
              <div className="flex items-center gap-1.5 text-koma-danger-text">
                <Utensils size={12} />
                <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider">Ocupadas</span>
              </div>
              <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-koma-foreground">{counts.ocupadas}</p>
            </div>
            <div className="bg-koma-panel px-3 py-3 sm:px-4 sm:py-3.5">
              <div className="flex items-center gap-1.5 text-koma-warning-text">
                <CheckCircle2 size={12} />
                <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider">Prontas</span>
              </div>
              <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-koma-foreground">{counts.prontas}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border-b border-koma-border-subtle pb-4">
        <div className="flex items-center gap-2 text-koma-subtle">
          <Activity size={14} className="text-koma-accent" />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]">Filtrar mesas</span>
        </div>

        <div role="group" aria-label="Filtrar mesas por status" className="flex w-full min-w-0 max-w-full gap-1.5 overflow-x-auto rounded-xl p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-4 lg:w-auto">
          {filters.map((filter) => {
            const isActive = currentFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => !readOnly && handleFilterSelect(filter.id)}
                aria-pressed={isActive}
                className={`shrink-0 whitespace-nowrap px-3 py-2.5 sm:px-2.5 sm:py-2.5 rounded-xl text-[10px] sm:text-xs font-bold transition-all text-center border ${
                  readOnly ? 'cursor-default' : 'cursor-pointer'
                } ${
                  isActive
                    ? 'bg-koma-accent text-white border-koma-accent shadow-sm'
                    : 'bg-koma-card text-koma-muted hover:text-koma-foreground hover:bg-koma-raised border-koma-border'
                }`}
              >
                {filter.label} <span className={`font-mono text-[9px] ${isActive ? 'text-white/80' : 'text-koma-muted'}`}>{filter.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 min-[380px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-3.5 w-full">
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
              draftCount={draftQtyCount}
              otherWaitersServing={otherWaitersServing}
              currentTime={tableOrders.length > 0 ? currentTime : 0}
              activeWaiterId={activeWaiterId}
              onClick={(id) => {
                if (!readOnly && onTableClick) onTableClick(id);
              }}
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
