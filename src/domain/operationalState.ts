import type { Order, OrderItem, Table } from '../types';
import { formatElapsedTime, normalizeOperationalTimestamp } from './operationalTime';
import { getOrderCheckId, getOrderDisplayNumber } from './orderIdentity';

export interface ProductionProjection<T extends Pick<OrderItem, 'status'> = OrderItem> {
  activeItems: T[];
  preparingItems: T[];
  readyItems: T[];
  deliveredItems: T[];
  activeItemCount: number;
  preparingItemCount: number;
  readyItemCount: number;
  deliveredItemCount: number;
  hasPreparingItems: boolean;
  hasReadyItems: boolean;
  /** Nonempty and literally all ready, not merely all already served. */
  allItemsReady: boolean;
}

export type ServiceState = 'OPEN' | 'SERVED';

/**
 * The current read contract exposes null | aguardando_pagamento only.
 * It does not establish PAID from fechada, delivery status or Item.pago.
 */
export type FinancialState = 'OPEN' | 'AWAITING_PAYMENT';

export interface FinancialSignals {
  tableStatus?: string;
  /** An explicit pending-payment record/signal, never item readiness. */
  hasPendingPayment?: boolean;
}

export interface PendingPaymentReference {
  comanda_id?: string | number;
}

type OperationalOrder = Order & { comandaId?: string };

export interface OperationalTimestampSource {
  aberta_em?: unknown;
  data_abertura?: unknown;
  aberto_em?: unknown;
  created_at?: unknown;
  timestamp?: unknown;
  criadoEm?: unknown;
}

export interface OperationalElapsedTime {
  timestamp: number | null;
  minutes: number | null;
  formatted: string;
}

const normalized = (value: unknown): string => String(value || '').trim().toLowerCase();

/** Existing salon visibility rule; terminal visibility is not financial PAID. */
export function isActiveOperationalOrder(order: Pick<Order, 'status'>): boolean {
  return !['fechada', 'fechado', 'cancelada', 'cancelado', 'finalizada', 'finalizado'].includes(normalized(order.status));
}

/** Accept the existing items alias at the read boundary without mutating it. */
export function getOrderItems(order: Pick<Order, 'itens' | 'items'>): OrderItem[] {
  return Array.isArray(order.itens) ? order.itens : Array.isArray(order.items) ? order.items : [];
}

export function deriveProductionState<T extends Pick<OrderItem, 'status'>>(items: readonly T[]): ProductionProjection<T> {
  const activeItems: T[] = [];
  const preparingItems: T[] = [];
  const readyItems: T[] = [];
  const deliveredItems: T[] = [];
  for (const item of items) {
    if (item.status === 'cancelado') continue;
    activeItems.push(item);
    if (item.status === 'preparando') preparingItems.push(item);
    if (item.status === 'pronto') readyItems.push(item);
    if (item.status === 'entregue') deliveredItems.push(item);
  }
  const activeItemCount = activeItems.length;
  const preparingItemCount = preparingItems.length;
  const readyItemCount = readyItems.length;
  const deliveredItemCount = deliveredItems.length;
  return {
    activeItems,
    preparingItems,
    readyItems,
    deliveredItems,
    activeItemCount,
    preparingItemCount,
    readyItemCount,
    deliveredItemCount,
    hasPreparingItems: preparingItemCount > 0,
    hasReadyItems: readyItemCount > 0,
    allItemsReady: activeItemCount > 0 && readyItemCount === activeItemCount,
  };
}

function deriveServiceState(production: ProductionProjection<Pick<OrderItem, 'status'>>): ServiceState {
  return production.activeItemCount > 0 && production.deliveredItemCount === production.activeItemCount
    ? 'SERVED'
    : 'OPEN';
}

export function deriveFinancialState(
  orders: readonly Pick<Order, 'statusComanda'>[],
  signals: FinancialSignals = {},
): FinancialState {
  const requested = ['aguardando_pagamento', 'para_receber'].includes(normalized(signals.tableStatus))
    || orders.some(order => normalized(order.statusComanda) === 'aguardando_pagamento');
  return requested || signals.hasPendingPayment ? 'AWAITING_PAYMENT' : 'OPEN';
}

