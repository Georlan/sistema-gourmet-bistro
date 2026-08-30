import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, Search, MapPin, ClipboardList, Users, Printer, Check, Globe, Smartphone, Clock } from 'lucide-react';
import type { OrderItem } from '../../../types';
import { OperationalBanner } from '../../shared/OperationalBanner';
import { deriveProductionState } from '../../../domain/operationalState';
import {
  getCashierDeliveryStatusLabel as deliveryStatusLabel,
  getCashierHumanOrderNumber as humanOrderNumber,
  getCashierOrderSlaData as getOrderSlaData,
} from '../../../domain/cashierOrderProjection';
import { formatCompactCurrency, formatCurrency, operationalOriginLabel } from '../cashierPresentation';
import type { CashierTableCard, DeliveryOrderView, OrdersStage, PendingCashPayment, PendingCashPaymentCard } from './cashierWorkspaceTypes';

export interface CaixaOrdersWorkspaceProps {
  readonly columns: {
    readonly tableProduction: readonly CashierTableCard[];
    readonly digitalProduction: readonly DeliveryOrderView[];
    readonly tableClosing: readonly CashierTableCard[];
    readonly digitalFinalization: readonly DeliveryOrderView[];
  };
  readonly pendingCashPayments: readonly PendingCashPaymentCard[];
  readonly insights: {
    readonly oldestOrder: string;
    readonly openValue: number;
    readonly actionMetric: { readonly label: string; readonly value: number; readonly needsAttention: boolean };
  };
  readonly search: { readonly query: string; readonly onChange: (query: string) => void };
  readonly acceptance: {
    readonly orders: readonly DeliveryOrderView[];
    readonly automatic: boolean;
    readonly drawerOpen: boolean;
    readonly onAutomaticChange: (automatic: boolean) => void;
    readonly onDrawerChange: (open: boolean) => void;
  };
  readonly navigation: {
    readonly stage: OrdersStage;
    readonly onStageChange: (stage: OrdersStage) => void;
    readonly expandedCardIds: Readonly<Record<string, boolean>>;
    readonly onToggleCard: (cardId: string, event?: React.MouseEvent) => void;
  };
  readonly actions: {
    readonly confirmCashPayment: (payment: PendingCashPayment) => void;
    readonly rejectCashPayment: (payment: PendingCashPayment) => void;
    readonly acceptDigitalOrder: (order: DeliveryOrderView) => void;
    readonly rejectDigitalOrder: (order: DeliveryOrderView) => void;
    readonly inspectTableOrder: (order: CashierTableCard['order']) => void;
    readonly inspectDigitalOrder: (order: DeliveryOrderView) => void;
    readonly printConference: (order: CashierTableCard['order'] | DeliveryOrderView) => void;
    readonly markTableItemsReady: (order: CashierTableCard['order']) => void;
    readonly advanceDigitalOrder: (order: DeliveryOrderView) => void;
    readonly openTablePayment: (order: CashierTableCard['order']) => void;
    readonly finalizeDigitalOrder: (order: DeliveryOrderView) => void;
  };
  readonly isLoading: boolean;
  readonly now: number;
}

// Renderizador compacto de itens de alta densidade
const renderCompactItemsList = (
  items: string | readonly { nome?: string }[],
  cardId: string,
  isExpanded: boolean,
  onToggle: (cardId: string, e: React.MouseEvent) => void
) => {
  let itemList: { name: string; qty: number }[] = [];

  if (Array.isArray(items)) {
    const counts: Record<string, number> = {};
    items.forEach(it => {
      const name = it.nome || 'Item';
      counts[name] = (counts[name] || 0) + 1;
    });
    itemList = Object.entries(counts).map(([name, qty]) => ({ name, qty }));
  } else if (typeof items === 'string') {
    const parts = items.split(/\+|\,/);
    itemList = parts.map(p => {
      const trimmed = p.trim();
      const match = trimmed.match(/^(\d+)x?\s*(.+)$/i);
      if (match) {
        return { qty: parseInt(match[1], 10), name: match[2].trim() };
      }
      return { qty: 1, name: trimmed };
    }).filter(it => it.name.length > 0);
  }

  if (itemList.length === 0) {
    return <p className={clsx('orders-card__items', 'font-medium', 'text-[11px]', 'text-koma-subtle', 'italic', 'p-2', 'rounded-lg')}>Nenhum item adicionado</p>;
  }

  const visibleItems = isExpanded ? itemList : itemList.slice(0, 3);
  const hiddenCount = itemList.length - 3;

  return (
    <div className={clsx('orders-card__items', 'space-y-0.5', 'p-2', 'rounded-lg')}>
      <ul className="space-y-0.5">
        {visibleItems.map((it, idx) => (
          <li key={idx} className={clsx('font-medium', 'text-xs', 'text-koma-secondary', 'flex', 'items-center', 'justify-between', 'font-sans', 'truncate')}>
            <span className="truncate">{it.qty}× {it.name}</span>
          </li>
        ))}
      </ul>
      {itemList.length > 3 && (
        <button
          type="button"
          onClick={(e) => onToggle(cardId, e)}
          className={clsx('mt-0.5', 'text-[11px]', 'font-bold', 'text-emerald-700 dark:text-emerald-400', 'hover:text-emerald-600 dark:text-emerald-300', 'underline', 'cursor-pointer', 'block', 'transition-all')}
        >
          {isExpanded ? "▲ Recolher itens" : `+ ${hiddenCount} mais itens (expandir)`}
        </button>
      )}
    </div>
  );
};


