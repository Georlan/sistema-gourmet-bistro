import clsx from 'clsx';
import { Search } from 'lucide-react';
import React, { useId, useMemo, useState } from 'react';
import type { CashierSidebarProps } from './cashierNavigationContracts';
import type { CashierNavigationGroup } from './cashierNavigation';

type Props = Pick<CashierSidebarProps, 'hasOnlineMenu' | 'handleSidebarNavigation'> & {
  groups: readonly CashierNavigationGroup[];
  closeMobile?: boolean;
};

type SearchEntry = {
  id: string;
  label: string;
  context: string;
  searchText: string;
};

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

export function CashierSidebarSearch({
  groups,
  hasOnlineMenu,
  handleSidebarNavigation,
  closeMobile = false,
}: Props) {
  const [query, setQuery] = useState('');
  const resultsId = useId();

  const entries = useMemo<SearchEntry[]>(() => {
    return groups.flatMap((group) =>
      group.items.flatMap((item) => {
        if (item.capability === 'online-menu' && !hasOnlineMenu) return [];

        const parent: SearchEntry = {
          id: item.id,
          label: item.label,
          context: group.category,
          searchText: normalizeSearch(`${item.label} ${group.category}`),
        };
        const children = (item.children ?? []).map<SearchEntry>((child) => ({
          id: child.id,
          label: child.label,
          context: `${group.category} · ${item.label}`,
          searchText: normalizeSearch(`${child.label} ${item.label} ${group.category}`),
        }));

        return [parent, ...children];
      }),
    );
  }, [groups, hasOnlineMenu]);

  const normalizedQuery = normalizeSearch(query);
  const results = normalizedQuery
    ? entries.filter((entry) => entry.searchText.includes(normalizedQuery)).slice(0, 7)
    : [];

  const openResult = (id: string) => {
    handleSidebarNavigation(id, closeMobile);
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
            if (event.key === 'Enter' && results[0]) {
              event.preventDefault();
              openResult(results[0].id);
            }
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder="Pesquisar funções..."
          aria-label="Pesquisar funções do KÔMA"
          aria-controls={normalizedQuery ? resultsId : undefined}
          className="h-9 w-full rounded-xl border border-koma-border bg-koma-raised/40 pl-9 pr-3 text-[11px] font-semibold text-koma-foreground outline-none transition placeholder:text-koma-muted focus:border-emerald-500/50 focus:bg-koma-raised focus:ring-2 focus:ring-emerald-500/10"
        />
      </div>

      {normalizedQuery && (
        <div
          id={resultsId}
          role="listbox"
          aria-label="Resultados da pesquisa de funções"
          className="mt-1.5 overflow-hidden rounded-xl border border-koma-border bg-koma-panel shadow-xl"
        >
          {results.length > 0 ? (
            results.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={index === 0}
                onClick={() => openResult(entry.id)}
                className={clsx(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-koma-raised',
                  index > 0 && 'border-t border-koma-border/70',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-bold text-koma-foreground">{entry.label}</span>
                  <span className="mt-0.5 block truncate text-[9px] font-medium text-koma-muted">{entry.context}</span>
                </span>
                {index === 0 && (
                  <span className="shrink-0 rounded-md border border-koma-border bg-koma-raised px-1.5 py-0.5 text-[8px] font-bold text-koma-muted">
                    Enter
                  </span>
                )}
              </button>
            ))
          ) : (
            <p className="px-3 py-2.5 text-[10px] font-medium text-koma-muted">Nenhuma função encontrada.</p>
          )}
        </div>
      )}
    </div>
  );
}
