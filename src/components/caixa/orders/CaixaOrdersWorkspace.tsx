import { formatBackendDateTime } from "../../../utils/dateTime";
import { CashierPrintGlyph } from './CashierPrintGlyph';
import { CheckoutPaymentArt } from '../checkout/CheckoutPaymentArt';
import { CashierOrderMark } from './CashierOrderMark';
import { CashierCardEdge } from './CashierCardEdge';
import { CashierColumnHeader } from './CashierColumnHeader';
import { OrderItemComposition } from '../../shared/OrderItemComposition';
import { itemCompositionSignature, type CompositionSource } from '../../../domain/orderItemComposition';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Search, MapPin, ClipboardList, Check, Smartphone, Clock } from 'lucide-react';
import type { OrderItem } from '../../../types';
import { OperationalBanner } from '../../shared/OperationalBanner';
import { trapOverlayTab } from '../../shared/trapOverlayTab';
import { deriveProductionState } from '../../../domain/operationalState';
import { normalizeOperationalTimestamp } from '../../../domain/operationalTime';
import {
  getCashierDeliveryStatusLabel as deliveryStatusLabel,
  getCashierHumanOrderNumber as humanOrderNumber,
  getCashierOrderSlaData as getOrderSlaData,
  getDigitalOrderActionCapability,
  getLatestCashierCardKey,
} from '../../../domain/cashierOrderProjection';
import { formatCompactCurrency, formatCurrency, operationalOriginLabel } from '../cashierPresentation';
import type { CashierTableCard, DeliveryOrderView, OrdersStage, PendingCashPayment, PendingCashPaymentCard } from './cashierWorkspaceTypes';
import { DigitalReceiptAction } from '../digital-receipt/DigitalReceiptAction';
import { getDigitalOrderAssociation, getDigitalOrderCustomerLabel, getDigitalOrderFulfillmentLabel, getDigitalOrderPaymentSummary, getDigitalOrderSourceLabel, getDigitalOrderTableBlockLabel, getDigitalOrderVisualKind } from './digitalOrderPresentation';

export interface CaixaOrdersWorkspaceProps {
  readonly pixConferenceTrigger?: React.ReactNode;
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
    readonly pendingOrderIds: ReadonlySet<string>;
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
  readonly couriers: {
    readonly options: readonly {
      readonly id: string | number;
      readonly nome: string;
      readonly ativo?: boolean;
    }[];
    readonly loadState: 'loading' | 'loaded' | 'error';
    readonly selectedByOrderId: Readonly<Record<string, string>>;
    readonly onChange: (orderId: string, courierId: string) => void;
    readonly onRequestReassignment: (order: DeliveryOrderView) => void;
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
    readonly dispatchDelivery: (orderId: string, courierId: string) => void;
    readonly openTablePayment: (order: CashierTableCard['order']) => void;
    readonly finalizeDigitalOrder: (order: DeliveryOrderView) => void;
  };
  readonly hasLocalServiceWork?: boolean;
  readonly hasPrinting?: boolean;
  readonly restaurantConfig?: Record<string, unknown> | null;
  readonly onToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
  readonly isLoading: boolean;
  readonly now: number;
}

// Fulfillment is identified inside the number block; it does not change the order identity.
const digitalOrderMark = (order: DeliveryOrderView, number: string, associatedTable: boolean) => (
  <CashierOrderMark number={number}
    kind={order.isQuickSale ? 'counter' : order.modalidade === 'delivery' ? 'delivery' : order.modalidade === 'retirada' ? 'pickup' : 'dine-in'}
    label={order.isQuickSale ? 'Balcão' : order.modalidade === 'delivery' ? 'Entrega' : getDigitalOrderFulfillmentLabel(order)}
    tableLabel={associatedTable ? `Mesa ${String(order.mesaId).padStart(2, '0')}` : undefined} />
);

const digitalOrderEdge = (order: DeliveryOrderView) => <CashierCardEdge partner={order.partner} />;

// Renderizador compacto de itens de alta densidade
const renderCompactItemsList = (
  items: string | readonly (CompositionSource & { nome?: string; produto?: { nome?: string }; status?: string })[],
  cardId: string,
  isExpanded: boolean,
  onToggle: (cardId: string, e: React.MouseEvent) => void,
  showAll = false
) => {
  let itemList: { name: string; qty: number; source?: CompositionSource }[] = [];

  if (Array.isArray(items)) {
    const groups = new Map<string, { name: string; qty: number; source: CompositionSource }>();
    items.filter(it => it.status !== 'cancelado').forEach(it => {
      const name = it.nome || it.produto?.nome || 'Item';
      const observation = it.observacao || '';
      const key = JSON.stringify([name, observation, itemCompositionSignature(it)]);
      const group = groups.get(key);
      if (group) group.qty += 1;
      else groups.set(key, { name, qty: 1, source: it });
    });
    itemList = Array.from(groups.values());
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
    return <p className={"orders-card__items font-medium text-[11px] text-koma-subtle italic p-2 rounded-lg"}>Nenhum item adicionado</p>;
  }

  const visibleItems = isExpanded || showAll ? itemList : itemList.slice(0, 3);
  const hiddenCount = itemList.length - visibleItems.length;

  return (
    <div className={"orders-card__items p-2 rounded-lg space-y-1"}>
      {visibleItems.map((it, idx) => (
        <div key={`${it.name}-${idx}`} className="text-xs">
          <span className={"block font-semibold text-koma-foreground font-sans break-words"}>
            <strong className={"orders-card__item-qty font-mono mr-1"}>{it.qty}x</strong> {it.name}
          </span>
          {it.source && (it.source.composicao_agrupada || it.source.modificadores?.length
            ? <OrderItemComposition item={it.source} className="mt-1.5 text-emerald-700 dark:text-emerald-400" />
            : it.source.observacao && <span className="block whitespace-pre-wrap break-words text-[11px] text-emerald-700 dark:text-emerald-400">{it.source.observacao}</span>)}
        </div>
      ))}
      {itemList.length > 3 && !showAll && (
        <button
          type="button"
          onClick={(e) => onToggle(cardId, e)}
          className={"mt-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:text-emerald-600 dark:text-emerald-300 underline cursor-pointer block transition-all"}
        >
          {isExpanded ? "▲ Recolher itens" : `+ ${hiddenCount} mais itens (expandir)`}
        </button>
      )}
    </div>
  );
};


