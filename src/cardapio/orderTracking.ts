/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const ACTIVE_ORDERS_STORAGE_KEY = "koma_active_orders";
export const LEGACY_ACTIVE_ORDER_STORAGE_KEY = "koma_active_order";
export const ACTIVE_ORDER_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

export type CanonicalOrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "dispatched"
  | "completed"
  | "rejected"
  | "cancelled";

export type OrderPhase =
  | "payment_pending"
  | "scheduled"
  | "received"
  | "preparing"
  | "ready"
  | "dispatched"
  | "completed"
  | "rejected"
  | "cancelled";

export type CanonicalFulfillment = "dine_in" | "pickup" | "delivery";

export interface OrderStateContract {
  status: CanonicalOrderStatus;
  phase: OrderPhase;
  label: string;
  fulfillment: CanonicalFulfillment;
  terminal: boolean;
  rejected: boolean;
  can_chat: boolean;
  can_cancel: boolean;
  progress_step: number;
  progress_total: number;
}

export interface StoredOrderItem {
  id?: string;
  nome: string;
  quantidade: number;
  observacao?: string;
}

export interface StoredOrder {
  id: string; // comanda_id
  numero_pedido: string | number;
  timestamp: number;
  restaurante_id: number;
  cliente_nome?: string;
  cliente_telefone?: string;
  tipo: string;
  total: number;
  idempotency_key: string;
  status?: string;
  state?: OrderStateContract;
  fechado?: boolean;
  itens?: StoredOrderItem[];
  created_at?: string;
  tracking_token?: string;
  tracking_url?: string;
}

const STATUS_ALIASES: Record<string, CanonicalOrderStatus> = {
  pendente: "pending",
  analise: "pending",
  recebido: "pending",
  pending: "pending",
  aceito: "accepted",
  accepted: "accepted",
  producao: "preparing",
  preparando: "preparing",
  em_preparo: "preparing",
  preparing: "preparing",
  pronto: "ready",
  ready: "ready",
  transito: "dispatched",
  saiu_entrega: "dispatched",
  dispatched: "dispatched",
  finalizado: "completed",
  concluido: "completed",
  "concluído": "completed",
  entregue: "completed",
  completed: "completed",
  recusado: "rejected",
  rejected: "rejected",
  cancelado: "cancelled",
  cancelled: "cancelled",
};

const TERMINAL = new Set<CanonicalOrderStatus>(["completed", "rejected", "cancelled"]);
const REJECTED = new Set<CanonicalOrderStatus>(["rejected", "cancelled"]);

export function normalizeOrderStatus(value: string | undefined): string {
  return (value || "").trim().toLocaleLowerCase("pt-BR");
}

function fulfillmentFromType(value?: string): CanonicalFulfillment {
  const normalized = (value || "").trim().toLocaleLowerCase("pt-BR");
  if (["delivery", "entrega"].includes(normalized)) return "delivery";
  if (["retirada", "viagem", "balcao", "balcão", "pickup"].includes(normalized)) return "pickup";
  return "dine_in";
}

function phaseFor(status: CanonicalOrderStatus, rawStatus: string): OrderPhase {
  if (rawStatus === "aguardando_pagamento") return "payment_pending";
  if (rawStatus === "agendado") return "scheduled";
  return {
    pending: "received",
    accepted: "preparing",
    preparing: "preparing",
    ready: "ready",
    dispatched: "dispatched",
    completed: "completed",
    rejected: "rejected",
    cancelled: "cancelled",
  }[status] as OrderPhase;
}

function labelFor(phase: OrderPhase): string {
  return {
    payment_pending: "Aguardando pagamento",
    scheduled: "Pedido agendado",
    received: "Aguardando aceite",
    preparing: "Em preparo",
    ready: "Pronto",
    dispatched: "Saiu para entrega",
    completed: "Concluído",
    rejected: "Pedido não aceito",
    cancelled: "Pedido cancelado",
  }[phase];
}

function progressFor(phase: OrderPhase, fulfillment: CanonicalFulfillment): [number, number] {
  const total = fulfillment === "delivery" ? 5 : 4;
  if (phase === "rejected" || phase === "cancelled") return [0, total];
  if (phase === "payment_pending" || phase === "scheduled" || phase === "received") return [1, total];
  if (phase === "preparing") return [2, total];
  if (phase === "ready") return [3, total];
  if (phase === "dispatched") return [fulfillment === "delivery" ? 4 : 3, total];
  return [total, total];
}

export function fallbackOrderState(status?: string, tipo?: string): OrderStateContract {
  const rawStatus = normalizeOrderStatus(status);
  const canonical = STATUS_ALIASES[rawStatus] || "pending";
  const fulfillment = fulfillmentFromType(tipo);
  const phase = phaseFor(canonical, rawStatus);
  const [progress_step, progress_total] = progressFor(phase, fulfillment);
  const terminal = TERMINAL.has(canonical);
  const rejected = REJECTED.has(canonical);
  return {
    status: canonical,
    phase,
    label: labelFor(phase),
    fulfillment,
    terminal,
    rejected,
    can_chat: !terminal,
    can_cancel: false,
    progress_step,
    progress_total,
  };
}

