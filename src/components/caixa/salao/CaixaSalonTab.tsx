import { AlertTriangle, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { KomaWaiterGlyph } from '../../shared/KomaWaiterGlyphs';
import { CashierSalonCard } from './CashierSalonCard';
import type { SalonActions, SalonCard, SalonStatusFilter } from './cashierSalonContracts';
export type { SalonStatusFilter } from './cashierSalonContracts';

export interface CaixaSalonTabProps {
  readonly cards: readonly SalonCard[];
  readonly visibleCards: readonly SalonCard[];
  readonly counts: Readonly<Record<SalonStatusFilter, number>>;
  readonly filter: SalonStatusFilter;
  readonly onFilterChange: (filter: SalonStatusFilter) => void;
  readonly search?: string;
  readonly onSearchChange?: (query: string) => void;
  readonly fetchError?: string | null;
  readonly actions: SalonActions;
}

const filters: { id: SalonStatusFilter; label: string; description: string }[] = [
  { id: 'all', label: 'Todas', description: 'Todas as mesas' },
  { id: 'free', label: 'Livres', description: 'Mesas livres' },
  { id: 'occupied', label: 'Atendendo', description: 'Mesas em atendimento' },
  { id: 'payment', label: 'Receber', description: 'Mesas para receber' },
];

/** Operação direta: filtro, busca e mesas. A aba "Salão" já identifica a tela. */
export function CaixaSalonTab({
  cards, visibleCards, counts, filter, onFilterChange,
  search = '', onSearchChange = () => {}, fetchError, actions,
}: CaixaSalonTabProps) {
  return (
    <section className="koma-salon orders-workspace" aria-labelledby="tables-heading">
      <h2 id="tables-heading" className="sr-only">Salão</h2>

      <div className="koma-salon__toolbar">
        <div className="koma-salon__filters" role="group" aria-label="Filtrar mesas por situação">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={item.description}
              aria-pressed={filter === item.id}
              onClick={() => onFilterChange(item.id)}
              className={clsx('koma-salon__filter', filter === item.id && 'is-active')}
            >
              <span>{item.label}</span>
              <strong>{counts[item.id]}</strong>
            </button>
          ))}
        </div>

        <label className="koma-salon__search">
          <KomaWaiterGlyph name="salon-locator" size={18} aria-hidden="true" />
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
              <X size={17} aria-hidden="true" />
            </button>
          )}
        </label>
      </div>

      <div className="koma-salon__results" aria-live="polite">
        {cards.length === 0 ? (
          <div className="koma-salon__empty">
            {fetchError ? (
              <>
                <AlertTriangle size={24} aria-hidden="true" />
                <strong>Não foi possível carregar as mesas</strong>
                <p>{fetchError}</p>
              </>
            ) : (
              <>
                <strong>Nenhuma mesa cadastrada</strong>
                <p>Cadastre mesas para começar o atendimento no Salão.</p>
              </>
            )}
          </div>
        ) : visibleCards.length === 0 ? (
          <div className="koma-salon__empty">
            <Search size={24} aria-hidden="true" />
            <strong>{search.trim() ? 'Nenhuma mesa encontrada' : 'Nenhuma mesa nesta situação'}</strong>
            <p>{search.trim() ? 'Experimente outro número ou nome.' : 'Escolha outro filtro para ver as mesas.'}</p>
            {search.trim() && <button type="button" className="koma-salon__clear" onClick={() => onSearchChange('')}>Limpar busca</button>}
          </div>
        ) : (
          <div className="koma-salon__grid">
            {visibleCards.map((card) => <CashierSalonCard key={card.table.id} card={card} actions={actions} />)}
          </div>
        )}
      </div>
    </section>
  );
}
