/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const ACTIVE_ORDERS_STORAGE_KEY = "koma_active_orders";
export const LEGACY_ACTIVE_ORDER_STORAGE_KEY = "koma_active_order";
export const ACTIVE_ORDER_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

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
  fechado?: boolean;
  itens?: StoredOrderItem[];
  created_at?: string;
}

export function normalizeOrderStatus(value: string | undefined): string {
  return (value || "").trim().toLocaleLowerCase("pt-BR");
}

export function isTerminalStatus(status: string | undefined): boolean {
  const normalized = normalizeOrderStatus(status);
  return ["finalizado", "entregue", "recusado", "cancelado"].some((item) =>
    normalized.includes(item),
  );
}

export function isRejectedStatus(status: string | undefined): boolean {
  const normalized = normalizeOrderStatus(status);
  return normalized.includes("recus") || normalized.includes("cancel");
}

export function orderStatusLabel(status: string | undefined): string {
  const normalized = normalizeOrderStatus(status);
  if (normalized.includes("recus") || normalized.includes("cancel")) {
    return "Pedido não aceito";
  }
  if (normalized.includes("final") || normalized.includes("entreg")) {
    return "Concluído";
  }
  if (normalized.includes("trans") || normalized.includes("saiu")) {
    return "Saiu para entrega";
  }
  if (normalized.includes("pronto")) {
    return "Pronto";
  }
  if (normalized.includes("produ") || normalized.includes("prepar")) {
    return "Em preparo";
  }
  return "Aguardando aceite";
}

export function orderStep(status: string | undefined): number {
  const normalized = normalizeOrderStatus(status);
  if (normalized.includes("final") || normalized.includes("entreg")) return 4;
  if (
    normalized.includes("trans") ||
    normalized.includes("saiu") ||
    normalized.includes("pronto")
  ) {
    return 3;
  }
  if (normalized.includes("produ") || normalized.includes("prepar")) return 2;
  return 1;
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

  // 1. Carrega da chave de múltiplos pedidos
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
        });
      }
    });
  }

  // 2. Carrega da chave legada (caso ainda exista e não esteja na lista)
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
      });
    }
  }

  let list = Array.from(ordersMap.values());

  if (typeof restaurantId === "number" && Number.isFinite(restaurantId)) {
    list = list.filter((item) => item.restaurante_id === restaurantId);
  }

  // Ordena do mais recente para o mais antigo
  return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/**
 * Salva ou atualiza um pedido no armazenamento local e sincroniza a chave legada.
 */
export function saveStoredOrder(order: StoredOrder): void {
  if (typeof localStorage === "undefined" || !order?.id) return;

  const current = loadStoredOrders(); // Carrega todos os restaurantes
  const filtered = current.filter((item) => item.id !== order.id);
  const updatedList = [order, ...filtered].slice(0, 20); // Mantém até 20 pedidos recentes

  try {
    localStorage.setItem(
      ACTIVE_ORDERS_STORAGE_KEY,
      JSON.stringify(updatedList),
    );
  } catch (error) {
    console.warn("Falha ao salvar koma_active_orders:", error);
  }

  // Sincroniza a chave legada com o pedido ativo mais relevante
  try {
    const latestActive =
      updatedList.find((item) => !isTerminalStatus(item.status)) ||
      updatedList[0];
    if (latestActive) {
      localStorage.setItem(
        LEGACY_ACTIVE_ORDER_STORAGE_KEY,
        JSON.stringify(latestActive),
      );
    }
  } catch (error) {
    console.warn("Falha ao sincronizar koma_active_order:", error);
  }
}

/**
 * Atualiza campos específicos de um pedido armazenado.
 */
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

  // Atualiza chave legada se for o mesmo pedido
  try {
    const legacy = safeParseJson<StoredOrder>(
      localStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY),
    );
    if (legacy?.id === orderId) {
      localStorage.setItem(
        LEGACY_ACTIVE_ORDER_STORAGE_KEY,
        JSON.stringify(updatedOrder),
      );
    }
  } catch (error) {
    console.warn("Falha ao atualizar koma_active_order:", error);
  }
}

/**
 * Remove um pedido do armazenamento local.
 */
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
    const legacy = safeParseJson<StoredOrder>(
      localStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY),
    );
    if (legacy?.id === orderId) {
      const nextActive = filtered.find((item) => !isTerminalStatus(item.status)) || filtered[0];
      if (nextActive) {
        localStorage.setItem(
          LEGACY_ACTIVE_ORDER_STORAGE_KEY,
          JSON.stringify(nextActive),
        );
      } else {
        localStorage.removeItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY);
      }
    }
  } catch (error) {
    console.warn("Falha ao remover de koma_active_order:", error);
  }
}

/**
 * Limpa todos os pedidos de um restaurante ou de todos os restaurantes.
 */
export function clearAllStoredOrders(restaurantId?: number): void {
  if (typeof localStorage === "undefined") return;

  if (typeof restaurantId === "number" && Number.isFinite(restaurantId)) {
    const current = loadStoredOrders();
    const remaining = current.filter(
      (item) => item.restaurante_id !== restaurantId,
    );
    try {
      localStorage.setItem(
        ACTIVE_ORDERS_STORAGE_KEY,
        JSON.stringify(remaining),
      );
    } catch {
      // Ignora erro
    }
    const legacy = safeParseJson<StoredOrder>(
      localStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY),
    );
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

/**
 * Consulta o backend para obter o status atualizado de um pedido.
 * Retorna `null` se o pedido não for encontrado (404).
 */
export async function fetchOrderLiveStatus(
  order: StoredOrder,
  apiBaseUrl: string,
): Promise<StoredOrder | null> {
  const key = String(order.idempotency_key || "").trim();
  const url = `${apiBaseUrl}/cardapio/pedidos/${encodeURIComponent(order.id)}/status?key=${encodeURIComponent(key)}`;

  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    return order; // Retorna os dados locais se houver erro transitório de rede
  }

  const data = await response.json();
  const rawStatus = String(data.status || order.status || "pendente");
  const isClosed = Boolean(data.fechada || data.fechado);
  const finalStatus = isClosed && !isRejectedStatus(rawStatus) ? "finalizado" : rawStatus;

  const updated: StoredOrder = {
    ...order,
    id: String(data.id || order.id),
    numero_pedido: data.numero_pedido ?? order.numero_pedido,
    status: finalStatus,
    tipo: String(data.tipo || order.tipo || "Retirada"),
    total: Number(data.total ?? order.total ?? 0),
    fechado: isClosed,
    created_at: data.criado_em || order.created_at,
    itens: Array.isArray(data.itens) ? data.itens : order.itens,
  };

  return updated;
}

/**
 * Consulta todos os pedidos de um restaurante em paralelo, atualiza o armazenamento local
 * e remove pedidos que retornaram 404.
 */
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
        // Pedido 404 no backend -> remover localmente
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