export function isOrderStateContract(value: unknown): value is OrderStateContract {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OrderStateContract>;
  return (
    typeof candidate.status === "string" &&
    typeof candidate.phase === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.fulfillment === "string" &&
    typeof candidate.terminal === "boolean" &&
    typeof candidate.rejected === "boolean" &&
    typeof candidate.can_chat === "boolean" &&
    typeof candidate.can_cancel === "boolean" &&
    Number.isFinite(candidate.progress_step) &&
    Number.isFinite(candidate.progress_total)
  );
}

export function resolveOrderState(
  order: Pick<StoredOrder, "status" | "tipo" | "state">,
): OrderStateContract {
  return isOrderStateContract(order.state)
    ? order.state
    : fallbackOrderState(order.status, order.tipo);
}

// Wrappers legados centralizados. Não fazem mais parsing por substring.
export function isTerminalStatus(status: string | undefined): boolean {
  return fallbackOrderState(status).terminal;
}

export function isRejectedStatus(status: string | undefined): boolean {
  return fallbackOrderState(status).rejected;
}

export function orderStatusLabel(status: string | undefined): string {
  return fallbackOrderState(status).label;
}

export function orderStep(status: string | undefined): number {
  return fallbackOrderState(status).progress_step;
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Carrega todos os pedidos armazenados localmente, unificando a chave moderna
 * de múltiplos pedidos (`koma_active_orders`) e o fallback legado (`koma_active_order`).
 */
export function loadStoredOrders(restaurantId?: number): StoredOrder[] {
  const now = Date.now();
  const ordersMap = new Map<string, StoredOrder>();

  const rawList = safeParseJson<StoredOrder[]>(
    typeof localStorage !== "undefined"
      ? localStorage.getItem(ACTIVE_ORDERS_STORAGE_KEY)
      : null,
  );
  if (Array.isArray(rawList)) {
    rawList.forEach((order) => {
      if (
        order?.id &&
        order.idempotency_key &&
        now - Number(order.timestamp || 0) <= ACTIVE_ORDER_TTL_MS
      ) {
        ordersMap.set(String(order.id), {
          ...order,
          id: String(order.id),
          numero_pedido: order.numero_pedido ?? order.id,
          timestamp: Number(order.timestamp || now),
          restaurante_id: Number(order.restaurante_id),
          tipo: String(order.tipo || "Retirada"),
          total: Number(order.total || 0),
          status: String(order.status || "pendente"),
          state: isOrderStateContract(order.state) ? order.state : undefined,
          tracking_token: order.tracking_token ? String(order.tracking_token) : undefined,
          tracking_url: order.tracking_url ? String(order.tracking_url) : undefined,
        });
      }
    });
  }

  const rawLegacy = safeParseJson<StoredOrder>(
    typeof localStorage !== "undefined"
      ? localStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY)
      : null,
  );
  if (
    rawLegacy?.id &&
    rawLegacy.idempotency_key &&
    now - Number(rawLegacy.timestamp || 0) <= ACTIVE_ORDER_TTL_MS
  ) {
    const id = String(rawLegacy.id);
    if (!ordersMap.has(id)) {
      ordersMap.set(id, {
        ...rawLegacy,
        id,
        numero_pedido: rawLegacy.numero_pedido ?? id,
        timestamp: Number(rawLegacy.timestamp || now),
        restaurante_id: Number(rawLegacy.restaurante_id),
        tipo: String(rawLegacy.tipo || "Retirada"),
        total: Number(rawLegacy.total || 0),
        status: String(rawLegacy.status || "pendente"),
        state: isOrderStateContract(rawLegacy.state) ? rawLegacy.state : undefined,
        tracking_token: rawLegacy.tracking_token ? String(rawLegacy.tracking_token) : undefined,
        tracking_url: rawLegacy.tracking_url ? String(rawLegacy.tracking_url) : undefined,
      });
    }
  }

  let list = Array.from(ordersMap.values());
  if (typeof restaurantId === "number" && Number.isFinite(restaurantId)) {
    list = list.filter((item) => item.restaurante_id === restaurantId);
  }
  return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export function saveStoredOrder(order: StoredOrder): void {
  if (typeof localStorage === "undefined" || !order?.id) return;

  const current = loadStoredOrders();
  const filtered = current.filter((item) => item.id !== order.id);
  const updatedList = [order, ...filtered].slice(0, 20);

  try {
    localStorage.setItem(ACTIVE_ORDERS_STORAGE_KEY, JSON.stringify(updatedList));
  } catch (error) {
    console.warn("Falha ao salvar koma_active_orders:", error);
  }

  try {
    const latestActive = updatedList.find((item) => !resolveOrderState(item).terminal) || updatedList[0];
    if (latestActive) {
      localStorage.setItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY, JSON.stringify(latestActive));
    }
  } catch (error) {
    console.warn("Falha ao sincronizar koma_active_order:", error);
  }
}

