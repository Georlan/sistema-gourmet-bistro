import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, ClipboardList, Users, CreditCard, Receipt, Plus } from 'lucide-react';
import type { projectCashierSalonTables } from '../../../domain/cashierOrderProjection';
import { OperationalBanner } from '../../shared/OperationalBanner';
import { formatCompactCurrency } from '../cashierPresentation';

type SalonCard = Readonly<ReturnType<typeof projectCashierSalonTables>[number]>;
export type SalonStatusFilter = 'all' | 'free' | 'occupied' | 'payment';

export interface CaixaSalonTabProps {
  readonly cards: readonly SalonCard[];
  readonly visibleCards: readonly SalonCard[];
  readonly counts: Readonly<Record<SalonStatusFilter, number>>;
  readonly insights: { readonly occupancy: number; readonly openValue: number; readonly oldestService: string };
  readonly filter: SalonStatusFilter;
  readonly onFilterChange: (filter: SalonStatusFilter) => void;
  readonly fetchError?: string | null;
  readonly actions: {
    readonly receiveTable: (orders: SalonCard['tableOrders']) => void;
    readonly inspectTable: (orders: SalonCard['tableOrders']) => void;
    readonly openTableOrder: (tableId: number) => void;
  };
}

/** Salon presentation consumes the canonical projection without owning session or checkout state. */
export function CaixaSalonTab({
  cards: salonTableCards, visibleCards: visibleSalonTableCards, counts: tableStatusCounts,
  insights: salonInsights, filter: tableStatusFilter, onFilterChange: setTableStatusFilter,
  fetchError, actions,
}: CaixaSalonTabProps) {
  return (
    <div className={clsx('orders-workspace', 'flex', 'h-full', 'min-h-0', 'flex-col', 'gap-3')}>
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
      <section className={clsx('flex', 'min-h-0', 'flex-1', 'flex-col', 'overflow-hidden', 'rounded-[22px]', 'border', 'border-koma-border', 'bg-koma-panel')}>
        <div className={clsx('flex', 'flex-col', 'gap-2', 'border-b', 'border-koma-border', 'px-3', 'py-3', 'sm:flex-row', 'sm:items-center', 'sm:justify-between', 'sm:px-4')}>
          <div className={clsx('flex', 'w-full', 'min-w-0', 'max-w-full', 'gap-1', 'overflow-x-auto', 'overscroll-x-contain', 'rounded-xl', 'bg-koma-page', 'p-1.5', 'pr-3', '[scrollbar-width:none]', '[&::-webkit-scrollbar]:hidden')}>
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
                {filter.label} <span className={clsx('ml-1', 'font-mono', 'opacity-70')}>{filter.count}</span>
              </button>
            ))}
            <span className="w-2 shrink-0" aria-hidden="true" />
          </div>
        </div>
        <div className={clsx('min-h-0', 'flex-1', 'overflow-y-auto', 'p-3', 'sm:p-4')}>
          {salonTableCards.length === 0 ? (
            <div className={clsx('flex', 'min-h-56', 'items-center', 'justify-center', 'text-center')}>
              {fetchError ? (
                <div className={clsx('max-w-md', 'space-y-2', 'rounded-2xl', 'border', 'border-rose-900/40', 'bg-rose-950/15', 'p-5')}>
                  <AlertTriangle className={clsx('mx-auto', 'text-rose-400')} size={20} />
                  <strong className={clsx('block', 'text-sm', 'text-koma-foreground')}>Não foi possível carregar o salão</strong>
                  <p className={clsx('break-words', 'font-mono', 'text-[10px]', 'leading-relaxed', 'text-koma-subtle')}>{fetchError}</p>
                </div>
              ) : (
                <div className={clsx('space-y-2', 'text-koma-muted')}>
                  <ClipboardList className={clsx('mx-auto', 'text-emerald-700 dark:text-emerald-400')} size={22} />
                  <strong className={clsx('block', 'text-sm', 'text-koma-secondary')}>Nenhuma mesa cadastrada</strong>
                  <p className="text-xs">Revise a configuração do salão antes de iniciar a operação.</p>
                </div>
              )}
            </div>
          ) : visibleSalonTableCards.length === 0 ? (
            <div className={clsx('flex', 'min-h-56', 'items-center', 'justify-center', 'text-center', 'text-xs', 'text-koma-muted')}>
              Nenhuma mesa neste filtro.
            </div>
          ) : (
            <div className={clsx('grid', 'grid-cols-2', 'gap-2', 'sm:grid-cols-3', 'sm:gap-2.5', 'xl:grid-cols-4', '2xl:grid-cols-6')}>
              {visibleSalonTableCards.map((card) => {
                const { table, displayMesaId, tableOrders, isMerged, isOccupied, hasPendingPayment, total } = card;
                const tableOrderNumbers = Array.from(new Set(
                  tableOrders
                    .flatMap(order => order.numeroPedidos?.length ? order.numeroPedidos : [order.numeroPedido])
                    .map(number => Number(number))
                    .filter(number => Number.isFinite(number) && number > 0)
                ));
                const originId = tableOrders.find(order => order.mesaOrigemId && Number(order.mesaOrigemId) !== Number(displayMesaId))?.mesaOrigemId;
                const transferredFromId = tableOrders.find(order => order.mesaTransferidaDe && Number(order.mesaTransferidaDe) !== Number(displayMesaId))?.mesaTransferidaDe;
                const statusLabel = isMerged
                  ? 'Mesclada'
                  : hasPendingPayment
                    ? 'Para receber'
                    : isOccupied
                      ? 'Em atendimento'
                      : 'Livre';
                return (
                  <article
                    key={table.id}
                    data-table-status={isMerged ? 'merged' : hasPendingPayment ? 'payment' : isOccupied ? 'occupied' : 'free'}
                    className={clsx(
                      'group flex min-h-[106px] sm:min-h-[148px] flex-col justify-between gap-2 sm:gap-3 rounded-xl sm:rounded-2xl border p-2.5 sm:p-3.5 transition-colors shadow-sm',
                      isMerged && 'border-dashed border-koma-border bg-black/10 dark:bg-black/20 opacity-65',
                      hasPendingPayment && 'border-amber-300 dark:border-[#74404b] bg-amber-50/90 dark:bg-[#241419] hover:border-amber-500',
                      isOccupied && !hasPendingPayment && 'border-koma-danger-border bg-koma-danger-bg hover:border-koma-danger-text',
                      !isOccupied && !isMerged && 'koma-table-free-card'
                    )}
                  >
                    <div className={clsx('flex', 'items-start', 'justify-between', 'gap-2')}>
                      <div className="min-w-0">
                        <span className={clsx('block', 'font-mono', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-[0.2em]', 'text-koma-muted')}>Mesa</span>
                        <div className={clsx('mt-0.5', 'flex', 'items-baseline', 'gap-2')}>
                          <strong className={clsx('text-xl sm:text-2xl', 'font-extrabold', 'leading-none', 'text-koma-foreground')}>{table.id}</strong>
                          {table.nome && table.nome !== `Mesa ${table.id}` && (
                            <span className={clsx('line-clamp-1', 'break-words', 'text-[10px]', 'font-semibold', 'text-koma-secondary')}>{table.nome}</span>
                          )}
                        </div>
                      </div>
                      {tableOrderNumbers.length > 0 && (
                        <span
                          className={clsx('shrink-0', 'rounded-lg', 'border', 'border-koma-border', 'bg-black/10', 'px-2', 'py-1', 'font-mono', 'text-[9px]', 'font-extrabold', 'text-koma-secondary')}
                          title={`Pedido ${tableOrderNumbers.map(number => `#${number}`).join(' + ')}`}
                        >
                          Pedido {tableOrderNumbers[0]}{tableOrderNumbers.length > 1 ? ` +${tableOrderNumbers.length - 1}` : ''}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5 sm:space-y-2">
                      <div className={clsx('flex', 'flex-wrap', 'items-center', 'gap-1.5')}>
                        <span className={clsx(
                          'rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider',
                          isMerged && 'border-koma-border bg-koma-card text-koma-muted',
                          hasPendingPayment && 'border-amber-300 dark:border-[#8a4753] bg-amber-100 dark:bg-[#4b222b] text-amber-900 dark:text-[#efb2bc]',
                          isOccupied && !hasPendingPayment && 'koma-badge-danger',
                          !isOccupied && !isMerged && 'border-emerald-300 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                        )}>
                          <span
                            className={clsx(
                              'mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle',
                              hasPendingPayment ? 'bg-amber-500' : isOccupied ? 'bg-koma-danger-text' : 'bg-emerald-500'
                            )}
                            aria-hidden="true"
                          />
                          {statusLabel}
                        </span>
                        <span className={clsx('flex', 'items-center', 'gap-1', 'text-[9px]', 'text-koma-muted')}>
                          <Users size={10} /> {table.capacidade || 4}
                        </span>
                      </div>
                      {isOccupied ? (
                        <div className={clsx('flex', 'items-end', 'justify-between', 'gap-2')}>
                          {tableOrders.length > 0 ? (
                            <>
                              <span className={clsx('text-[9px]', 'text-koma-muted')}>Consumo</span>
                              <strong className={clsx(
                                'font-mono text-xs sm:text-sm',
                                hasPendingPayment ? 'text-amber-800 dark:text-[#efb2bc]' : 'text-koma-danger-text'
                              )}>
                                {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              </strong>
                            </>
                          ) : (
                            <span className={clsx('text-[9px]', 'text-koma-muted')}>Sincronizando…</span>
                          )}
                        </div>
                      ) : (
                        <span className={clsx('hidden', 'sm:block', 'text-[10px]', 'text-koma-muted')}>Pronta para receber clientes</span>
                      )}
                      {(originId || transferredFromId) && (
                        <span className={clsx('block', 'truncate', 'text-[9px]', 'text-koma-muted')}>
                          {originId ? `Unida à M${originId}` : `Transf. M${transferredFromId}`}
                        </span>
                      )}
                    </div>
                    {!isMerged && (
                      <div className={clsx('flex', 'gap-1.5', 'border-t', 'border-koma-border', 'pt-2 sm:pt-2.5')}>
                        {isOccupied ? (
                          hasPendingPayment ? (
                            <button
                              type="button"
                              disabled={tableOrders.length === 0}
                              onClick={() => actions.receiveTable(tableOrders)}
                              className={clsx('flex', 'min-h-8 sm:min-h-9', 'flex-1', 'items-center', 'justify-center', 'gap-1', 'rounded-lg', 'koma-badge-warning', 'hover:bg-amber-200 dark:hover:bg-amber-900/40', 'px-2', 'text-[9px]', 'font-extrabold', 'uppercase', 'tracking-wide', 'transition-colors', 'disabled:cursor-wait', 'disabled:opacity-45', 'cursor-pointer')}
                            >
                              <CreditCard size={11} />
                              Receber
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={tableOrders.length === 0}
                              onClick={() => actions.inspectTable(tableOrders)}
                              className={clsx('flex', 'min-h-8 sm:min-h-9', 'flex-1', 'items-center', 'justify-center', 'gap-1', 'rounded-lg', 'koma-table-occupied-action', 'px-2', 'text-[9px]', 'font-extrabold', 'uppercase', 'tracking-wide', 'transition-all', 'disabled:cursor-wait', 'disabled:opacity-45', 'cursor-pointer')}
                            >
                              <Receipt size={11} />
                              Ver comanda
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => actions.openTableOrder(table.id)}
                            className={clsx('flex', 'min-h-8 sm:min-h-9', 'flex-1', 'items-center', 'justify-center', 'gap-1', 'rounded-lg', 'koma-table-free-action', 'px-2', 'text-[9px]', 'font-extrabold', 'uppercase', 'tracking-wide', 'transition-colors', 'cursor-pointer', 'shadow-xs')}
                          >
                            <Plus size={11} />
                            Abrir pedido
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
