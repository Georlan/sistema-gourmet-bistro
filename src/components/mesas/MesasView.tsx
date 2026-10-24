/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Table, Order, DraftItem } from '../../types';
import { MesaCard } from '../MesaCard';
import { KomaWaiterGlyph } from '../shared/KomaWaiterGlyphs';
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
  const requestedFilter = externalFilter ?? internalFilter;
  const currentFilter = !showOperationalStatus && requestedFilter === 'prontas' ? 'todos' : requestedFilter;
  const [query, setQuery] = useState('');

  const tableRows = useMemo(() =>
    rows ?? projectWaiterSalonTables(salonTables, orders, pagamentosPendentes, currentTime),
  [rows, orders, salonTables, pagamentosPendentes, currentTime]);

  const counts = useMemo(() => countWaiterSalonTables(tableRows, showOperationalStatus),
    [tableRows, showOperationalStatus]);

  const filteredRows = useMemo(() => tableRows.filter(({ table, operationalState }) => {
    if (!waiterTableMatchesQuery(table, query)) return false;
    if (currentFilter === 'livres') return operationalState.occupancy === 'FREE';
    if (currentFilter === 'ocupadas') return operationalState.occupancy === 'IN_SERVICE';
    if (currentFilter === 'prontas') return showOperationalStatus && operationalState.production.hasReadyItems;
    return true;
  }), [currentFilter, tableRows, showOperationalStatus, query]);

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

      <div className="kw-salon-tools">
        <div role="group" aria-label="Filtrar mesas por status" className="kw-filters">
          {filters.filter(filter => showOperationalStatus || filter.id !== 'prontas').map((filter) => <button key={filter.id} id={`waiter-filter-${filter.id}`} type="button"
            aria-pressed={currentFilter === filter.id} onClick={() => !readOnly && handleFilterSelect(filter.id)}>
            <span>{filter.label}</span><span className="kw-filter-count">{filter.count}</span>
          </button>)}
        </div>
        <label className="kw-search">
          <KomaWaiterGlyph name="salon-locator" size={18} />
          <input aria-label="Ir para mesa" placeholder="Número ou nome da mesa" value={query}
            onChange={(event) => setQuery(event.target.value)} readOnly={readOnly} />
          {query && <button type="button" aria-label="Limpar busca de mesa" onClick={() => setQuery('')}><X size={16} /></button>}
        </label>
      </div>
      {/* Responsive contract reference: grid-cols-2 min-[380px]:grid-cols-3 sm:grid-cols-4 */}
      <div className="kw-table-grid grid w-full grid-cols-2 min-[360px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 items-stretch gap-2">
        {filteredRows.length === 0 ? (
          <div className="col-span-full py-16 rounded-2xl border border-dashed border-koma-border text-center text-koma-muted text-sm">
            Nenhuma mesa encontrada.
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
