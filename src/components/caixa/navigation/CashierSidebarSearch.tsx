import clsx from 'clsx';
import { Search } from 'lucide-react';
import React, { useEffect, useId, useMemo, useState } from 'react';
import type { CashierSidebarProps } from './cashierNavigationContracts';
import type { CashierNavigationGroup } from './cashierNavigation';
import {
  buildCashierFunctionSearchEntries,
  searchCashierFunctions,
  type CashierFunctionSearchEntry,
} from './cashierFunctionSearch';

type Props = Pick<CashierSidebarProps, 'hasOnlineMenu' | 'handleSidebarNavigation'> & {
  groups: readonly CashierNavigationGroup[];
  closeMobile?: boolean;
};

export function CashierSidebarSearch({
  groups,
  hasOnlineMenu,
  handleSidebarNavigation,
  closeMobile = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const resultsId = useId();

  const entries = useMemo(
    () => buildCashierFunctionSearchEntries(groups, hasOnlineMenu),
    [groups, hasOnlineMenu],
  );
  const results = useMemo(() => searchCashierFunctions(entries, query), [entries, query]);
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const openResult = (entry: CashierFunctionSearchEntry) => {
    handleSidebarNavigation(entry.navigationId, closeMobile);
    setQuery('');
  };

  return (
    <div className="group-data-[collapsible=icon]:hidden">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && results.length > 0) {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % results.length);
              return;
            }
            if (event.key === 'ArrowUp' && results.length > 0) {
              event.preventDefault();
              setActiveIndex((current) => (current - 1 + results.length) % results.length);
              return;
            }
            if (event.key === 'Enter' && results[activeIndex]) {
              event.preventDefault();
              openResult(results[activeIndex]);
              return;
            }
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder="Pesquisar funções..."
          aria-label="Pesquisar funções do KÔMA"
          aria-controls={hasQuery ? resultsId : undefined}
          aria-activedescendant={hasQuery && results[activeIndex] ? `${resultsId}-${results[activeIndex].id}` : undefined}
          className="h-9 w-full rounded-xl border border-koma-border bg-koma-raised/40 pl-9 pr-3 text-[11px] font-semibold text-koma-foreground outline-none transition placeholder:text-koma-muted focus:border-emerald-500/50 focus:bg-koma-raised focus:ring-2 focus:ring-emerald-500/10"
        />
      </div>

      {hasQuery && (
        <div
          id={resultsId}
          role="listbox"
          aria-label="Resultados da pesquisa de funções"
          className="mt-1.5 overflow-hidden rounded-xl border border-koma-border bg-koma-panel shadow-xl"
        >
          {results.length > 0 ? (
            results.map((entry, index) => {
              const active = index === activeIndex;
              return (
                <button
                  id={`${resultsId}-${entry.id}`}
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => openResult(entry)}
                  className={clsx(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors',
                    active ? 'bg-koma-raised' : 'hover:bg-koma-raised',
                    index > 0 && 'border-t border-koma-border/70',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-bold text-koma-foreground">{entry.label}</span>
                    <span className="mt-0.5 block truncate text-[9px] font-medium text-koma-muted">{entry.context}</span>
                  </span>
                  {active && (
                    <span className="shrink-0 rounded-md border border-koma-border bg-koma-panel px-1.5 py-0.5 text-[8px] font-bold text-koma-muted">
                      Enter
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <p className="px-3 py-2.5 text-[10px] font-medium text-koma-muted">Nenhuma função encontrada.</p>
          )}
        </div>
      )}
    </div>
  );
}