/** Uses a caller-supplied clock, including HH:mm legacy timestamp parsing. */
export function deriveOperationalElapsedTime(raw: unknown, now: number): OperationalElapsedTime {
  const timestamp = normalizeOperationalTimestamp(raw, now);
  return {
    timestamp,
    minutes: timestamp === null ? null : Math.max(0, Math.floor((now - timestamp) / 60_000)),
    formatted: formatElapsedTime(timestamp, now),
  };
}

/** Preserve creation/opening precedence. Updated-at never resets service age. */
export function getOrderOperationalTimestamp(order: OperationalTimestampSource, now: number): number | null {
  const raw = order.aberta_em
    || order.data_abertura
    || order.aberto_em
    || order.created_at
    || order.timestamp
    || order.criadoEm;
  return normalizeOperationalTimestamp(raw, now);
}

export function getFirstOrderTimestamp(orders: readonly OperationalTimestampSource[], now: number): number | undefined {
  let oldest: number | undefined;
  for (const order of orders) {
    const timestamp = getOrderOperationalTimestamp(order, now);
    if (timestamp !== null && (oldest === undefined || timestamp < oldest)) oldest = timestamp;
  }
  return oldest;
}

export function deriveOrderOperationalState(order: OperationalOrder, now: number) {
  const production = deriveProductionState(getOrderItems(order));
  const firstOrderTimestamp = getOrderOperationalTimestamp(order, now) ?? undefined;
  return {
    checkId: getOrderCheckId(order),
    lancamentoId: order.lancamentoId,
    displayNumber: getOrderDisplayNumber(order),
    checkNumber: order.numeroPedido,
    production,
    service: deriveServiceState(production),
    financial: deriveFinancialState([order]),
    // Existing delivery status is preserved, not inferred from item/payment state.
    deliveryStatus: order.deliveryStatus,
    firstOrderTimestamp,
    elapsed: formatElapsedTime(firstOrderTimestamp, now),
  };
}

export interface TableOperationalInput {
  table: Table;
  /** Checks already scoped to this table (or its merged destination). */
  orders: readonly OperationalOrder[];
  pendingPayments?: readonly PendingPaymentReference[];
  hasPendingPayment?: boolean;
  mergedIntoMesaId?: number | null;
  now: number;
}

export function deriveTableOperationalState({
  table,
  orders,
  pendingPayments = [],
  hasPendingPayment = false,
  mergedIntoMesaId = null,
  now,
}: TableOperationalInput) {
  const production = deriveProductionState(orders.flatMap(getOrderItems));
  const hasOperationalStatus = [
    'ocupada', 'ocupado', 'pronta', 'pronto', 'aguardando_pagamento', 'para_receber',
  ].includes(normalized(table.status));
  const hasPaymentRequest = deriveFinancialState(orders, { tableStatus: table.status }) === 'AWAITING_PAYMENT';
  const checkIds = new Set(orders.map(order => String(getOrderCheckId(order))));
  const hasPendingConfirmation = hasPendingPayment || pendingPayments.some(payment => (
    payment.comanda_id !== undefined && checkIds.has(String(payment.comanda_id))
  ));
  const financial = deriveFinancialState(orders, {
    tableStatus: table.status,
    hasPendingPayment: hasPendingConfirmation,
  });
  const firstOrderTimestamp = getFirstOrderTimestamp(orders, now);
  return {
    occupancy: orders.length > 0 || hasOperationalStatus ? 'IN_SERVICE' as const : 'FREE' as const,
    production,
    service: deriveServiceState(production),
    financial,
    hasPaymentRequest,
    hasPendingConfirmation,
    // Compatibility for existing filters; the underlying signals remain separate.
    hasPendingPayment: financial === 'AWAITING_PAYMENT',
    mergedIntoMesaId,
    firstOrderTimestamp,
    elapsed: formatElapsedTime(firstOrderTimestamp, now),
  };
}

export type TableOperationalProjection = ReturnType<typeof deriveTableOperationalState>;
export type OrderOperationalProjection = ReturnType<typeof deriveOrderOperationalState>;
