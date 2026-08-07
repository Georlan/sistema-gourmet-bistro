/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import clsx from 'clsx';
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
  readOnly = false,
}: MesasViewProps) {
  const [internalFilter, setInternalFilter] = useState<'todos' | 'livres' | 'ocupadas' | 'prontas'>('todos');

  const currentFilter = externalFilter ?? internalFilter;

  const handleFilterSelect = (filter: 'todos' | 'livres' | 'ocupadas' | 'prontas') => {
    if (onFilterChange) {
      onFilterChange(filter);
    } else {
      setInternalFilter(filter);
    }
  };

  const filteredTables = (salonTables || []).filter((table) => {
    const tableOrders = orders.filter((o) => o.mesaId === table.id);
    if (currentFilter === 'livres') return tableOrders.length === 0;
    if (currentFilter === 'ocupadas') return tableOrders.length > 0;
    if (currentFilter === 'prontas') {
      return tableOrders
        .flatMap((o) => o.itens)
        .some((i) => (i.status as string) === 'pronto');
    }
    return true;
  });

  return (
    <div className="space-y-6 w-full text-white font-sans select-none">
      <div className="space-y-3">
        {/* Title + Filters Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[#27272A]">
          <div className="flex items-center gap-3">
            <h3 className="font-serif text-xl sm:text-2xl font-bold tracking-tight text-white shrink-0">
              Mesas
            </h3>
            <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-lg font-mono font-bold">
              Estrutura Física do Salão
            </span>
          </div>

          {/* Filter Buttons */}
          <div
            role="group"
            aria-label="Filtrar mesas por status"
            className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full sm:w-auto"
          >
            {(['todos', 'livres', 'ocupadas', 'prontas'] as const).map((filter) => {
              const count = {
                todos: (salonTables || []).length,
                livres: (salonTables || []).filter((t) => !orders.some((o) => o.mesaId === t.id)).length,
                ocupadas: (salonTables || []).filter((t) => orders.some((o) => o.mesaId === t.id)).length,
                prontas: (salonTables || []).filter((t) => {
                  const tOrders = orders.filter((o) => o.mesaId === t.id);
                  return tOrders.flatMap((o) => o.itens).some((i) => (i.status as string) === 'pronto');
                }).length,
              }[filter];

              const label = {
                todos: 'Todas',
                livres: 'Livres',
                ocupadas: 'Ocupadas',
                prontas: 'Prontas',
              }[filter];

              const isActive = currentFilter === filter;

              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => !readOnly && handleFilterSelect(filter)}
                  aria-pressed={isActive}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition-all text-center border ${
                    readOnly ? 'cursor-default' : 'cursor-pointer'
                  } ${
                    isActive
                      ? 'bg-[#280c12] text-white border-rose-950/80 shadow-md'
                      : 'bg-[#14161B] text-zinc-300 hover:bg-zinc-800 border-zinc-800'
                  }`}
                >
                  {label} <span className="opacity-75 text-[10px] font-normal ml-0.5">({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Real Table Grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 w-full p-1">
          {filteredTables.length === 0 ? (
            <div className="col-span-full py-10 text-center text-gray-500 text-sm italic">
              Nenhuma mesa encontrada neste status.
            </div>
          ) : (
            filteredTables.map((table) => {
              const tableOrders = orders.filter((o) => o.mesaId === table.id);
              const waiterDrafts = draftItemsMap[table.id] || [];
              const draftQtyCount = waiterDrafts.reduce((sum, item) => sum + (item.quantidade || 1), 0);

              const otherWaitersServing = Object.keys(activeDrafts[table.id] || {})
                .filter((gId) => gId !== activeWaiterId)
                .map((gId) => activeDrafts[table.id][gId].garcomNome);

              const tableComandas = orders.filter((o) => o.mesaId === table.id);
              const hasPendingPayment = pagamentosPendentes.some((pag) =>
                tableComandas.some((o) => o.id === pag.comanda_id)
              );

              const mergedSources = tableComandas
                .map((o) => o.mesaOrigemId)
                .filter((id): id is number => id !== null && id !== undefined && id !== table.id);

              const mergedIntoMesaId = orders.find((o) => o.mesaOrigemId === table.id)?.mesaId || null;

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
                    if (!readOnly && onTableClick) {
                      onTableClick(id);
                    }
                  }}
                  hasPendingPayment={hasPendingPayment}
                  mergedSources={mergedSources}
                  mergedIntoMesaId={mergedIntoMesaId}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
