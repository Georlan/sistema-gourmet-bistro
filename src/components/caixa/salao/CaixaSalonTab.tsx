import React from 'react';
import { CashierSalonCard } from './CashierSalonCard';
import clsx from 'clsx';
import { AlertTriangle, ClipboardList } from 'lucide-react';
import { OperationalBanner } from '../../shared/OperationalBanner';
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
  readonly fetchError?: string | null;
  readonly actions: SalonActions;
}

/** Salon presentation consumes the canonical projection without owning session or checkout state. */
export function CaixaSalonTab({
  cards: salonTableCards, visibleCards: visibleSalonTableCards, counts: tableStatusCounts,
  insights: salonInsights, filter: tableStatusFilter, onFilterChange: setTableStatusFilter,
  fetchError, actions,
}: CaixaSalonTabProps) {
  return (
    <div className={"orders-workspace flex h-full min-h-0 flex-col gap-3"}>
      <OperationalBanner
        id="tables-heading"
        eyebrow="SALÃO"
        title="Mesas"
        accent="por situação"
        description="A cor e o texto de cada mesa mostram o que precisa acontecer agora."
        metrics={[
          { label: 'ocupação', value: `${salonInsights.occupancy}%` },
          { label: 'consumo em aberto', value: formatCompactCurrency(salonInsights.openValue) },
          { label: 'maior atendimento', value: salonInsights.oldestService },
        ]}
      />
      <section className={"flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-koma-border bg-koma-panel"}>
        <div className={"flex flex-col gap-2 border-b border-koma-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"}>
          <div className={"flex w-full min-w-0 max-w-full gap-1 overflow-x-auto overscroll-x-contain rounded-xl bg-koma-page p-1.5 pr-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"}>
            {[
              { id: 'all' as const, label: 'Todas', count: tableStatusCounts.all, dot: 'bg-zinc-500' },
              { id: 'free' as const, label: 'Livres', count: tableStatusCounts.free, dot: 'bg-[#45b995]' },
              { id: 'occupied' as const, label: 'Em atendimento', count: tableStatusCounts.occupied, dot: 'bg-koma-danger-text' },
              { id: 'payment' as const, label: 'Para receber', count: tableStatusCounts.payment, dot: 'bg-amber-500' },
            ].map(filter => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={tableStatusFilter === filter.id}
                onClick={() => setTableStatusFilter(filter.id)}
                className={clsx(
                  'shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-bold transition-colors',
                  tableStatusFilter === filter.id
                    ? filter.id === 'occupied'
                      ? 'bg-koma-danger-bg text-koma-danger-text'
                      : filter.id === 'payment'
                        ? 'bg-amber-100 text-amber-900 dark:bg-[#46212a] dark:text-[#efb2bc]'
                        : filter.id === 'free'
                          ? 'bg-emerald-100 text-emerald-900 dark:bg-[#123c31] dark:text-[#6ee7b7]'
                          : 'bg-koma-raised text-koma-foreground border border-koma-border'
                    : 'text-koma-muted hover:bg-black/5 dark:hover:bg-white/[0.04] hover:text-koma-secondary'
                )}
              >
                <span className={clsx('mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle', filter.dot)} aria-hidden="true" />
                {filter.label} <span className={"ml-1 font-mono opacity-70"}>{filter.count}</span>
              </button>
            ))}
            <span className="w-2 shrink-0" aria-hidden="true" />
          </div>
        </div>
        <div className={"min-h-0 flex-1 overflow-y-auto p-3 sm:p-4"}>
          {salonTableCards.length === 0 ? (
            <div className={"flex min-h-56 items-center justify-center text-center"}>
              {fetchError ? (
                <div className={"max-w-md space-y-2 rounded-2xl border border-rose-900/40 bg-rose-950/15 p-5"}>
                  <AlertTriangle className={"mx-auto text-rose-400"} size={20} />
                  <strong className={"block text-sm text-koma-foreground"}>Não foi possível carregar o salão</strong>
                  <p className={"break-words font-mono text-[10px] leading-relaxed text-koma-subtle"}>{fetchError}</p>
                </div>
              ) : (
                <div className={"space-y-2 text-koma-muted"}>
                  <ClipboardList className={"mx-auto text-emerald-700 dark:text-emerald-400"} size={22} />
                  <strong className={"block text-sm text-koma-secondary"}>Nenhuma mesa cadastrada</strong>
                  <p className="text-xs">Revise a configuração do salão antes de iniciar a operação.</p>
                </div>
              )}
            </div>
          ) : visibleSalonTableCards.length === 0 ? (
            <div className={"flex min-h-56 items-center justify-center text-center text-xs text-koma-muted"}>
              Nenhuma mesa neste filtro.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] items-start gap-3">
              {visibleSalonTableCards.map(card => <CashierSalonCard key={card.table.id} card={card} actions={actions} />)}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