/** Controlled order workspace. Selection, effects and complete business actions stay in CaixaPanel. */
export function CaixaOrdersWorkspace({
  columns, pendingCashPayments: pagamentosPendentes, insights: operationalOrderInsights,
  search, acceptance, navigation, actions, isLoading, now: nowTimestamp,
}: CaixaOrdersWorkspaceProps) {
  const { tableProduction: filteredCol1, digitalProduction: filteredDigitalProduction,
    tableClosing: filteredCol2Table, digitalFinalization: filteredDeliveryFinalization } = columns;
  const { query: searchQuery, onChange: setSearchQuery } = search;
  const { orders: deliveryOrders, automatic: autoAccept, drawerOpen: isDrawerOpen,
    onAutomaticChange: setAutoAccept, onDrawerChange: setIsDrawerOpen } = acceptance;
  const { stage: mobileOrdersStage, onStageChange: setMobileOrdersStage,
    expandedCardIds, onToggleCard: toggleCardExpansion } = navigation;
  const totalResultadosBusca = filteredCol1.length + filteredDigitalProduction.length + filteredCol2Table.length + filteredDeliveryFinalization.length;

  const ordersStages = [
    { id: 'salon' as const, label: 'Salão', count: filteredCol1.length },
    { id: 'digital' as const, label: 'Balcão', count: filteredDigitalProduction.length },
    { id: 'closing' as const, label: 'Concluir', count: filteredCol2Table.length + filteredDeliveryFinalization.length },
  ];
  const effectiveMobileOrdersStage = mobileOrdersStage;
  const ordersColumnCounts = ordersStages.map(stage => stage.count);
  const activeOrdersColumns = ordersColumnCounts.filter(count => count > 0).length;
  const ordersColumnWeight = activeOrdersColumns === 1 ? 1.7 : activeOrdersColumns === 2 ? 1.25 : 1;
  const ordersColumnsTemplate = activeOrdersColumns === 0
    ? `repeat(${ordersStages.length}, minmax(0, 1fr))`
    : ordersColumnCounts
      .map(count => count === 0 ? 'minmax(0, 0.68fr)' : `minmax(0, ${ordersColumnWeight}fr)`)
      .join(' ');
  const ordersBoardStyle = {
    '--orders-columns': ordersColumnsTemplate
  } as React.CSSProperties;


  return (
    <div className={clsx('orders-workspace', 'flex', 'flex-col', 'space-y-4')}>
      <OperationalBanner
        id="orders-heading"
        eyebrow="OPERAÇÃO"
        title="Pedidos"
        accent="por etapa"
        description="Clique no card para ver o pedido e escolher a próxima ação."
        metrics={[
          { label: 'pedido mais antigo', value: operationalOrderInsights.oldestOrder },
          { label: 'valor em aberto', value: formatCompactCurrency(operationalOrderInsights.openValue) },
          {
            label: operationalOrderInsights.actionMetric.label,
            value: operationalOrderInsights.actionMetric.value,
            valueClassName: operationalOrderInsights.actionMetric.needsAttention ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300',
          },
        ]}
      />
      {/* ALERTA DE PAGAMENTO PENDENTE EM DINHEIRO (GARÇOM) */}
      {pagamentosPendentes.length > 0 && (
        <div className={clsx('bg-koma-card', 'border-2', 'border-amber-500/40', 'p-4', 'rounded-2xl', 'space-y-3', 'animate-pulse-subtle')}>
          <div className={clsx('flex', 'items-center', 'gap-2', 'text-amber-500', 'font-bold', 'uppercase', 'tracking-wider', 'text-[10px]')}>
            <AlertTriangle size={14} />
            <span>Confirmação de Dinheiro Pendente ({pagamentosPendentes.length})</span>
          </div>
          <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-2', 'gap-3')}>
            {pagamentosPendentes.map((pag) => {
              const mesaNum = pag.mesaNum;
              return (
                <div key={pag.id} className={clsx('bg-koma-canvas', 'border', 'border-koma-border', 'p-3', 'rounded-xl', 'flex', 'justify-between', 'items-center', 'gap-4', 'text-[11px]', 'text-left')}>
                  <div>
                    <span className={clsx('text-koma-subtle', 'block')}>Mesa {mesaNum}</span>
                    <span className={clsx('font-bold', 'text-koma-foreground', 'block')}>{formatCurrency(pag.valor)} em Dinheiro</span>
                    <span className={clsx('text-[9.5px]', 'text-emerald-700 dark:text-emerald-400', 'block', 'font-mono')}>Garçom solicitante: {pag.nome_cliente || 'Garçom'}</span>
                  </div>
                  <div className={clsx('flex', 'gap-2')}>
                    <button
                      type="button"
                      onClick={() => actions.confirmCashPayment(pag)}
                      className={clsx('px-3', 'py-1.5', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded-lg', 'font-bold', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                    >
                      Confirmar Recebimento
                    </button>
                    <button
                      type="button"
                      onClick={() => actions.rejectCashPayment(pag)}
                      className={clsx('px-3', 'py-1.5', 'bg-rose-50', 'border', 'border-rose-300', 'text-rose-800', 'hover:bg-rose-700', 'hover:text-white', 'dark:bg-rose-950/30', 'dark:border-rose-900/35', 'dark:text-rose-300', 'dark:hover:bg-rose-900/50', 'rounded-lg', 'font-bold', 'text-[9px]', 'transition-all', 'cursor-pointer')}
                    >
                      Rejeitar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Controls bar with Search Input */}
      <div className={clsx('orders-toolbar', 'sticky', 'top-0', 'z-20')}>
        {/* Search Bar Component */}
        <div className={clsx('orders-search', 'relative')}>
          <Search className={clsx('absolute', 'left-3', 'top-1/2', '-translate-y-1/2', 'w-4', 'h-4', 'text-koma-muted')} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar mesa, cliente, telefone ou item"
            className="orders-search__input"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="orders-search__clear"
              title="Limpar busca"
              aria-label="Limpar busca"
            >
              ✕
            </button>
          )}
        </div>
        {searchQuery.trim() !== '' && (
          <span className="orders-search__result" aria-live="polite">
            {totalResultadosBusca} {totalResultadosBusca === 1 ? 'resultado' : 'resultados'}
          </span>
        )}
        <div className="orders-toolbar__actions">
          <label className="orders-auto-accept">
            <input
              type="checkbox"
              checked={autoAccept}
              onChange={(e) => setAutoAccept(e.target.checked)}
              className={clsx('sr-only', 'peer')}
              aria-label="Aceitar pedidos online automaticamente"
            />
            <span className="orders-switch" aria-hidden="true"><span /></span>
            <span className="orders-auto-accept__label">Aceitar pedidos online automaticamente</span>
          </label>
          <div className="orders-delivery-total">
            <span>Balcão e delivery</span>
            <strong>{formatCurrency(deliveryOrders.reduce((s, o) => s + o.total, 0))}</strong>
          </div>
          {/* Bell button — opens floating drawer */}
          <button
            type="button"
            onClick={() => { setIsDrawerOpen(true); }}
            className="orders-new-orders"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            <span>Aguardando aceite</span>
            {deliveryOrders.filter(o => o.status === 'pendente').length > 0 && (
              <span className="orders-new-orders__count">
                {deliveryOrders.filter(o => o.status === 'pendente').length}
              </span>
            )}
          </button>
        </div>
      </div>
      {/* ── FLOATING DRAWER: Pedidos Pendentes ─────────────────────────────── */}
      {isDrawerOpen && (
        <div
          className={clsx('fixed', 'inset-0', 'z-50', 'flex')}
          onClick={() => setIsDrawerOpen(false)}
        >
          {/* Backdrop */}
          <div className={clsx('absolute', 'inset-0', 'bg-black/60', 'backdrop-blur-sm')} />
          {/* Drawer panel */}
          <div
            className={clsx('relative', 'ml-auto', 'h-full', 'w-full', 'max-w-sm', 'bg-koma-panel', 'border-l', 'border-koma-border', 'flex', 'flex-col', 'shadow-2xl')}
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className={clsx('flex', 'items-center', 'justify-between', 'px-5', 'py-4', 'border-b', 'border-koma-border', 'shrink-0')}>
              <div>
                <h2 className={clsx('font-bold', 'text-koma-foreground', 'text-sm')}>Pedidos aguardando aceite</h2>
                <p className={clsx('text-[10px]', 'text-koma-subtle', 'mt-0.5')}>Aceite ou recuse cada pedido antes de produzir</p>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className={clsx('p-1.5', 'rounded-lg', 'bg-koma-raised', 'border', 'border-koma-border', 'text-koma-subtle', 'hover:text-koma-foreground', 'cursor-pointer')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            {/* Drawer body */}
            <div className={clsx('flex-1', 'overflow-y-auto', 'p-4', 'space-y-3')}>
              {deliveryOrders.filter(o => o.status === 'pendente').length === 0 ? (
                <div className={clsx('flex', 'flex-col', 'items-center', 'justify-center', 'h-40', 'text-koma-muted', 'text-[11px]', 'italic')}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={clsx('mb-3', 'opacity-40')}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                  Nenhum pedido pendente
                </div>
              ) : (
                deliveryOrders.filter(o => o.status === 'pendente').map((order) => (
                  <div key={order.id} className={clsx('orders-pending-card', 'p-4', 'rounded-xl', 'space-y-3')}>
                    <div className={clsx('flex', 'justify-between', 'items-start')}>
                      <div>
                        <div className={clsx('flex', 'flex-wrap', 'gap-1', 'mb-1')}>
                          <span className={clsx('orders-card__chip', 'is-primary')}>
                            {order.modalidade === 'delivery' ? 'Delivery' : 'Retirada'}
                          </span>
                          <span className={clsx('orders-card__chip', 'is-muted')}>
                            {order.canal}
                          </span>
                        </div>
                        <strong className={clsx('text-koma-foreground', 'text-sm', 'block')}>{order.cliente}</strong>
                        <span className={clsx('text-[10px]', 'text-koma-subtle', 'block')}>{order.telefone}</span>
                      </div>
                      <div className="text-right">
                        <span className="orders-card__price">{formatCurrency(order.total)}</span>
                        <span className={clsx('text-[9px]', 'text-koma-muted')}>{order.criadoEm}</span>
                        {order.numeroPedido && <span className={clsx('text-[8px]', 'text-gray-600', 'font-mono', 'block')}>#{order.numeroPedido}</span>}
                      </div>
                    </div>
                    <p className={clsx('text-[10px]', 'text-koma-secondary', 'bg-koma-page', 'p-2', 'rounded', 'border', 'border-koma-border/30', 'leading-relaxed', 'font-mono')}>
                      {order.itens}
                    </p>
                    {order.endereco && (
                      <span className={clsx('text-[10px]', 'text-koma-subtle', 'flex', 'items-start', 'gap-1')}>
                        <MapPin size={11} className={clsx('shrink-0', 'text-emerald-600 dark:text-emerald-300/80', 'mt-0.5')} />
                        <span>{order.endereco}</span>
                      </span>
                    )}
                    <div className={clsx('flex', 'gap-2', 'pt-1')}>
                      <button
                        type="button"
                        onClick={() => actions.acceptDigitalOrder(order)}
                        className="orders-pending-card__accept"
                      >
                        ✓ Aceitar
                      </button>
                      <button
                        type="button"
                        onClick={() => actions.rejectDigitalOrder(order)}
                        className="orders-pending-card__reject"
                      >
                        Recusar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      <div className="orders-mobile-stages" role="tablist" aria-label="Etapa dos pedidos">
        {ordersStages.map(stage => (
          <button
            key={stage.id}
            type="button"
            role="tab"
            aria-selected={effectiveMobileOrdersStage === stage.id}
            onClick={() => setMobileOrdersStage(stage.id)}
            className={clsx('orders-mobile-stages__button', effectiveMobileOrdersStage === stage.id && 'is-active')}
          >
            <span>{stage.label}</span>
            <strong>{stage.count}</strong>
          </button>
        ))}
      </div>
      {/* Kanban operacional universal: mesas, pedidos online e finalização. */}
      <div
        className={clsx('orders-board', 'flex-1', 'gap-3', 'pb-3')}
        style={ordersBoardStyle}
      >
        {/* COLUMN 1: Em produção */}
        <div className={clsx('orders-column orders-column--salon flex flex-col overflow-hidden', effectiveMobileOrdersStage === 'salon' && 'is-mobile-active', filteredCol1.length === 0 && 'is-empty')}>
          <div className={clsx('orders-column__header', 'px-4', 'py-2.5', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
            <div>
              <span className="orders-column__number">01 / SALÃO</span>
              <span className={clsx('font-bold', 'text-koma-foreground', 'font-sans', 'block', 'text-sm')}>Mesas em Atendimento</span>
              <span className={clsx('text-xs', 'text-koma-subtle', 'block', 'mt-0.5', 'font-normal')}>Lançados pelo garçom ou caixa</span>
            </div>
            <span className="orders-column__count">
              {filteredCol1.length}
            </span>
          </div>
          <div className={clsx('orders-column__body', 'p-2.5', 'sm:p-3', 'flex-1', 'overflow-y-auto', 'space-y-2.5')}>
            {filteredCol1.length === 0 ? (
              <div className={clsx('orders-empty-state', 'py-16', 'text-center', 'text-koma-subtle', 'text-xs', 'space-y-1')}>
                <ClipboardList size={20} className={clsx('mx-auto', 'opacity-70', 'mb-2', 'text-emerald-700', 'dark:text-emerald-400')} />
                <p>{searchQuery ? "Nenhum pedido encontrado para a busca" : "Nenhum pedido local em produção"}</p>
              </div>
            ) : (
              <>
                {filteredCol1.map(({ order, tableMovement, smartPosState, presentation }) => {
                  const preparingItems = deriveProductionState(order.itens).preparingItems;
                  const cardId = `prod-${order.id}`;
                  const sla = getOrderSlaData(order, nowTimestamp);
                  const isExpanded = !!expandedCardIds[cardId];
                  const totalVal = order.itens.reduce((sum: number, it: OrderItem & { preco_unit?: number }) => sum + (it.preco_unit || it.preco || 0), 0);
                  return (
                    <div
                      key={`table-prod-${order.id}`}
                      onClick={() => actions.inspectTableOrder(order)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          actions.inspectTableOrder(order);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${presentation.title}, ${presentation.subtitle}, ver detalhes`}
                      className={clsx(
                        'orders-card orders-card--salon rounded-xl p-2.5 sm:p-3 space-y-2 text-left cursor-pointer',
                        sla.borderTopClass
                      )}
                    >
                      <div className="orders-card__identity">
                        <div className="orders-card__number is-table">
                          <Users size={15} />
                          <strong>{presentation.shortLabel}</strong>
                        </div>
                        <div className="min-w-0">
                          <strong className="orders-card__identity-title">{presentation.title}</strong>
                          <span className="orders-card__identity-subtitle">{presentation.subtitle}</span>
                          <div className="orders-card__identity-chips">
                            <span className={clsx('orders-card__chip', sla.badgeClass)}>{sla.label}</span>
                            <span className={clsx('orders-card__chip', 'is-primary')}>EM ATENDIMENTO</span>
                            {smartPosState ? (
                              <span className={clsx('orders-card__chip', smartPosState.chipClass)}>
                                {smartPosState.label}
                              </span>
                            ) : (
                              <span className={clsx('orders-card__chip', 'is-muted')}>
                                {operationalOriginLabel(order.origemOperacional)}
                              </span>
                            )}
                            {tableMovement.transferredFromMesaIds.length > 0 && (
                              <span className={clsx('orders-card__chip', 'is-muted')}>
                                ↪ Transferida da M{tableMovement.transferredFromMesaIds.join(', M')}
                              </span>
                            )}
                            {tableMovement.mergedMesaIds.length > 0 && (
                              <span className={clsx('orders-card__chip', 'is-muted')}>
                                ⛓ Mesclada com M{tableMovement.mergedMesaIds.join(', M')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="orders-card__identity-side">
                          <span className="orders-card__price">{formatCurrency(totalVal)}</span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); actions.printConference(order); }}
                            className="orders-card__icon"
                            title="Imprimir pré-conta / conferência"
                            aria-label={`Imprimir conferência da ${presentation.title}`}
                          >
                            <Printer size={12} />
                          </button>
                        </div>
                      </div>
                      {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion)}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); actions.markTableItemsReady(order); }}
                        className={clsx('orders-card__action', 'w-full', 'py-2', 'px-3', 'h-8', 'sm:h-9', 'font-bold', 'text-xs', 'sm:text-sm', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'flex', 'items-center', 'justify-center', 'gap-1.5')}
                      >
                        <Check size={13} />
                        <span>{preparingItems.length === 1 ? 'Marcar item como pronto' : 'Marcar itens como prontos'}</span>
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
        {/* COLUMN 2: pedidos sem mesa, de venda rápida, delivery ou retirada. */}
        <div className={clsx('orders-column orders-column--digital flex flex-col overflow-hidden', effectiveMobileOrdersStage === 'digital' && 'is-mobile-active', filteredDigitalProduction.length === 0 && 'is-empty')}>
          <div className={clsx('orders-column__header', 'px-4', 'py-2.5', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
            <div>
              <span className="orders-column__number">02 / SEM MESA</span>
              <span className={clsx('font-bold', 'text-koma-foreground', 'font-sans', 'block', 'text-sm')}>Balcão e delivery</span>
              <span className={clsx('text-xs', 'text-koma-subtle', 'block', 'mt-0.5', 'font-normal')}>Venda rápida, retirada e entrega</span>
            </div>
            <span className="orders-column__count">
              {filteredDigitalProduction.length}
            </span>
          </div>
          <div className={clsx('orders-column__body', 'p-2.5', 'sm:p-3', 'flex-1', 'overflow-y-auto', 'space-y-2.5')}>
            {filteredDigitalProduction.length === 0 ? (
              <div className={clsx('orders-empty-state', 'py-16', 'text-center', 'text-koma-subtle', 'text-xs', 'space-y-1')}>
                <Globe size={20} className={clsx('mx-auto', 'opacity-40', 'mb-2', 'text-emerald-600 dark:text-emerald-300')} />
                <p>{searchQuery ? "Nenhum pedido encontrado para a busca" : "Nenhum pedido online em preparo"}</p>
              </div>
            ) : (
              <>
                {filteredDigitalProduction.map((order) => {
                  const cardId = `sim-prod-${order.id}`;
                  const sla = getOrderSlaData(order, nowTimestamp);
                  const isExpanded = !!expandedCardIds[cardId];
                  const isDeliveryOrder = order.modalidade === 'delivery';
                  const badgeText = deliveryStatusLabel(order.status, order.modalidade).toUpperCase();
                  const buttonText = isDeliveryOrder ? 'SAIU PARA ENTREGA' : 'PRONTO PARA RETIRADA';
                  return (
                    <div
                      key={order.id}
                      onClick={() => actions.inspectDigitalOrder(order)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          actions.inspectDigitalOrder(order);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${order.isQuickSale ? 'Venda rápida' : order.modalidade} pedido ${humanOrderNumber(order)}, ver detalhes`}
                      className={clsx(
                        'orders-card orders-card--digital rounded-xl p-2.5 sm:p-3 space-y-2 text-left cursor-pointer',
                        order.isQuickSale && 'orders-card--quick-sale',
                        sla.borderTopClass
                      )}
                    >
                      <div className="orders-card__identity">
                        <div className={clsx('orders-card__number', order.isQuickSale && 'is-quick-sale')}>
                          {order.isQuickSale ? <Smartphone size={15} /> : <Globe size={15} />}
                          <strong>#{humanOrderNumber(order)}</strong>
                        </div>
                        <div className="min-w-0">
                          <strong className="orders-card__identity-title">
                            {order.isQuickSale ? 'Venda rápida' : order.cliente}
                          </strong>
                          <span className="orders-card__identity-subtitle">
                            {order.isQuickSale
                              ? `Retirada no balcão · ${order.quantidadeItens} ${order.quantidadeItens === 1 ? 'item' : 'itens'}`
                              : `${isDeliveryOrder ? 'Delivery' : 'Retirada'}${order.telefone ? ` · ${order.telefone}` : ''}`}
                          </span>
                          <div className="orders-card__identity-chips">
                            <span className={clsx('orders-card__chip', sla.badgeClass)}>{sla.label}</span>
                            <span className={clsx('orders-card__chip', 'is-primary')}>{badgeText}</span>
                            <span className={clsx('orders-card__chip', 'is-muted')}>{operationalOriginLabel(order.origemOperacional)}</span>
                          </div>
                        </div>
                        <div className="orders-card__identity-side">
                          <span className="orders-card__price">{formatCurrency(order.total)}</span>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); actions.printConference(order); }}
                              className="orders-card__icon"
                              title="Imprimir pré-conta / conferência"
                              aria-label={`Imprimir conferência do pedido ${humanOrderNumber(order)}`}
                            >
                              <Printer size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                      {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion)}
                      {isDeliveryOrder && order.endereco && (
                        <span className={clsx('font-normal', 'text-xs', 'text-koma-subtle', 'flex', 'items-center', 'gap-1', 'truncate')}>
                          <MapPin size={11} className={clsx('shrink-0', 'text-emerald-600 dark:text-emerald-300/80')} />
                          <span className="truncate">{order.endereco}</span>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); actions.advanceDigitalOrder(order); }}
                        className={clsx('orders-card__action', 'w-full', 'py-2', 'px-3', 'h-8', 'sm:h-9', 'font-bold', 'text-xs', 'sm:text-sm', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'flex', 'items-center', 'justify-center', 'gap-1.5')}
                      >
                        <Check size={13} />
                        <span>{buttonText === 'SAIU PARA ENTREGA' ? 'Saiu para entrega' : 'Pronto para retirada'}</span>
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
        {/* COLUMN 3: pagamento e finalização de todas as modalidades. */}
        <div className={clsx('orders-column orders-column--closing flex flex-col overflow-hidden', effectiveMobileOrdersStage === 'closing' && 'is-mobile-active', filteredCol2Table.length === 0 && filteredDeliveryFinalization.length === 0 && 'is-empty')}>
          <div className={clsx('orders-column__header', 'px-4', 'py-2.5', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
            <div>
              <span className="orders-column__number">03 / FECHAMENTO</span>
              <span className={clsx('font-bold', 'text-koma-foreground', 'font-sans', 'block', 'text-sm')}>Itens prontos e conclusão</span>
              <span className={clsx('text-xs', 'text-koma-subtle', 'block', 'mt-0.5', 'font-normal')}>Veja o que já pode ser recebido ou finalizado</span>
            </div>
            <span className="orders-column__count">
              {filteredCol2Table.length + filteredDeliveryFinalization.length}
            </span>
          </div>
          <div className={clsx('orders-column__body', 'p-2.5', 'sm:p-3', 'flex-1', 'overflow-y-auto', 'space-y-2.5')}>
            {filteredCol2Table.length === 0 && filteredDeliveryFinalization.length === 0 ? (
              <div className={clsx('orders-empty-state', 'py-16', 'text-center', 'text-koma-subtle', 'text-xs', 'space-y-1')}>
                <Check size={20} className={clsx('mx-auto', 'opacity-40', 'mb-2', 'text-emerald-600 dark:text-emerald-300')} />
                <p>{searchQuery ? "Nenhum pedido encontrado para a busca" : "Nenhum pedido aguardando finalização"}</p>
              </div>
            ) : (
              <>
                {/* 1. Mesas/Consumo Local aguardando pagamento */}
                {filteredCol2Table.map(({ order, tableMovement, smartPosState, presentation }) => {
                  const cardId = `ready-${order.id}`;
                  const sla = getOrderSlaData(order, nowTimestamp);
                  const isExpanded = !!expandedCardIds[cardId];
                  const contaPedida = !!order.contaPedida;
                  const badgeText = contaPedida ? 'CONTA PEDIDA' : 'PRONTO / RECEBER';
                  const totalVal = order.itens.reduce((sum: number, it: OrderItem & { preco_unit?: number }) => sum + (it.preco_unit || it.preco || 0), 0);
                  const pendingTableItems = Number(order.itensEmPreparoCount || 0);
                  const readyTableItems = order.itens.filter(item => (item.status as string) !== 'cancelado').length;
                  const totalTableItems = readyTableItems + pendingTableItems;
                  return (
                    <div
                      key={`close-${order.id}`}
                      onClick={() => actions.inspectTableOrder(order)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          actions.inspectTableOrder(order);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${presentation.title}, ${badgeText.toLowerCase()}, ver detalhes`}
                      className={clsx(
                        'orders-card orders-card--closing rounded-xl p-2.5 sm:p-3 space-y-2 text-left cursor-pointer',
                        sla.borderTopClass
                      )}
                    >
                      <div className="orders-card__identity">
                        <div className="orders-card__number is-table">
                          <Users size={15} />
                          <strong>{presentation.shortLabel}</strong>
                        </div>
                        <div className="min-w-0">
                          <strong className="orders-card__identity-title">
                            {pendingTableItems > 0 ? `Itens prontos · ${presentation.title}` : presentation.title}
                          </strong>
                          <span className="orders-card__identity-subtitle">
                            {pendingTableItems > 0
                              ? `${readyTableItems} de ${totalTableItems} ${totalTableItems === 1 ? 'item pronto' : 'itens prontos'} · ${presentation.subtitle}`
                              : presentation.subtitle}
                          </span>
                          <div className="orders-card__identity-chips">
                            <span className={clsx('orders-card__chip', sla.badgeClass)}>{sla.label}</span>
                            <span className={clsx('orders-card__chip', contaPedida ? 'is-attention' : 'is-primary')}>{badgeText}</span>
                            {smartPosState ? (
                              <span className={clsx('orders-card__chip', smartPosState.chipClass)}>
                                {smartPosState.label}
                              </span>
                            ) : (
                              <span className={clsx('orders-card__chip', 'is-muted')}>
                                {operationalOriginLabel(order.origemOperacional)}
                              </span>
                            )}
                            {tableMovement.transferredFromMesaIds.length > 0 && (
                              <span className={clsx('orders-card__chip', 'is-muted')}>
                                ↪ Transferida da M{tableMovement.transferredFromMesaIds.join(', M')}
                              </span>
                            )}
                            {tableMovement.mergedMesaIds.length > 0 && (
                              <span className={clsx('orders-card__chip', 'is-muted')}>
                                ⛓ Mesclada com M{tableMovement.mergedMesaIds.join(', M')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="orders-card__identity-side">
                          <span className="orders-card__price" title={pendingTableItems > 0 ? 'Valor dos itens prontos' : 'Valor a receber'}>{formatCurrency(totalVal)}</span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); actions.printConference(order); }}
                            className="orders-card__icon"
                            title="Imprimir pré-conta / conferência"
                            aria-label={`Imprimir conferência da ${presentation.title}`}
                          >
                            <Printer size={12} />
                          </button>
                        </div>
                      </div>
                      {pendingTableItems > 0 && (
                        <div className={clsx('flex', 'items-center', 'gap-2', 'rounded-lg', 'border', 'border-koma-warning-border', 'bg-koma-warning-bg', 'px-2.5', 'py-2', 'text-[11px]', 'font-semibold', 'text-koma-warning-text')}>
                          <Clock size={13} className="shrink-0" />
                          <span>
                            {pendingTableItems === 1 ? 'Outro item continua em preparo.' : `Outros ${pendingTableItems} itens continuam em preparo.`}
                          </span>
                        </div>
                      )}
                      {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion)}
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={(e) => { e.stopPropagation(); actions.openTablePayment(order); }}
                        className={clsx('orders-card__action', 'w-full', 'py-2', 'px-3', 'h-8', 'sm:h-9', 'font-bold', 'text-xs', 'sm:text-sm', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'flex', 'items-center', 'justify-center', 'gap-1.5')}
                      >
                        {smartPosState?.blocksPayment ? (
                          <><Smartphone size={13} /><span>{smartPosState.ctaLabel}</span></>
                        ) : (
                          <><Check size={13} /><span>{pendingTableItems > 0 ? 'Receber itens prontos' : 'Abrir pagamento'}</span></>
                        )}
                      </button>
                    </div>
                  );
                })}
                {/* 2. Delivery/Retirada em trânsito (aguardando retorno/pagamento) */}
                {filteredDeliveryFinalization.map((order) => {
                  const cardId = `transito-${order.id}`;
                  const sla = getOrderSlaData(order, nowTimestamp);
                  const isExpanded = !!expandedCardIds[cardId];
                  const isDeliveryOrder = order.modalidade === 'delivery';
                  const badgeText = order.pago
                    ? 'PAGO'
                    : deliveryStatusLabel(order.status, order.modalidade).toUpperCase();
                  return (
                    <div
                      key={`transito-${order.id}`}
                      onClick={() => actions.inspectDigitalOrder(order)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          actions.inspectDigitalOrder(order);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${order.isQuickSale ? 'Venda rápida' : order.modalidade} pedido ${humanOrderNumber(order)}, ver detalhes`}
                      className={clsx(
                        'orders-card orders-card--closing rounded-xl p-2.5 sm:p-3 space-y-2 text-left cursor-pointer',
                        order.isQuickSale && 'orders-card--quick-sale',
                        sla.borderTopClass
                      )}
                    >
                      <div className="orders-card__identity">
                        <div className={clsx('orders-card__number', order.isQuickSale && 'is-quick-sale')}>
                          {order.isQuickSale ? <Smartphone size={15} /> : <Globe size={15} />}
                          <strong>#{humanOrderNumber(order)}</strong>
                        </div>
                        <div className="min-w-0">
                          <strong className="orders-card__identity-title">
                            {order.isQuickSale ? 'Venda rápida' : order.cliente}
                          </strong>
                          <span className="orders-card__identity-subtitle">
                            {order.isQuickSale
                              ? `Retirada no balcão · ${order.quantidadeItens} ${order.quantidadeItens === 1 ? 'item' : 'itens'}`
                              : `${isDeliveryOrder ? 'Delivery' : 'Retirada'}${order.telefone ? ` · ${order.telefone}` : ''}`}
                          </span>
                          <div className="orders-card__identity-chips">
                            <span className={clsx('orders-card__chip', sla.badgeClass)}>{sla.label}</span>
                            <span className={clsx('orders-card__chip', 'is-primary')}>{badgeText}</span>
                            <span className={clsx('orders-card__chip', 'is-muted')}>{operationalOriginLabel(order.origemOperacional)}</span>
                          </div>
                        </div>
                        <div className="orders-card__identity-side">
                          <span className="orders-card__price">{formatCurrency(order.total)}</span>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); actions.printConference(order); }}
                              className="orders-card__icon"
                              title="Imprimir pré-conta / conferência"
                              aria-label={`Imprimir conferência do pedido ${humanOrderNumber(order)}`}
                            >
                              <Printer size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                      {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion)}
                      {isDeliveryOrder && order.endereco && (
                        <span className={clsx('font-normal', 'text-xs', 'text-koma-subtle', 'flex', 'items-center', 'gap-1', 'truncate')}>
                          <MapPin size={11} className={clsx('shrink-0', 'text-emerald-600 dark:text-emerald-300/80')} />
                          <span className="truncate">{order.endereco}</span>
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); actions.finalizeDigitalOrder(order); }}
                        className={clsx('orders-card__action', 'w-full', 'py-2', 'px-3', 'h-8', 'sm:h-9', 'font-bold', 'text-xs', 'sm:text-sm', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'flex', 'items-center', 'justify-center', 'gap-1.5')}
                      >
                        <Check size={13} /><span>{order.pago ? 'Finalizar pedido' : 'Receber e finalizar'}</span>
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
