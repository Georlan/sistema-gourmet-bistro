/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Activity, CheckCircle2, Grid2X2, Radio, Utensils } from 'lucide-react';
import { Table, Order, DraftItem } from '../../types';
import { MesaCard } from '../MesaCard';

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
    const isReady = showOperationalStatus && tableOrders
      .flatMap((order) => order.itens || [])
      .some((item) => (item.status as string) === 'pronto');
    return { table, tableOrders, isReady };
  }), [orders, salonTables, showOperationalStatus]);

  const counts = useMemo(() => ({
    todos: tableRows.length,
    livres: tableRows.filter(({ tableOrders }) => tableOrders.length === 0).length,
    ocupadas: tableRows.filter(({ tableOrders }) => tableOrders.length > 0).length,
    prontas: tableRows.filter(({ isReady }) => isReady).length,
  }), [tableRows]);

  const filteredRows = useMemo(() => tableRows.filter(({ tableOrders, isReady }) => {
    if (currentFilter === 'livres') return tableOrders.length === 0;
    if (currentFilter === 'ocupadas') return tableOrders.length > 0;
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
            <div className="flex items-center gap-2 text-[9px] sm:text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-[#00d9a6]">
              <Radio size={13} className="animate-pulse" />
              Operação ao vivo
            </div>
            <div className="mt-2 flex items-end gap-3 sm:gap-4">
              <h2 className="font-serif text-[2rem] sm:text-4xl lg:text-5xl font-black tracking-[-0.055em] leading-none text-koma-foreground">
                Mapa de mesas
              </h2>
              <span className="hidden sm:inline-block mb-1.5 h-1 w-14 bg-[#00b894] -rotate-2" aria-hidden="true" />
            </div>
            <p className="mt-2.5 max-w-xl text-xs sm:text-sm text-koma-subtle leading-relaxed">
              Veja o salão inteiro, identifique prioridades e abra uma mesa com um toque.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-koma-border bg-white/[0.08] w-full xl:w-auto xl:min-w-[470px]">
            <div className="bg-koma-panel px-3 py-3 sm:px-4 sm:py-3.5">
              <div className="flex items-center gap-1.5 text-koma-muted">
                <Grid2X2 size={12} />
                <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider">Salão</span>
              </div>
              <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-koma-foreground">{counts.todos}</p>
            </div>
            <div className="bg-koma-panel px-3 py-3 sm:px-4 sm:py-3.5">
              <div className="flex items-center gap-1.5 text-rose-400">
                <Utensils size={12} />
                <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider">Ocupadas</span>
              </div>
              <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-koma-foreground">{counts.ocupadas}</p>
            </div>
            <div className="bg-koma-panel px-3 py-3 sm:px-4 sm:py-3.5">
              <div className="flex items-center gap-1.5 text-amber-400">
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
          <Activity size={14} className="text-[#00b894]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]">Estrutura física do salão</span>
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
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-koma-card text-koma-muted hover:text-koma-foreground hover:bg-koma-raised border-koma-border'
                }`}
              >
                {filter.label} <span className={`font-mono text-[9px] ${isActive ? 'text-emerald-100' : 'text-koma-muted'}`}>{filter.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-3.5 w-full">
        {filteredRows.length === 0 ? (
          <div className="col-span-full py-16 rounded-2xl border border-dashed border-koma-border text-center text-koma-muted text-sm">
            Nenhuma mesa encontrada neste status.
          </div>
        ) : filteredRows.map(({ table, tableOrders }) => {
          const waiterDrafts = draftItemsMap[table.id] || [];
          const draftQtyCount = waiterDrafts.reduce((sum, item) => sum + (item.quantidade || 1), 0);
          const otherWaitersServing = Object.keys(activeDrafts[table.id] || {})
            .filter((waiterId) => waiterId !== activeWaiterId)
            .map((waiterId) => activeDrafts[table.id][waiterId].garcomNome);
          const hasPendingPayment = pagamentosPendentes.some((payment) =>
            tableOrders.some((order) => order.id === payment.comanda_id)
          );
          const mergedSources = tableOrders
            .map((order) => order.mesaOrigemId)
            .filter((id): id is number => id !== null && id !== undefined && id !== table.id);
          const mergedIntoMesaId = orders.find((order) => order.mesaOrigemId === table.id)?.mesaId || null;

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
