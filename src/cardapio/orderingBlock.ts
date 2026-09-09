import { loadStoredOrders, type StoredOrder } from "./orderTracking";

export interface OrderingBlockInfo {
  active: true;
  reason: string;
  created_at?: string | null;
  expires_at?: string | null;
  orderId?: string;
  orderNumber?: string | number;
}

interface OrderingBlockPayload {
  active?: unknown;
  reason?: unknown;
  created_at?: unknown;
  expires_at?: unknown;
}

export function normalizeOrderingBlock(value: unknown): OrderingBlockInfo | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as OrderingBlockPayload;
  if (payload.active !== true) return null;
  const reason = String(payload.reason || "").trim();
  if (!reason) return null;
  return {
    active: true,
    reason,
    created_at: payload.created_at ? String(payload.created_at) : null,
    expires_at: payload.expires_at ? String(payload.expires_at) : null,
  };
}

export function formatOrderingBlockDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function trackingTokenFor(order: StoredOrder): string | null {
  const direct = String(order.tracking_token || "").trim();
  if (direct) return direct;
  const legacyUrl = String(order.tracking_url || "").trim();
  if (!legacyUrl) return null;
  try {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://koma.invalid";
    const parsed = new URL(legacyUrl, baseUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("acompanhar");
    return index >= 0 && parts[index + 1] ? decodeURIComponent(parts[index + 1]) : null;
  } catch {
    return null;
  }
}

export async function resolveOrderingBlockForCurrentSession(
  restaurantId: string | number,
  apiBaseUrl: string,
): Promise<OrderingBlockInfo | null> {
  const rid = Number(restaurantId);
  if (!Number.isInteger(rid) || rid <= 0 || !apiBaseUrl) return null;

  const candidates = loadStoredOrders(rid)
    .filter((order) => Boolean(trackingTokenFor(order)))
    .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0))
    .slice(0, 8);

  for (const order of candidates) {
    const token = trackingTokenFor(order);
    if (!token) continue;
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/cardapio/pedidos/acompanhar/${encodeURIComponent(token)}`,
        { cache: "no-store" },
      );
      if (!response.ok) continue;
      const payload = await response.json() as { ordering_block?: unknown };
      const block = normalizeOrderingBlock(payload?.ordering_block);
      if (block) {
        return {
          ...block,
          orderId: order.id,
          orderNumber: order.numero_pedido,
        };
      }
    } catch {
      // Falha de consulta não substitui a barreira autoritativa do backend no POST.
    }
  }
  return null;
}
