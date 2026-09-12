/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Activity, CheckCircle2, Grid2X2, Search, Utensils, X } from 'lucide-react';
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
  onTableClick?: (tableId: number) => void;
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

export function openWaiterQuickOrder(tableId: number, onTableClick?: (tableId: number) => void) {
  if (!onTableClick) return;
  onTableClick(tableId);
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const openOrderTab = () => document.getElementById('tab-lancamento-btn')?.click();
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(openOrderTab));
  } else {
    window.setTimeout(openOrderTab, 0);
  }
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
  rows,
}: MesasViewProps) {
  const [internalFilter, setInternalFilter] = useState<'todos' | 'livres' | 'ocupadas' | 'prontas'>('todos');
  const [searchOpen, setSearchOpen] = useState(false);
  const [tableQuery, setTableQuery] = useState('');
  const currentFilter = externalFilter ?? internalFilter;

  const tableRows = useMemo(() =>
    rows ?? projectWaiterSalonTables(salonTables, orders, pagamentosPendentes, currentTime),
  [rows, orders, salonTables, pagamentosPendentes, currentTime]);

  const counts = useMemo(() => countWaiterSalonTables(tableRows, showOperationalStatus),
    [tableRows, showOperationalStatus]);

  const filteredRows = useMemo(() => tableRows.filter(({ table, operationalState }) => {
    if (!waiterTableMatchesQuery(table, tableQuery)) return false;
    if (currentFilter === 'livres') return operationalState.occupancy === 'FREE';
    if (currentFilter === 'ocupadas') return operationalState.occupancy === 'IN_SERVICE';
    if (currentFilter === 'prontas') return showOperationalStatus && operationalState.production.hasReadyItems;
    return true;
  }), [currentFilter, tableRows, showOperationalStatus, tableQuery]);

  const handleFilterSelect = (filter: typeof currentFilter) => {
    if (onFilterChange) onFilterChange(filter);
    else setInternalFilter(filter);
  };

  const openSearch = () => {
    setSearchOpen(true);
    if (currentFilter !== 'todos') handleFilterSelect('todos');
  };

  const closeSearch = () => {
    setTableQuery('');
    setSearchOpen(false);
  };

  const openSearchResult = () => {
    if (readOnly || !onTableClick || !tableQuery.trim()) return;
    const normalized = tableQuery.trim().toLocaleLowerCase('pt-BR').replace(/^mesa\s*/i, '').trim();
    const exact = filteredRows.find(({ table }) => String(table.id) === normalized);
    const target = exact || (filteredRows.length === 1 ? filteredRows[0] : undefined);
    if (target) onTableClick(target.table.id);
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
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-koma-subtle">
          <Activity size={14} className="text-koma-accent" />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]">Filtrar mesas</span>

          {!readOnly && !searchOpen && (
            <button
              id="waiter-table-search-toggle"
              type="button"
              onClick={openSearch}
              className="ml-1 inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-card px-2.5 text-[10px] font-bold text-koma-muted transition-colors hover:bg-koma-raised hover:text-koma-foreground"
              aria-label="Ir para uma mesa"
            >
              <Search size={13} /> Ir para mesa
            </button>
          )}

          {!readOnly && searchOpen && (
            <div className="relative ml-1 min-w-[180px] flex-1 sm:flex-initial">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-koma-muted" />
              <input
                id="waiter-table-search-input"
                autoFocus
                inputMode="numeric"
                value={tableQuery}
                onChange={(event) => setTableQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') openSearchResult();
                  if (event.key === 'Escape') closeSearch();
                }}
                placeholder="Mesa 27..."
                aria-label="Buscar mesa por número ou nome"
                className="h-8 w-full rounded-xl border border-koma-border bg-koma-input pl-8 pr-8 text-xs text-koma-foreground outline-none focus:border-emerald-500 sm:w-48"
              />
              <button
                type="button"
                onClick={closeSearch}
                className="absolute right-1.5 top-1.5 rounded-lg p-1 text-koma-muted hover:text-koma-foreground"
                aria-label="Fechar busca de mesa"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>

        <div role="group" aria-label="Filtrar mesas por status" className="flex w-full min-w-0 max-w-full gap-1.5 overflow-x-auto rounded-xl p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-4 lg:w-auto">
          {filters.map((filter) => {
            const isActive = currentFilter === filter.id;
            return (
              <button
                key={filter.id}
                id={`waiter-filter-${filter.id}`}
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
            {tableQuery.trim() ? 'Nenhuma mesa encontrada para esta busca.' : 'Nenhuma mesa encontrada neste status.'}
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
              onClick={(id) => {
                if (!readOnly && onTableClick) onTableClick(id);
              }}
              onQuickOrder={!readOnly && onTableClick
                ? (id) => openWaiterQuickOrder(id, onTableClick)
                : undefined}
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