export function updateStoredOrderStatus(
  orderId: string,
  updates: Partial<StoredOrder>,
): void {
  if (typeof localStorage === "undefined" || !orderId) return;

  const current = loadStoredOrders();
  const index = current.findIndex((item) => item.id === orderId);
  if (index === -1) return;

  const updatedOrder = { ...current[index], ...updates };
  current[index] = updatedOrder;

  try {
    localStorage.setItem(ACTIVE_ORDERS_STORAGE_KEY, JSON.stringify(current));
  } catch (error) {
    console.warn("Falha ao atualizar status em koma_active_orders:", error);
  }

  try {
    const legacy = safeParseJson<StoredOrder>(localStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY));
    if (legacy?.id === orderId) {
      localStorage.setItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY, JSON.stringify(updatedOrder));
    }
  } catch (error) {
    console.warn("Falha ao atualizar koma_active_order:", error);
  }
}

export function removeStoredOrder(orderId: string): void {
  if (typeof localStorage === "undefined" || !orderId) return;

  const current = loadStoredOrders();
  const filtered = current.filter((item) => item.id !== orderId);

  try {
    localStorage.setItem(ACTIVE_ORDERS_STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.warn("Falha ao remover de koma_active_orders:", error);
  }

  try {
    const legacy = safeParseJson<StoredOrder>(localStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY));
    if (legacy?.id === orderId) {
      const nextActive = filtered.find((item) => !resolveOrderState(item).terminal) || filtered[0];
      if (nextActive) {
        localStorage.setItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY, JSON.stringify(nextActive));
      } else {
        localStorage.removeItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY);
      }
    }
  } catch (error) {
    console.warn("Falha ao remover de koma_active_order:", error);
  }
}

export function clearAllStoredOrders(restaurantId?: number): void {
  if (typeof localStorage === "undefined") return;

  if (typeof restaurantId === "number" && Number.isFinite(restaurantId)) {
    const current = loadStoredOrders();
    const remaining = current.filter((item) => item.restaurante_id !== restaurantId);
    try {
      localStorage.setItem(ACTIVE_ORDERS_STORAGE_KEY, JSON.stringify(remaining));
    } catch {
      // Ignora erro
    }
    const legacy = safeParseJson<StoredOrder>(localStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY));
    if (legacy && legacy.restaurante_id === restaurantId) {
      localStorage.removeItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY);
    }
    return;
  }

  try {
    localStorage.removeItem(ACTIVE_ORDERS_STORAGE_KEY);
    localStorage.removeItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY);
  } catch {
    // Ignora erro
  }
}

export async function fetchOrderLiveStatus(
  order: StoredOrder,
  apiBaseUrl: string,
): Promise<StoredOrder | null> {
  const key = String(order.idempotency_key || "").trim();
  const url = order.tracking_token
    ? `${apiBaseUrl}/api/cardapio/pedidos/acompanhar/${encodeURIComponent(order.tracking_token)}`
    : `${apiBaseUrl}/cardapio/pedidos/${encodeURIComponent(order.id)}/status?key=${encodeURIComponent(key)}`;

  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) return order;

  const data = await response.json();
  const rawStatus = String(data.status || order.status || "pendente");
  const tipo = String(data.tipo || order.tipo || "Retirada");
  const isClosed = Boolean(data.fechada || data.fechado || data.closed_at);
  const backendState = isOrderStateContract(data.state)
    ? data.state
    : fallbackOrderState(rawStatus, tipo);
  const shouldForceCompleted = isClosed && !backendState.rejected && !backendState.terminal;
  const finalStatus = shouldForceCompleted ? "finalizado" : rawStatus;
  const finalState = shouldForceCompleted
    ? fallbackOrderState("finalizado", tipo)
    : backendState;

  return {
    ...order,
    id: String(data.id || order.id),
    numero_pedido: data.numero_pedido ?? order.numero_pedido,
    status: finalStatus,
    state: finalState,
    tipo,
    total: Number(data.total ?? order.total ?? 0),
    fechado: isClosed,
    created_at: data.criado_em || order.created_at,
    itens: Array.isArray(data.itens) ? data.itens : order.itens,
  };
}

export async function refreshAllStoredOrders(
  restaurantId: number,
  apiBaseUrl: string,
): Promise<StoredOrder[]> {
  const storedList = loadStoredOrders(restaurantId);
  if (storedList.length === 0) return [];

  const results = await Promise.allSettled(
    storedList.map((order) => fetchOrderLiveStatus(order, apiBaseUrl)),
  );

  const updatedList: StoredOrder[] = [];
  results.forEach((res, index) => {
    const original = storedList[index];
    if (res.status === "fulfilled") {
      const live = res.value;
      if (live === null) {
        removeStoredOrder(original.id);
      } else {
        updateStoredOrderStatus(live.id, live);
        updatedList.push(live);
      }
    } else {
      updatedList.push(original);
    }
  });

  return updatedList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}
