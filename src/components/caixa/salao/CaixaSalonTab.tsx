import React from 'react';
import { AlertTriangle, ClipboardList, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { CashierSalonCard } from './CashierSalonCard';
import { formatCompactCurrency } from '../cashierPresentation';
import type { SalonActions, SalonCard, SalonStatusFilter } from './cashierSalonContracts';
export type { SalonStatusFilter } from './cashierSalonContracts';

export interface CaixaSalonTabProps {
  readonly cards: readonly SalonCard[];
  readonly visibleCards: readonly SalonCard[];
  readonly counts: Readonly<Record<SalonStatusFilter, number>>;
  readonly insights: { readonly occupancy: number; readonly openValue: number; readonly oldestService: string };
  readonly filter: SalonStatusFilter;
  readonly onFilterChange: (filter: SalonStatusFilter) => void;
  readonly search?: string;
  readonly onSearchChange?: (query: string) => void;
  readonly fetchError?: string | null;
  readonly actions: SalonActions;
}

const filters: { id: SalonStatusFilter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'free', label: 'Livres' },
  { id: 'occupied', label: 'Em atendimento' },
  { id: 'payment', label: 'Para receber' },
];

/** Visual Salão of the Caixa. Canonical status/amounts and table actions remain external. */
export function CaixaSalonTab({
  cards, visibleCards, counts, insights, filter, onFilterChange,
  search = '', onSearchChange = () => {}, fetchError, actions,
}: CaixaSalonTabProps) {
  return (
    <section className="koma-salon orders-workspace" aria-labelledby="tables-heading">
      <div className="koma-salon__heading">
        <div>
          <span className="koma-salon__eyebrow">ATENDIMENTO NO LOCAL</span>
          <h2 id="tables-heading">Salão</h2>
          <p>Escolha uma mesa para iniciar ou acompanhar o pedido.</p>
        </div>
        <span className="koma-salon__occupancy">{insights.occupancy}% <span>ocupado</span></span>
      </div>

      <div className="koma-salon__summary" aria-label="Resumo do salão">
        <div><span>Em atendimento</span><strong>{counts.occupied + counts.payment}</strong></div>
        <div><span>Consumo registrado</span><strong>{formatCompactCurrency(insights.openValue)}</strong></div>
        <div><span>Maior atendimento</span><strong>{insights.oldestService}</strong></div>
      </div>

      <div className="koma-salon__workspace">
        <div className="koma-salon__toolbar">
          <div className="koma-salon__filters" role="group" aria-label="Filtrar mesas por situação">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={filter === item.id}
                onClick={() => onFilterChange(item.id)}
                className={clsx('koma-salon__filter', filter === item.id && 'is-active')}
              >
                <span>{item.label}</span>
                <strong> {counts[item.id]}</strong>
              </button>
            ))}
          </div>

          <div className="koma-salon__search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              autoComplete="off"
              aria-label="Buscar mesa no salão"
              placeholder="Número ou nome da mesa"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
            {search && (
              <button type="button" onClick={() => onSearchChange('')} aria-label="Limpar busca de mesas">
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="koma-salon__results" aria-live="polite">
          {cards.length === 0 ? (
            <div className="koma-salon__empty">
              {fetchError ? (
                <>
                  <AlertTriangle size={25} aria-hidden="true" />
                  <strong>Não foi possível carregar o salão</strong>
                  <p>{fetchError}</p>
                </>
              ) : (
                <>
                  <ClipboardList size={25} aria-hidden="true" />
                  <strong>Nenhuma mesa cadastrada</strong>
                  <p>Configure as mesas para começar a atender no salão.</p>
                </>
              )}
            </div>
          ) : visibleCards.length === 0 ? (
            <div className="koma-salon__empty">
              <Search size={25} aria-hidden="true" />
              <strong>{search.trim() ? 'Nenhuma mesa encontrada' : 'Nenhuma mesa neste filtro.'}</strong>
              <p>{search.trim() ? 'Tente outro número ou nome.' : 'Escolha outra situação para ver as mesas.'}</p>
              {search.trim() && <button type="button" className="koma-salon__clear" onClick={() => onSearchChange('')}>Limpar busca</button>}
            </div>
          ) : (
            <div className="cashier-salon-grid koma-salon__grid">
              {visibleCards.map((card) => <CashierSalonCard key={card.table.id} card={card} actions={actions} />)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