/** Maintains short-lived arrival feedback without coupling it to operational actions. */
export function CaixaOrdersWorkspace(props: CaixaOrdersWorkspaceProps) {
  const { columns, isLoading, search } = props;
  // Experimental: newest orders first within each existing operational group.
  const dateValue = (value: unknown): number => normalizeOperationalTimestamp(value) ?? 0;
  const tableTime = (card: CashierTableCard) => Math.max(0, ...card.order.itens.map(item => dateValue(item.timestamp)), dateValue(card.order.created_at));
  const digitalTime = (order: DeliveryOrderView) => dateValue(order.created_at || order.criadoEm);
  const filteredCol1 = useMemo(() => [...columns.tableProduction].sort((a, b) => tableTime(b) - tableTime(a)), [columns.tableProduction]);
  const filteredDigitalProduction = useMemo(() => [...columns.digitalProduction].sort((a, b) => digitalTime(b) - digitalTime(a)), [columns.digitalProduction]);
  const filteredCol2Table = useMemo(() => [...columns.tableClosing].sort((a, b) => tableTime(b) - tableTime(a)), [columns.tableClosing]);
  const filteredDeliveryFinalization = useMemo(() => [...columns.digitalFinalization].sort((a, b) => digitalTime(b) - digitalTime(a)), [columns.digitalFinalization]);
  const previousStages = useRef<{ digital: Set<string>; items: Set<string> } | null>(null);
  const [arrivals, setArrivals] = useState<Set<string>>(new Set());
  const arrivalTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(arrivalTimer.current), []);
  useEffect(() => {
    if (isLoading) return;
    const previous = previousStages.current;
    const next = {
      digital: new Set(columns.digitalProduction.map(order => String(order.id))),
      items: new Set(columns.tableProduction.flatMap(({ order }) => order.itens.map(item => String(item.id)))),
    };
    previousStages.current = next;
    if (!previous || search.query.trim()) return;
    const moved = new Set<string>();
    for (const order of columns.digitalFinalization) {
      if (previous.digital.has(String(order.id))) moved.add(`digital:${order.id}`);
    }
    for (const { order } of columns.tableClosing) {
      if (order.itens.some(item => previous.items.has(String(item.id)))) moved.add(`table:${order.id}`);
    }
    if (!moved.size) return;
    setArrivals(moved);

  }, [columns.digitalProduction, columns.digitalFinalization, columns.tableProduction, columns.tableClosing, search.query, isLoading]);
  return <CaixaOrdersWorkspaceView {...props} columns={{
    tableProduction: filteredCol1, digitalProduction: filteredDigitalProduction,
    tableClosing: filteredCol2Table, digitalFinalization: filteredDeliveryFinalization,
  }} arrivals={arrivals} />;
}

/** Stateless rendering boundary; callbacks remain owned by CaixaPanel. */
export function CaixaOrdersWorkspaceView({
  pixConferenceTrigger, columns, pendingCashPayments: pagamentosPendentes, insights: operationalOrderInsights,
  search, acceptance, navigation, couriers, actions, isLoading, now: nowTimestamp,
  hasPrinting = true, hasLocalServiceWork, restaurantConfig, onToast, arrivals = new Set<string>(),
}: CaixaOrdersWorkspaceProps & { arrivals?: ReadonlySet<string> }) {
  const { tableProduction: filteredCol1, digitalProduction: filteredDigitalProduction,
    tableClosing: filteredCol2Table, digitalFinalization: filteredDeliveryFinalization } = columns;
  const { query: searchQuery, onChange: setSearchQuery } = search;
  const { orders: deliveryOrders, pendingOrderIds, automatic: autoAccept, drawerOpen: isDrawerOpen,
    onAutomaticChange: setAutoAccept, onDrawerChange: setIsDrawerOpen } = acceptance;
  const { stage: mobileOrdersStage, onStageChange: setMobileOrdersStage,
    expandedCardIds, onToggleCard: toggleCardExpansion } = navigation;

  const courierSelection = (order: DeliveryOrderView) =>
    couriers.selectedByOrderId[String(order.id)]
      ?? (order.motoboyId ? String(order.motoboyId) : '');

  const courierName = (courierId?: string | number | null) => {
    if (!courierId) return null;
    return couriers.options.find((courier) => String(courier.id) === String(courierId))?.nome || null;
  };

  const renderCourierControl = (order: DeliveryOrderView, orderNumber: string) => {
    if (order.modalidade !== 'delivery' || order.status !== 'pronto') return null;
    const selectedCourierId = courierSelection(order);

    return (
      <div
        className="orders-card__courier-control"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <img src="/brand/cashier/delivery-v1.svg" alt="" width="32" height="32" />
        <div className="orders-card__courier-field">
        <label htmlFor={`courier-${order.id}`}>Entregador</label>
        <select
            id={`courier-${order.id}`}
            aria-label={`Entregador do pedido ${orderNumber}`}
            value={selectedCourierId}
            disabled={couriers.loadState !== 'loaded'}
            onChange={(event) => couriers.onChange(String(order.id), event.target.value)}
            className="orders-card__courier-select"
          >
            <option value="">
              {couriers.loadState === 'loaded' ? 'Selecionar entregador...' : 'Sincronizando entregadores...'}
            </option>
            {couriers.options
              .filter((courier) => courier.ativo !== false || String(courier.id) === selectedCourierId)
              .map((courier) => (
                <option key={courier.id} value={courier.id}>
                  {courier.nome}{courier.ativo === false ? ' (Inativo)' : ''}
                </option>
              ))}
          </select>
        </div>
      </div>
    );
  };

  const latestCardKey = getLatestCashierCardKey([
    ...filteredCol1.map(({ order }) => ({ key: `salon:${order.id}`, timestamps: order.itens.map(item => item.timestamp) })),
    ...filteredDigitalProduction.map(order => ({ key: `digital:${order.id}`, timestamps: [order.created_at] })),
    ...filteredCol2Table.map(({ order }) => ({ key: `closing:${order.id}`, timestamps: order.itens.map(item => item.timestamp) })),
    ...filteredDeliveryFinalization.map(order => ({ key: `finalization:${order.id}`, timestamps: [order.created_at] })),
  ]);
  const renderLatestTag = (key: string) => latestCardKey === key ? (
    <span className="orders-card__recency" data-order-recency="latest">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m8 1 2.2 4.8L15 8l-4.8 2.2L8 15l-2.2-4.8L1 8l4.8-2.2L8 1Z" /></svg>
      Mais recente
    </span>
  ) : null;

  const totalResultadosBusca = filteredCol1.length + filteredDigitalProduction.length + filteredCol2Table.length + filteredDeliveryFinalization.length;

  const activeOrderTypes = restaurantConfig?.tipos_pedido_ativos;
  const compactMarmitaria = (restaurantConfig?.operation_profile === "marmitaria" || hasPrinting === false)
    && Array.isArray(activeOrderTypes) && !activeOrderTypes.includes("consumo_local")
    && !hasLocalServiceWork && filteredCol1.length === 0 && filteredCol2Table.length === 0 && pagamentosPendentes.length === 0;

  const ordersStages = [
    ...(!compactMarmitaria ? [{ id: 'salon' as const, label: 'Salão', count: filteredCol1.length }] : []),
    { id: 'digital' as const, label: compactMarmitaria ? 'Preparo' : 'Digitais', count: filteredDigitalProduction.length },
    { id: 'closing' as const, label: compactMarmitaria ? 'Entrega e recebimento' : 'Concluir', count: filteredCol2Table.length + filteredDeliveryFinalization.length },
  ];
  const effectiveMobileOrdersStage = compactMarmitaria && mobileOrdersStage === "salon" ? "digital" : mobileOrdersStage;
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
    <div className={"orders-workspace flex flex-col space-y-4"}>
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
        <div className={"orders-cash-pending bg-koma-card p-4 rounded-2xl space-y-3"}>
          <div className={"orders-cash-pending__heading flex items-center gap-2"}>
            <AlertTriangle size={14} />
            <span>Confirmação de Dinheiro Pendente ({pagamentosPendentes.length})</span>
          </div>
          <div className={"grid grid-cols-1 md:grid-cols-2 gap-3"}>
            {pagamentosPendentes.map((pag) => {
              const mesaNum = pag.mesaNum;
              return (
                <div key={pag.id} className={"bg-koma-canvas border border-koma-border p-3 rounded-xl flex justify-between items-center gap-4 text-[11px] text-left"}>
                  <div>
                    <span className={"text-koma-subtle block"}>Mesa {mesaNum}</span>
                    <span className={"font-bold text-koma-foreground block"}>{formatCurrency(pag.valor)} em Dinheiro</span>
                    <span className={"text-[9.5px] text-emerald-700 dark:text-emerald-400 block font-mono"}>Garçom solicitante: {pag.nome_cliente || 'Garçom'}</span>
                  </div>
                  <div className={"flex gap-2"}>
                    <button
                      type="button"
                      onClick={() => actions.confirmCashPayment(pag)}
                      className={"px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[9px] uppercase tracking-wider transition-all cursor-pointer"}
                    >
                      Confirmar Recebimento
                    </button>
                    <button
                      type="button"
                      onClick={() => actions.rejectCashPayment(pag)}
                      className={"orders-cash-pending__reject px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer"}
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
      <div className={"orders-toolbar sticky top-0 z-20"}>
        {/* Search Bar Component */}
        <div className={"orders-search relative"}>
          <Search className={"absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-koma-muted"} />
          <input
            type="search"
            aria-label="Buscar pedidos"
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
              className={"sr-only peer"}
              aria-label="Aceitar pedidos online automaticamente"
            />
            <span className="orders-switch" aria-hidden="true"><span /></span>
            <span className="orders-auto-accept__label">Aceite automático<small>{autoAccept ? 'Ativo' : 'Manual'}</small></span>
          </label>
          {pixConferenceTrigger}
          {/* Bell button — opens floating drawer */}
          <button
            type="button"
            onClick={() => { setIsDrawerOpen(true); }}
            className="orders-new-orders"
            aria-haspopup="dialog"
            aria-expanded={isDrawerOpen}
            data-has-orders={deliveryOrders.length > 0}
          >
            <img src="/brand/cashier/inbox-orders-v1.svg" alt="" aria-hidden="true" width="32" height="32" />
            <span>Novos pedidos</span>
            {deliveryOrders.length > 0 && (
              <span className="orders-new-orders__count">
                {deliveryOrders.length}
              </span>
            )}
          </button>
        </div>
      </div>
      {/* ── FLOATING DRAWER: Pedidos Pendentes ─────────────────────────────── */}
      {isDrawerOpen && (
        <div
          className={"fixed inset-0 z-50 flex"}
          onClick={() => setIsDrawerOpen(false)}
        >
          {/* Backdrop */}
          <div className={"absolute inset-0 bg-black/60 backdrop-blur-sm"} />
          {/* Drawer panel */}
          <div
            className={"orders-pending-drawer relative ml-auto h-full w-full max-w-sm bg-koma-panel border-l border-koma-border flex flex-col shadow-2xl"} role="dialog" aria-modal="true" aria-label="Novos pedidos"
            onClick={e => e.stopPropagation()}
            onKeyDown={event => {
              if (event.key === 'Escape') { event.stopPropagation(); setIsDrawerOpen(false); }
              else trapOverlayTab(event);
            }}
          >
            {/* Drawer header */}
            <div className={"flex items-center justify-between px-5 py-4 border-b border-koma-border shrink-0"}>
              <div>
                <h2 className="orders-pending-title">Novos pedidos</h2>
                <p className="orders-pending-subtitle">Confira e aceite</p>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className={"orders-pending-close p-1.5 rounded-lg bg-koma-raised border border-koma-border text-koma-subtle hover:text-koma-foreground cursor-pointer"} aria-label="Fechar novos pedidos" autoFocus
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            {/* Drawer body */}
            <div className={"flex-1 overflow-y-auto p-4 space-y-3"}>
              {deliveryOrders.length === 0 ? (
                <div className={"flex flex-col items-center justify-center h-40 text-koma-muted text-[11px] italic"}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={"mb-3 opacity-40"}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                  Nenhum pedido pendente
                </div>
              ) : (
                deliveryOrders.map((order) => (
                  <div key={order.id} className={"orders-pending-card p-4 rounded-xl space-y-3"}>
                    {digitalOrderEdge(order)}
                    <div className="orders-pending-identity">
                      {digitalOrderMark(order, humanOrderNumber(order), Boolean(getDigitalOrderAssociation(order)))}
                      <div className="orders-pending-person"><strong>{getDigitalOrderCustomerLabel(order)}</strong>
                        {order.telefone && <span>{order.telefone}</span>}
                        {getDigitalOrderAssociation(order) && <span>{getDigitalOrderAssociation(order)}</span>}
                      </div>
                      <strong className="orders-pending-total">{formatCurrency(order.total)}</strong>
                    </div>
                    {order.scheduledFor && (
                      <p className="text-sm font-bold orders-payment-note">
                        Agendado para {formatBackendDateTime(order.scheduledFor)}
                      </p>
                    )}
                    {renderCompactItemsList(order.detailItems?.length ? order.detailItems : order.itens, `pending-${order.id}`, true, toggleCardExpansion)}
                    {order.endereco && (
                      <span className={"text-[10px] text-koma-subtle flex items-start gap-1"}>
                        <MapPin size={11} className={"shrink-0 text-emerald-600 dark:text-emerald-300/80 mt-0.5"} />
                        <span>{order.endereco}</span>
                      </span>
                    )}
                    {order.paymentMethod && (
                      <div className="orders-pending-payment" aria-label="Pagamento do pedido">
                        <CheckoutPaymentArt method={order.paymentMethod.toLowerCase().includes('dinheiro') ? 'dinheiro' : order.paymentMethod.toLowerCase().includes('pix') ? 'pix' : 'cartao_credito'} />
                        <span>{getDigitalOrderPaymentSummary(order)}</span>
                      </div>
                    )}
                    <div className={"flex gap-2 pt-1"}>
                      <button
                        type="button"
                        onClick={() => actions.acceptDigitalOrder(order)}
                        disabled={pendingOrderIds.has(String(order.id))}
                        className="orders-pending-card__accept"
                      >
                        <Check size={16} aria-hidden="true" /> Aceitar
                      </button>
                      <button
                        type="button"
                        onClick={() => actions.rejectDigitalOrder(order)}
                        disabled={pendingOrderIds.has(String(order.id))}
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
      <div className="orders-mobile-stages" style={{ gridTemplateColumns: `repeat(${ordersStages.length}, minmax(0, 1fr))` }} role="tablist" aria-label="Etapa dos pedidos">
        {ordersStages.map(stage => (
          <button
            key={stage.id}
            type="button"
            role="tab"
            aria-selected={effectiveMobileOrdersStage === stage.id}
            onClick={() => setMobileOrdersStage(stage.id)}
            className={clsx('orders-mobile-stages__button', effectiveMobileOrdersStage === stage.id && 'is-active', stage.id === 'closing' && arrivals.size > 0 && 'orders-stage--arrived')}
          >
            <span>{stage.label}</span>
            <strong>{stage.count}</strong>
          </button>
        ))}
      </div>
      {/* Kanban operacional universal: mesas, pedidos online e finalização. */}
      <div
        className={clsx("orders-board flex-1 gap-3 pb-3", compactMarmitaria && "orders-board--marmitaria")}
        style={ordersBoardStyle}
      >
        {/* COLUMN 1: Em produção */}
        {!compactMarmitaria && <div className={clsx('orders-column orders-column--salon flex flex-col overflow-hidden', effectiveMobileOrdersStage === 'salon' && 'is-mobile-active', filteredCol1.length === 0 && 'is-empty')}>
          <CashierColumnHeader kind="salon" title="Salão" count={filteredCol1.length} />
          <div className={"orders-column__body p-2.5 sm:p-3 flex-1 overflow-y-auto space-y-2.5"}>
            {filteredCol1.length === 0 ? (
              <div className={"orders-empty-state py-16 text-center text-koma-subtle text-xs space-y-1"}>
                {!searchQuery && <img src="/brand/cashier/salon-empty-v1.svg" width="144" height="101" alt="" className="orders-empty-state__art mx-auto mb-2" />}
                <p>{searchQuery ? "Nenhum pedido encontrado para a busca" : "Salão sem pedidos em preparo"}</p>
              </div>
            ) : (
              <>
                {filteredCol1.map(({ order, tableMovement, smartPosState, presentation }) => {
                  const preparingItems = deriveProductionState(order.itens).preparingItems;
                  const isPendingConfirmation = String(order.comandaId || order.id || '').startsWith('temp-');
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
                      data-layout="salon"
                      role="button"
                      tabIndex={0}
                      aria-label={`${presentation.title}, ${presentation.subtitle}, ver detalhes`}
                      className={clsx(
                        'orders-card orders-card--salon rounded-xl p-2.5 sm:p-3 space-y-2 text-left cursor-pointer',
                        sla.borderTopClass
                      )}
                    >
                      {renderLatestTag(`salon:${order.id}`)}
                      <div className="orders-card__identity">
                        <div className="orders-card__number is-table">
                          <span className="orders-card__table-label">{order.mesaId > 0 ? 'Mesa' : 'Balcão'}</span>
                          <strong>{order.mesaId > 0 ? String(order.mesaId).padStart(2, '0') : 'B'}</strong>
                        </div>
                        <div className="min-w-0">
                          <strong className="orders-card__identity-title">{presentation.title}</strong>
                          <span className="orders-card__identity-subtitle">{presentation.supportingLabel}</span>
                          <span className={clsx('orders-card__age', sla.badgeClass)}>{sla.label}</span>
                        </div>
                        <div className="orders-card__identity-side">
                          <span className="orders-card__price">{formatCurrency(totalVal)}</span>
                          {hasPrinting !== false ? (
                            <button
                              type="button"
                              disabled={isPendingConfirmation}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isPendingConfirmation) return;
                                actions.printConference(order);
                              }}
                              className="orders-card__icon disabled:opacity-40 disabled:cursor-wait"
                              title={isPendingConfirmation ? 'Aguardando confirmação do pedido' : order.projectionScope === 'launch' ? `Reimprimir ${presentation.title}` : 'Imprimir conferência da mesa'}
                              aria-label={order.projectionScope === 'launch' ? `Reimprimir ${presentation.title}` : `Imprimir conferência de ${presentation.title}`}
                            >
                              <CashierPrintGlyph />
                            </button>
                          ) : (
                            <DigitalReceiptAction
                              compact
                              order={{
                                mesaId: order.mesaId,
                                identificador: presentation.title,
                                itens: order.itens,
                                valorPago: order.valorPago,
                                clientePhone: order.clientePhone,
                              }}
                              restaurantConfig={restaurantConfig}
                              onToast={onToast}
                            />
                          )}
                        </div>
                      </div>
                      {(smartPosState || tableMovement.transferredFromMesaIds.length > 0 || tableMovement.mergedMesaIds.length > 0) && (
                      <div className="orders-card__identity-chips">
                        {smartPosState && (
                          <span className={clsx('orders-card__chip', smartPosState.chipClass)}>{smartPosState.label}</span>
                        )}
                        {tableMovement.transferredFromMesaIds.length > 0 && (
                          <span className={"orders-card__chip is-muted"}>
                            ↪ Transferida da M{tableMovement.transferredFromMesaIds.join(', M')}
                          </span>
                        )}
                        {tableMovement.mergedMesaIds.length > 0 && (
                          <span className={"orders-card__chip is-muted"}>
                            ⛓ Mesclada com M{tableMovement.mergedMesaIds.join(', M')}
                          </span>
                        )}
                      </div>
                      )}
                      {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion, hasPrinting === false)}
                      <button
                        type="button"
                        disabled={isPendingConfirmation}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPendingConfirmation) return;
                          actions.markTableItemsReady(order);
                        }}
                        className={"orders-card__action w-full py-2 px-3 h-8 sm:h-9 font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-wait"}
                      >
                        <Check size={13} />
                        <span>
                          {isPendingConfirmation
                            ? 'Aguardando confirmação…'
                            : preparingItems.length === 1
                              ? 'Marcar item como pronto'
                              : 'Marcar itens como prontos'}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>}
        {/* COLUMN 2: pedidos sem mesa, de venda rápida, delivery ou retirada. */}
        <div className={clsx('orders-column orders-column--digital flex flex-col overflow-hidden', effectiveMobileOrdersStage === 'digital' && 'is-mobile-active', filteredDigitalProduction.length === 0 && 'is-empty')}>
          <CashierColumnHeader kind="digital" title={compactMarmitaria ? "Em preparo" : "Balcão e online"} count={filteredDigitalProduction.length} />
          <div className={"orders-column__body p-2.5 sm:p-3 flex-1 overflow-y-auto space-y-2.5"}>
            {filteredDigitalProduction.length === 0 ? (
              <div className={"orders-empty-state py-16 text-center text-koma-subtle text-xs space-y-1"}>
                <img src="/brand/cashier/order-ticket-v1.svg" width="96" height="72" alt="" className="orders-empty-state__art" />
                <p>{searchQuery ? "Nenhum pedido encontrado para a busca" : "Nenhum pedido online em preparo"}</p>
              </div>
            ) : (
              <>
                {filteredDigitalProduction.map((order) => {
                  const cardId = `sim-prod-${order.id}`;
                  const sla = getOrderSlaData(order, nowTimestamp);
                  const isExpanded = !!expandedCardIds[cardId];
                  const isDeliveryOrder = order.modalidade === 'delivery';
                  const badgeText = deliveryStatusLabel(order.status, order.modalidade);
                  const isMutating = acceptance.pendingOrderIds.has(String(order.id));
                  const selectedCourierId = courierSelection(order);
                  const capability = getDigitalOrderActionCapability(order, {
                    isPendingMutation: isMutating,
                    selectedCourierId,
                    couriersLoaded: couriers.loadState === 'loaded',
                  });
                  const buttonText = capability.label;
                  const tableBlockLabel = getDigitalOrderTableBlockLabel(order);
                  const orderNumber = humanOrderNumber(order);
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
                        `orders-card--fulfillment-${order.modalidade}`,
                        `orders-card--source-${getDigitalOrderVisualKind(order)}`,
                        sla.borderTopClass
                      )}
                    >
                      {renderLatestTag(`digital:${order.id}`)}
                      {digitalOrderEdge(order)}
                      <div className="orders-card__identity">
                        {digitalOrderMark(order, orderNumber, Boolean(tableBlockLabel))}
                        <div className="min-w-0">
                          <strong className="orders-card__identity-title">
                            {order.isQuickSale ? 'Venda rápida' : getDigitalOrderCustomerLabel(order)}
                          </strong>
                          <span className="orders-card__identity-subtitle">
                            {order.isQuickSale
                              ? ''
                              : [getDigitalOrderAssociation(order), order.telefone].filter(Boolean).join(' · ')}
                          </span>
                          <span className={clsx('orders-card__age', sla.badgeClass)}>{sla.label}</span>

                        </div>
                        <div className="orders-card__identity-side orders-card__identity-side--digital">
                          <div className="orders-card__money-actions">
                            <span className="orders-card__price">{formatCurrency(order.total)}</span>
                            {hasPrinting !== false ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); actions.printConference(order); }}
                                className="orders-card__icon"
                                title="Imprimir pré-conta / conferência"
                                aria-label={`Imprimir conferência do pedido ${humanOrderNumber(order)}`}
                              >
                                <CashierPrintGlyph />
                              </button>
                            ) : (
                              <DigitalReceiptAction
                                compact
                                order={{
                                  identificador: getDigitalOrderCustomerLabel(order),
                                  itens: order.itens as any,
                                  numeroPedido: order.numeroPedido,
                                  total: order.total,
                                  clientePhone: order.telefone,
                                }}
                                restaurantConfig={restaurantConfig}
                                onToast={onToast}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="orders-card__identity-chips">
                        <span className="orders-card__state" data-state={order.status}>{badgeText}</span>
                        {!order.partner && <span className={"orders-card__chip is-muted"}>{getDigitalOrderSourceLabel(order)}</span>}
                      </div>
                      {order.scheduledFor && (
                        <p className="text-sm font-bold orders-payment-note">
                          Agendado para {formatBackendDateTime(order.scheduledFor)}
                        </p>
                      )}
                      {isDeliveryOrder && order.endereco && (
                        <div className="orders-card__destination">
                          <MapPin size={16} aria-hidden="true" />
                          <span>{order.endereco}</span>
                        </div>
                      )}
                      {renderCompactItemsList(order.detailItems?.length ? order.detailItems : order.itens, cardId, isExpanded, toggleCardExpansion, hasPrinting === false)}
                      <button
                        type="button"
                        disabled={!capability.isAllowed}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!capability.isAllowed) return;
                          if (capability.action === 'dispatch') actions.dispatchDelivery(String(order.id), selectedCourierId);
                          else actions.advanceDigitalOrder(order);
                        }}
                        className={"orders-card__action w-full py-2 px-3 h-8 sm:h-9 font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"}
                      >
                        <Check size={13} />
                        <span>{buttonText}</span>
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
        {/* COLUMN 3: pagamento e finalização de todas as modalidades. */}
        <div className={clsx('orders-column orders-column--closing flex flex-col overflow-hidden', arrivals.size > 0 && 'orders-column--arrived', effectiveMobileOrdersStage === 'closing' && 'is-mobile-active', filteredCol2Table.length === 0 && filteredDeliveryFinalization.length === 0 && 'is-empty')}>
          <CashierColumnHeader kind="closing" title={compactMarmitaria ? "Entrega e recebimento" : "Prontos e recebimentos"} count={filteredCol2Table.length + filteredDeliveryFinalization.length} />
          <div className={"orders-column__body p-2.5 sm:p-3 flex-1 overflow-y-auto space-y-2.5"}>
            {filteredCol2Table.length === 0 && filteredDeliveryFinalization.length === 0 ? (
              <div className={"orders-empty-state py-16 text-center text-koma-subtle text-xs space-y-1"}>
                <Check size={20} className={"mx-auto opacity-40 mb-2 text-emerald-600 dark:text-emerald-300"} />
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
                  const badgeText = contaPedida ? 'Conta pedida' : 'Pronto para receber';
                  const totalVal = order.itens.reduce((sum: number, it: OrderItem & { preco_unit?: number }) => sum + (it.preco_unit || it.preco || 0), 0);
                  const pendingTableItems = Number(order.itensEmPreparoCount || 0);
                  const readyTableItems = order.itens.filter(item => item.status === 'pronto').length;
                  const totalTableItems = contaPedida ? order.itens.length : readyTableItems + pendingTableItems;
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
                      data-layout="salon"
                      role="button"
                      tabIndex={0}
                      aria-label={`${presentation.title}, ${badgeText.toLowerCase()}, ver detalhes`}
                      className={clsx(
                        'orders-card orders-card--closing rounded-xl p-2.5 sm:p-3 space-y-2 text-left cursor-pointer',
                        arrivals.has(`table:${order.id}`) && 'orders-card--arrived',
                        sla.borderTopClass
                      )}
                    >
                      {renderLatestTag(`closing:${order.id}`)}
                      <div className="orders-card__identity">
                        <div className="orders-card__number is-table">
                          <span className="orders-card__table-label">{order.mesaId > 0 ? 'Mesa' : 'Balcão'}</span>
                          <strong>{order.mesaId > 0 ? String(order.mesaId).padStart(2, '0') : 'B'}</strong>
                        </div>
                        <div className="min-w-0">
                          <strong className="orders-card__identity-title">
                            {presentation.title}
                          </strong>
                          <span className="orders-card__identity-subtitle">
                            {contaPedida
                              ? `Conta solicitada · ${presentation.supportingLabel}`
                              : pendingTableItems > 0
                              ? `${readyTableItems} de ${totalTableItems} ${totalTableItems === 1 ? 'item pronto' : 'itens prontos'} · ${presentation.supportingLabel}`
                              : presentation.supportingLabel}
                          </span>
                          <span className={clsx('orders-card__age', sla.badgeClass)}>{sla.label}</span>
                        </div>
                        <div className="orders-card__identity-side">
                          <span className="orders-card__price" title={pendingTableItems > 0 && !contaPedida ? 'Valor dos itens prontos' : 'Valor a receber'}>{formatCurrency(totalVal)}</span>
                          {hasPrinting !== false ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); actions.printConference(order); }}
                              className="orders-card__icon"
                              title={order.projectionScope === 'launch' ? `Reimprimir ${presentation.title}` : 'Imprimir conferência da mesa'}
                              aria-label={`Imprimir conferência da ${presentation.title}`}
                            >
                              <CashierPrintGlyph />
                            </button>
                          ) : (
                            <DigitalReceiptAction
                              compact
                              order={{
                                mesaId: order.mesaId,
                                identificador: presentation.title,
                                itens: order.itens,
                                valorPago: order.valorPago,
                                clientePhone: order.clientePhone,
                              }}
                              restaurantConfig={restaurantConfig}
                              onToast={onToast}
                            />
                          )}
                        </div>
                      </div>
                      {Number(order.valorPago || 0) > 0 && (
                        <div className="orders-card__paid" aria-label={`Já recebido ${formatCurrency(Number(order.valorPago))}`}>
                          <Check size={13} aria-hidden="true" /> Já recebido {formatCurrency(Number(order.valorPago))}
                        </div>
                      )}
                      {pendingTableItems > 0 && (
                        <div className="orders-card__partial flex items-center gap-2 rounded-lg border border-koma-warning-border bg-koma-warning-bg px-2.5 py-2 text-[11px] font-semibold text-koma-warning-text">
                          <Clock size={13} className="shrink-0" />
                          <span>
                            {pendingTableItems === 1 ? 'Outro item continua em preparo.' : `Outros ${pendingTableItems} itens continuam em preparo.`}
                          </span>
                        </div>
                      )}
                      <div className="orders-card__identity-chips">
                        <span className="orders-card__state" data-state={contaPedida ? "bill" : "ready"}>{badgeText}</span>
                        {smartPosState && (
                          <span className={clsx('orders-card__chip', smartPosState.chipClass)}>{smartPosState.label}</span>
                        )}
                        {tableMovement.transferredFromMesaIds.length > 0 && (
                          <span className={"orders-card__chip is-muted"}>
                            ↪ Transferida da M{tableMovement.transferredFromMesaIds.join(', M')}
                          </span>
                        )}
                        {tableMovement.mergedMesaIds.length > 0 && (
                          <span className={"orders-card__chip is-muted"}>
                            ⛓ Mesclada com M{tableMovement.mergedMesaIds.join(', M')}
                          </span>
                        )}
                      </div>
                      {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion, hasPrinting === false)}
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={(e) => { e.stopPropagation(); actions.openTablePayment(order); }}
                        className={"orders-card__action w-full py-2 px-3 h-8 sm:h-9 font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5"}
                      >
                        {smartPosState?.blocksPayment ? (
                          <><Smartphone size={13} /><span>{smartPosState.ctaLabel}</span></>
                        ) : (
                          <><Check size={13} /><span>{pendingTableItems > 0 && !contaPedida ? 'Receber itens prontos' : 'Abrir pagamento'}</span></>
                        )}
                      </button>
                    </div>
                  );
                })}
                {/* 2. Pedidos digitais prontos ou em trânsito. */}
                {filteredDeliveryFinalization.map((order) => {
                  const cardId = `transito-${order.id}`;
                  const sla = getOrderSlaData(order, nowTimestamp);
                  const isExpanded = !!expandedCardIds[cardId];
                  const isDeliveryOrder = order.modalidade === 'delivery';
                  const isReadyDelivery = isDeliveryOrder && order.status === 'pronto';
                  const selectedCourierId = courierSelection(order);
                  const isMutating = acceptance.pendingOrderIds.has(String(order.id));
                  const capability = getDigitalOrderActionCapability(order, {
                    isPendingMutation: isMutating,
                    selectedCourierId,
                    couriersLoaded: couriers.loadState === 'loaded',
                  });
                  const badgeText = order.pago
                    ? 'Pago'
                    : deliveryStatusLabel(order.status, order.modalidade);
                  const tableBlockLabel = getDigitalOrderTableBlockLabel(order);
                  const orderNumber = humanOrderNumber(order);
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
                        arrivals.has(`digital:${order.id}`) && 'orders-card--arrived',
                        order.isQuickSale && 'orders-card--quick-sale',
                        `orders-card--fulfillment-${order.modalidade}`,
                        `orders-card--source-${getDigitalOrderVisualKind(order)}`,
                        sla.borderTopClass
                      )}
                    >
                      {renderLatestTag(`finalization:${order.id}`)}
                      {digitalOrderEdge(order)}
                      <div className="orders-card__identity">
                        {digitalOrderMark(order, orderNumber, Boolean(tableBlockLabel))}
                        <div className="min-w-0">
                          <strong className="orders-card__identity-title">
                            {order.isQuickSale ? 'Venda rápida' : getDigitalOrderCustomerLabel(order)}
                          </strong>
                          <span className="orders-card__identity-subtitle">
                            {order.isQuickSale
                              ? ''
                              : [getDigitalOrderAssociation(order), order.telefone].filter(Boolean).join(' · ')}
                          </span>
                          <span className={clsx('orders-card__age', sla.badgeClass)}>{sla.label}</span>

                        </div>
                        <div className="orders-card__identity-side orders-card__identity-side--digital">
                          <div className="orders-card__money-actions">
                            <span className="orders-card__price">{formatCurrency(order.total)}</span>
                            {hasPrinting !== false ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); actions.printConference(order); }}
                                className="orders-card__icon"
                                title="Imprimir pré-conta / conferência"
                                aria-label={`Imprimir conferência do pedido ${humanOrderNumber(order)}`}
                              >
                                <CashierPrintGlyph />
                              </button>
                            ) : (
                              <DigitalReceiptAction
                                compact
                                order={{
                                  identificador: getDigitalOrderCustomerLabel(order),
                                  itens: order.itens as any,
                                  numeroPedido: order.numeroPedido,
                                  total: order.total,
                                  clientePhone: order.telefone,
                                }}
                                restaurantConfig={restaurantConfig}
                                onToast={onToast}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                      {Number(order.amountPaid || 0) > 0 && Number(order.amountDue || 0) > 0 && (
                        <div className="orders-card__paid"><Check size={13} aria-hidden="true" /> Já recebido {formatCurrency(Number(order.amountPaid))} · Falta {formatCurrency(Number(order.amountDue))}</div>
                      )}
                      <div className="orders-card__identity-chips">
                        <span className="orders-card__state" data-state={order.status}>{badgeText}</span>
                        {!order.partner && <span className={"orders-card__chip is-muted"}>{getDigitalOrderSourceLabel(order)}</span>}
                      </div>
                      {order.scheduledFor && (
                        <p className="text-sm font-bold orders-payment-note">
                          Agendado para {formatBackendDateTime(order.scheduledFor)}
                        </p>
                      )}
                      {isDeliveryOrder && order.endereco && (
                        <div className="orders-card__destination">
                          <MapPin size={16} aria-hidden="true" />
                          <span>{order.endereco}</span>
                        </div>
                      )}
                      {renderCompactItemsList(order.detailItems?.length ? order.detailItems : order.itens, cardId, isExpanded, toggleCardExpansion, hasPrinting === false)}
                      {renderCourierControl(order, orderNumber)}
                      {isDeliveryOrder && !isReadyDelivery && order.motoboyId && (
                        <span className="text-xs text-koma-subtle">Entregador: {courierName(order.motoboyId) || `#${order.motoboyId}`}</span>
                      )}
                      <button
                        type="button"
                        disabled={!capability.isAllowed}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!capability.isAllowed) return;
                          if (capability.action === 'dispatch') actions.dispatchDelivery(String(order.id), selectedCourierId);
                          else if (capability.action === 'finalize') actions.finalizeDigitalOrder(order);
                        }}
                        className={"orders-card__action w-full py-2 px-3 h-8 sm:h-9 font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"}
                      >
                        <Check size={13} />
                        <span>{capability.label}</span>
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
