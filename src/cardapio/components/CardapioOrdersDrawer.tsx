import { DeliveryReceiptCode } from "./DeliveryReceiptCode";
import PixCopyCode from "./PixCopyCode";
import { ManualPixReceiptContact } from "./ManualPixReceiptContact";
import { DirectPixCustomerConfirm } from "./DirectPixCustomerConfirm";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Bike,
  Check,
  CheckCircle2,
  ChefHat,
  Clock3,
  MessageCircle,
  Package,
  PackageCheck,
  QrCode,
  Receipt,
  RefreshCw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { API_BASE_URL } from "../../config/api";
import {
  OrderPaymentStatus,
  OrderStateContract,
  StoredOrder,
  customerOrderLabel,
  orderFulfillmentLabel,
  orderProgress,
  resolveOrderState,
} from "../orderTracking";
import CardapioOrderChatPanel from "./CardapioOrderChatPanel";
import { KomaOrderStatusAsset } from "../v2/KomaVisualAssets";

interface CardapioOrdersDrawerProps {
  restaurantId?: string | number | null;
  restaurantPhone?: string | null;
  isOpen: boolean;
  onClose: () => void;
  orders: StoredOrder[];
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string) => void;
  onRefresh: () => void;
  onRemoveOrder: (orderId: string) => void;
  onOrderPaymentUpdated?: (orderId: string, pagamento: OrderPaymentStatus) => void;
  onRealtimeStatus?: (
    orderId: string,
    status: string,
    closedAt: string | null,
    tipo?: string,
    state?: OrderStateContract,
    deliveryReceiptCode?: string | null,
  ) => void;
  onRealtimeRefresh?: () => void;
  isRefreshing?: boolean;
  hasFloatingCart?: boolean;
}

interface RequestedPushOrder {
  orderId: string;
  restaurantId: number | null;
}

function resolveTrackingToken(order: StoredOrder): string | null {
  if (order.tracking_token?.trim()) return order.tracking_token.trim();
  if (!order.tracking_url?.trim()) return null;

  try {
    const parsed = new URL(order.tracking_url, window.location.origin);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("acompanhar");
    return idx >= 0 && parts[idx + 1] ? decodeURIComponent(parts[idx + 1]) : null;
  } catch {
    return null;
  }
}

function requestedPushOrderFromHash(): RequestedPushOrder | null {
  if (typeof window === "undefined") return null;
  const match = window.location.hash.match(/^#koma-order=(.+)$/);
  if (!match?.[1]) return null;
  try {
    const orderId = decodeURIComponent(match[1]).trim();
    return orderId ? { orderId, restaurantId: null } : null;
  } catch {
    return null;
  }
}

export default function CardapioOrdersDrawer({
  restaurantId,
  restaurantPhone,
  isOpen,
  onClose,
  orders,
  selectedOrderId,
  onSelectOrder,
  onRefresh,
  onRemoveOrder,
  onOrderPaymentUpdated,
  onRealtimeStatus,
  onRealtimeRefresh,
  isRefreshing = false,
  hasFloatingCart = false,
}: CardapioOrdersDrawerProps) {
  const [chatOrderId, setChatOrderId] = React.useState<string | null>(null);
  const [pixModalOrder, setPixModalOrder] = React.useState<StoredOrder | null>(null);
  const [floatingOpen, setFloatingOpen] = React.useState(false);
  const [receiptByOrder, setReceiptByOrder] = React.useState<Record<string, string | null>>({});
  const [unreadByOrder, setUnreadByOrder] = React.useState<Record<string, number>>({});
  const [requestedPushOrder, setRequestedPushOrder] = React.useState<RequestedPushOrder | null>(
    () => requestedPushOrderFromHash(),
  );
  const chatOrderIdRef = React.useRef<string | null>(null);
  const seenRealtimeMessageIdsRef = React.useRef<Set<string>>(new Set());
  const prevIsOpenRef = React.useRef(isOpen);
  const drawerOpen = isOpen || floatingOpen;

  React.useEffect(() => {
    if (prevIsOpenRef.current && !isOpen) {
      setFloatingOpen(false);
      setChatOrderId(null);
      setPixModalOrder(null);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  const ordersWithChat = React.useMemo(
    () => orders.filter((order) => Boolean(resolveTrackingToken(order))),
    [orders],
  );
  const activeChatOrders = React.useMemo(
    () => ordersWithChat.filter((order) => !resolveOrderState(order).terminal),
    [ordersWithChat],
  );
  const activeChatOrdersRef = React.useRef<StoredOrder[]>(activeChatOrders);
  activeChatOrdersRef.current = activeChatOrders;
  // Status/unread updates replace order objects frequently. The SSE topology only
  // needs to restart when the tracked order ids/tokens actually change.
  const realtimeTargetsKey = React.useMemo(
    () => JSON.stringify(activeChatOrders.map((order) => [order.id, resolveTrackingToken(order)])),
    [activeChatOrders],
  );

  const refreshUnreadCounts = React.useCallback(async () => {
    const currentOrders = activeChatOrdersRef.current;
    const targets = currentOrders
      .map((order) => ({ order, token: resolveTrackingToken(order) }))
      .filter((item): item is { order: StoredOrder; token: string } => Boolean(item.token));

    if (targets.length === 0) {
      setUnreadByOrder({});
      return;
    }

    const results = await Promise.all(
      targets.map(async ({ order, token }) => {
        try {
          const response = await fetch(
            `${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${encodeURIComponent(token)}/summary`,
            { cache: "no-store" },
          );
          if (!response.ok) {
            if ([401, 403, 404].includes(response.status)) {
              setReceiptByOrder(current => ({ ...current, [order.id]: null }));
              onRealtimeStatus?.(order.id, order.status || 'pendente', null, order.tipo, order.state, null);
            }
            return null;
          }
          const payload = await response.json() as {
            delivery_receipt_code?: string | null;
            status?: string;
            tipo?: string;
            state?: OrderStateContract;
            closed_at?: string | null;
            conversa?: { unread_count?: number };
          };
          setReceiptByOrder(current => ({ ...current, [order.id]: payload.delivery_receipt_code || null }));
          if (payload.status) {
            onRealtimeStatus?.(
              order.id,
              payload.status,
              payload.closed_at || null,
              payload.tipo,
              payload.state,
              payload.delivery_receipt_code || null,
            );
          }
          return [order.id, Math.max(0, Number(payload?.conversa?.unread_count || 0))] as const;
        } catch {
          return null;
        }
      }),
    );

    setUnreadByOrder((current) => {
      const next = { ...current };
      results.forEach((result) => {
        if (result) next[result[0]] = result[1];
      });
      const activeIds = new Set(currentOrders.map((order) => order.id));
      Object.keys(next).forEach((orderId) => {
        if (!activeIds.has(orderId)) delete next[orderId];
      });
      return next;
    });
  }, [onRealtimeStatus]);

  React.useEffect(() => {
    chatOrderIdRef.current = chatOrderId;
  }, [chatOrderId]);

  React.useEffect(() => {
    const trackedOrders = activeChatOrdersRef.current;
    void refreshUnreadCounts();
    if (trackedOrders.length === 0) return;

    const sources: EventSource[] = [];
    const healthyOrders = new Set<string>();
    const openedOrders = new Set<string>();
    let fallbackInterval: number | null = null;
    let realtimeRefreshTimer: number | null = null;
    let fullRefreshRequested = false;

    const scheduleRealtimeRefresh = (fullRefresh = false) => {
      fullRefreshRequested = fullRefreshRequested || fullRefresh;
      if (realtimeRefreshTimer !== null) return;
      realtimeRefreshTimer = window.setTimeout(() => {
        realtimeRefreshTimer = null;
        const shouldRefreshAll = fullRefreshRequested;
        fullRefreshRequested = false;
        void refreshUnreadCounts();
        if (shouldRefreshAll) onRealtimeRefresh?.();
      }, 100);
    };

    const stopFallback = () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };
    const startFallback = () => {
      if (fallbackInterval !== null) return;
      fallbackInterval = window.setInterval(() => {
        if (!document.hidden) void refreshUnreadCounts();
      }, 30000);
    };
    const markHealthy = (orderId: string) => {
      healthyOrders.add(orderId);
      if (healthyOrders.size === trackedOrders.length) stopFallback();
    };
    const markDegraded = (orderId: string) => {
      healthyOrders.delete(orderId);
      startFallback();
    };

    trackedOrders.forEach((order) => {
      const token = resolveTrackingToken(order);
      if (!token) return;
      const source = new EventSource(
        `${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${encodeURIComponent(token)}/events`,
      );
      sources.push(source);

      let sawInitialConnected = false;
      source.onopen = () => {
        const isReconnect = openedOrders.has(order.id);
        openedOrders.add(order.id);
        markHealthy(order.id);
        if (isReconnect) scheduleRealtimeRefresh(true);
      };
      source.onerror = () => markDegraded(order.id);
      source.addEventListener("connected", () => {
        if (!sawInitialConnected) {
          sawInitialConnected = true;
          return;
        }
        scheduleRealtimeRefresh(false);
      });

      source.addEventListener("refresh", () => { scheduleRealtimeRefresh(true); });

      source.addEventListener("message", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as { id?: unknown; sender_type?: unknown };
          const messageId = typeof data.id === "string" ? data.id : null;
          if (messageId) {
            if (seenRealtimeMessageIdsRef.current.has(messageId)) return;
            seenRealtimeMessageIdsRef.current.add(messageId);
            if (seenRealtimeMessageIdsRef.current.size > 200) {
              const oldest = seenRealtimeMessageIdsRef.current.values().next().value;
              if (oldest) seenRealtimeMessageIdsRef.current.delete(oldest);
            }
          }
          if (data.sender_type === "staff" && chatOrderIdRef.current !== order.id) {
            setUnreadByOrder((current) => ({
              ...current,
              [order.id]: Math.max(0, Number(current[order.id] || 0)) + 1,
            }));
          }
        } catch {
          markDegraded(order.id);
        }
      });

      source.addEventListener("read_update", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as { reader?: unknown };
          if (data.reader === "customer") {
            setUnreadByOrder((current) => ({ ...current, [order.id]: 0 }));
          }
        } catch {
          markDegraded(order.id);
        }
      });

      source.addEventListener("status", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as { status?: unknown; closed_at?: unknown };
          const status = typeof data.status === "string" ? data.status : "";
          if (!status) return;
          onRealtimeStatus?.(
            order.id,
            status,
            typeof data.closed_at === "string" ? data.closed_at : null,
          );
        } catch {
          markDegraded(order.id);
        }
      });
    });

    const onVisibilityChange = () => {
      if (!document.hidden && fallbackInterval !== null) void refreshUnreadCounts();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      sources.forEach((source) => source.close());
      stopFallback();
      if (realtimeRefreshTimer !== null) window.clearTimeout(realtimeRefreshTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [realtimeTargetsKey, onRealtimeRefresh, onRealtimeStatus, refreshUnreadCounts]);

  React.useEffect(() => {
    if (chatOrderId && !orders.some((order) => order.id === chatOrderId)) {
      setChatOrderId(null);
    }
  }, [chatOrderId, orders]);

  const unreadFor = React.useCallback(
    (orderId: string) => Math.max(0, Number(unreadByOrder[orderId] || 0)),
    [unreadByOrder],
  );

  const totalUnread = React.useMemo(
    () => activeChatOrders.reduce((total, order) => total + unreadFor(order.id), 0),
    [activeChatOrders, unreadFor],
  );

  const sortUnreadFirst = React.useCallback(
    (left: StoredOrder, right: StoredOrder) => {
      const unreadDelta = unreadFor(right.id) - unreadFor(left.id);
      if (unreadDelta !== 0) return unreadDelta;
      return Number(right.timestamp || 0) - Number(left.timestamp || 0);
    }, [unreadFor],
  );

  const activeOrders = React.useMemo(
    () => orders.filter((order) => !resolveOrderState(order).terminal).sort(sortUnreadFirst),
    [orders, sortUnreadFirst],
  );
  const finishedOrders = React.useMemo(
    () => orders.filter((order) => resolveOrderState(order).terminal).sort(sortUnreadFirst),
    [orders, sortUnreadFirst],
  );

  const chatOrder = chatOrderId ? orders.find((order) => order.id === chatOrderId) || null : null;
  const preferredChatOrder = React.useMemo(
    () => ordersWithChat.find((order) => unreadFor(order.id) > 0)
      || ordersWithChat.find((order) => order.id === selectedOrderId)
      || ordersWithChat.find((order) => !resolveOrderState(order).terminal)
      || ordersWithChat[0]
      || null,
    [ordersWithChat, selectedOrderId, unreadFor],
  );

  const markChatReadLocally = React.useCallback((orderId: string) => {
    setUnreadByOrder((current) => ({ ...current, [orderId]: 0 }));
  }, []);

  const openChat = React.useCallback((orderId: string) => {
    setChatOrderId(orderId);
    markChatReadLocally(orderId);
  }, [markChatReadLocally]);

  React.useEffect(() => {
    const handleHashChange = () => {
      const request = requestedPushOrderFromHash();
      if (request) setRequestedPushOrder(request);
    };

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: unknown;
        pedidoId?: unknown;
        restaurantId?: unknown;
      } | null;
      if (!data || data.type !== "KOMA_PUSH_OPEN_ORDER") return;
      const orderId = String(data.pedidoId || "").trim();
      if (!orderId) return;
      const restaurantId = Number(data.restaurantId || 0);
      setRequestedPushOrder({
        orderId,
        restaurantId: Number.isInteger(restaurantId) && restaurantId > 0 ? restaurantId : null,
      });
    };

    window.addEventListener("hashchange", handleHashChange);
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);
    handleHashChange();
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, []);

  React.useEffect(() => {
    if (!requestedPushOrder) return;
    const order = orders.find((candidate) => (
      candidate.id === requestedPushOrder.orderId
      && (
        requestedPushOrder.restaurantId === null
        || Number(candidate.restaurante_id) === requestedPushOrder.restaurantId
      )
    ));
    if (!order || !resolveTrackingToken(order)) return;

    openChat(order.id);
    setFloatingOpen(true);
    setRequestedPushOrder(null);

    if (window.location.hash.startsWith("#koma-order=")) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, [openChat, orders, requestedPushOrder]);

  React.useEffect(() => {
    const handleOpenOrdersDrawer = (event: Event) => {
      const detail = (event as CustomEvent<{ orderId?: string }>).detail;
      if (detail?.orderId) {
        onSelectOrder(detail.orderId);
      }
      setChatOrderId(null);
      setFloatingOpen(true);
    };
    window.addEventListener("koma:open-orders-drawer", handleOpenOrdersDrawer);
    return () => {
      window.removeEventListener("koma:open-orders-drawer", handleOpenOrdersDrawer);
    };
  }, [onSelectOrder]);

  const openFloatingChat = React.useCallback(() => {
    if (preferredChatOrder) openChat(preferredChatOrder.id);
    setFloatingOpen(true);
  }, [openChat, preferredChatOrder]);

  const closeDrawer = React.useCallback(() => {
    setFloatingOpen(false);
    setChatOrderId(null);
    onClose();
  }, [onClose]);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val || 0);

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(timestamp));
  };

  if (!drawerOpen) {
    const displayOrder = preferredChatOrder || activeOrders[0] || null;
    const displayState = displayOrder ? resolveOrderState(displayOrder) : null;
    const isChatAvailable = Boolean(displayOrder && resolveTrackingToken(displayOrder) && displayState?.can_chat);
    const statusText = displayState?.label || "Acompanhe seus pedidos";

    return (
      <div
        className={clsx(
          "hidden sm:block fixed right-4 z-40 sm:right-6 transition-[opacity,transform] duration-300 pointer-events-auto",
          hasFloatingCart
            ? "bottom-[calc(6.75rem+env(safe-area-inset-bottom,0px))]"
            : "bottom-5 sm:bottom-6 pb-[env(safe-area-inset-bottom,0px)]"
        )}
        id="floating-order-chat-container"
      >
        <button
          type="button"
          onClick={() => {
            if (preferredChatOrder) {
              openFloatingChat();
            } else {
              setFloatingOpen(true);
            }
          }}
          className={clsx(
            "group relative flex min-h-12 items-center gap-2.5 rounded-full border border-[var(--km-accent-border)] bg-[var(--km-dialog)] px-3.5 py-2 text-[var(--km-ink)] shadow-2xl transition hover:-translate-y-0.5 hover:border-[var(--km-accent)] active:scale-95 cursor-pointer",
            totalUnread > 0 ? "ring-4 ring-[var(--km-accent-soft)]" : ""
          )}
          id="floating-order-chat-trigger"
          aria-label={totalUnread > 0
            ? `Abrir chat do pedido, ${totalUnread} ${totalUnread === 1 ? "mensagem nova" : "mensagens novas"}`
            : displayOrder ? "Abrir chat do pedido" : "Abrir pedidos e chat"}
        >
          {totalUnread > 0 ? (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--km-accent)] px-1 text-[10px] font-black text-[var(--km-on-accent)] shadow-lg animate-pulse">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          ) : (
            <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--km-accent)] opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[var(--km-accent)]" />
            </span>
          )}
          <span className={clsx(
            "grid h-8 w-8 place-items-center rounded-full bg-[var(--km-accent-soft)] border border-[var(--km-accent-border)] text-[var(--km-accent-text)] shrink-0",
            totalUnread > 0 && "animate-pulse"
          )}>
            {isChatAvailable || !displayOrder ? <MessageCircle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
          </span>
          <div className="text-left pr-1">
            {displayOrder ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="block text-[9px] font-black uppercase tracking-wider text-[var(--km-accent-text)]">
                    Pedido #{displayOrder.numero_pedido}
                  </span>
                  <strong className="text-[10px] font-black text-[var(--km-accent-text)]">
                    {totalUnread > 0 ? "Nova mensagem" : "Chat do pedido"}
                  </strong>
                </div>
                <span className="block text-[11px] font-bold text-[var(--km-ink)] leading-tight">
                  {statusText} · <small className="text-[9px] text-[var(--km-muted)] font-normal">Fale com o restaurante</small>
                </span>
              </>
            ) : (
              <>
                <strong className="block text-[10px] font-black text-[var(--km-accent-text)]">Pedidos & chat</strong>
                <span className="block text-[11px] font-bold text-[var(--km-ink)] leading-tight">
                  Acompanhe seus pedidos
                </span>
              </>
            )}
          </div>
        </button>
      </div>
    );
  }

  if (chatOrder) {
    return (
      <div
        className="fixed inset-0 z-50 flex justify-end transition-opacity"
        style={{ backgroundColor: "var(--km-overlay)" }}
        id="orders-drawer-backdrop"
        onClick={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}
      >
        <div
          className="flex h-full w-full max-w-md flex-col border-l border-[var(--km-line)] bg-[var(--km-dialog)] pb-[calc(90px+env(safe-area-inset-bottom,0px))] text-[var(--km-ink)] shadow-2xl transition-transform duration-300 md:pb-5"
          role="dialog"
          aria-label={`Chat do Pedido #${chatOrder.numero_pedido}`}
          id="orders-drawer-panel"
        >
          <CardapioOrderChatPanel
            order={chatOrder}
            onBack={() => setChatOrderId(null)}
            onClose={closeDrawer}
            onPayPix={() => {
              setPixModalOrder(chatOrder);
              setChatOrderId(null);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end sm:items-stretch transition-opacity"
      style={{ backgroundColor: "var(--km-overlay)" }}
      id="orders-drawer-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}
    >
      <div
        className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-[var(--km-line)] bg-[var(--km-dialog)] text-[var(--km-ink)] shadow-2xl transition-transform duration-300 sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-l-[28px] sm:border-y-0 sm:border-r-0"
        role="dialog"
        aria-label="Meus Pedidos"
        id="orders-drawer-panel"
      >
        <div className="flex shrink-0 justify-center pt-3 pb-1 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-[var(--km-line-strong)]" />
        </div>

        <div className="flex items-center justify-between border-b border-[var(--km-line-subtle)] px-5 pt-2 pb-4 sm:pt-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-black tracking-tight text-[var(--km-ink)]">Pedidos</h2>
                {totalUnread > 0 && (
                  <span className="rounded-full bg-[var(--km-accent)] px-2 py-0.5 text-[10px] font-black text-[var(--km-on-accent)]">
                    {totalUnread} {totalUnread === 1 ? "nova" : "novas"}
                  </span>
                )}
              </div>
              <p className="text-[11px] leading-snug text-[var(--km-muted)]">
                {totalUnread > 0
                  ? "Nova mensagem do restaurante"
                  : activeOrders.length > 0
                    ? `${activeOrders.length} em andamento`
                    : "Acompanhe em tempo real"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                onRefresh();
                void refreshUnreadCounts();
              }}
              disabled={isRefreshing}
              className="grid h-10 w-10 place-items-center rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-ink-2)] transition hover:text-[var(--km-ink)] disabled:opacity-50 cursor-pointer"
              title="Atualizar status"
              aria-label="Atualizar status"
            >
              <RefreshCw className={clsx("h-4 w-4", isRefreshing && "animate-spin text-[var(--km-accent-text)]")} />
            </button>
            <button
              type="button"
              onClick={closeDrawer}
              className="grid h-10 w-10 place-items-center rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-ink-2)] transition hover:text-[var(--km-ink)] cursor-pointer"
              title="Fechar"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pt-4 pb-[calc(90px+env(safe-area-inset-bottom,0px))] sm:px-5 sm:pt-5 md:pb-5 no-scrollbar">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 sm:py-12 text-center">
              <KomaOrderStatusAsset className="h-20 w-20" />
              <h3 className="mt-4 font-display text-lg font-black text-[var(--km-ink)]">Nenhum pedido por aqui ainda</h3>
              <p className="mt-1.5 max-w-[260px] text-xs leading-relaxed text-[var(--km-muted)]">
                Este atalho continua disponível mesmo sem login. Seus pedidos e atualizações aparecem aqui automaticamente.
              </p>
              <button type="button" onClick={closeDrawer} className="mt-5 min-h-12 w-full max-w-xs rounded-full bg-[var(--km-accent)] px-5 text-xs font-black uppercase tracking-wider text-[var(--km-on-accent)] hover:bg-[var(--km-accent-hover)] transition cursor-pointer">
                Explorar cardápio
              </button>
            </div>
          ) : (
            <>
              {activeOrders.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase tracking-wider text-[var(--km-accent-text)]">
                      Em andamento ({activeOrders.length})
                    </span>
                  </div>

                  {activeOrders.map((order) => {
                    const state = resolveOrderState(order);
                    const rejected = state.rejected;
                    const progress = orderProgress(state);
                    const isSelected = selectedOrderId === order.id;
                    const unread = unreadFor(order.id);

                    const getMilestoneIcon = (label: string, idx: number, totalSteps: number) => {
                      const lower = label.toLowerCase();
                      if (idx === 0 || lower.includes("receb")) return Receipt;
                      if (lower.includes("entrega") || lower.includes("saiu")) return Bike;
                      if (idx === totalSteps - 1 || lower.includes("conclu")) return PackageCheck;
                      return ChefHat;
                    };

                    const getShortMilestoneLabel = (label: string) => {
                      const lower = label.toLowerCase();
                      if (lower.includes("pronto")) return "Pronto";
                      if (lower.includes("saiu")) return "A caminho";
                      return label;
                    };

                    return (
                      <div
                        key={order.id}
                        className={clsx(
                          "rounded-2xl border p-4 transition-all",
                          unread > 0
                            ? "border-[var(--km-accent)] bg-[var(--km-accent-soft)]"
                            : isSelected
                              ? "border-[var(--km-accent)] bg-[var(--km-card)] ring-2 ring-[var(--km-accent-soft)]"
                              : "border-[var(--km-line)] bg-[var(--km-card)] hover:border-[var(--km-accent-border)]",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            {unread > 0 ? (
                              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--km-accent)] text-[var(--km-on-accent)]">
                                <MessageCircle className="h-5 w-5" />
                              </div>
                            ) : (
                              <KomaOrderStatusAsset className="h-11 w-11 shrink-0" />
                            )}
                            <div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-display text-sm font-black text-[var(--km-ink)]">
                                  Pedido #{order.numero_pedido}
                                </span>
                                <span className="rounded-md bg-[var(--km-raised)] px-2 py-0.5 text-[10px] font-bold text-[var(--km-ink-2)]">
                                  {orderFulfillmentLabel(state.fulfillment)}
                                </span>
                                {unread > 0 && (
                                  <span className="rounded-full bg-[var(--km-accent)] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[var(--km-on-accent)] animate-pulse">
                                    {unread} {unread === 1 ? "nova" : "novas"}
                                  </span>
                                )}
                              </div>
                              <span className="mt-0.5 block text-xs font-bold text-[var(--km-accent-text)]">
                                {unread > 0 ? "O restaurante respondeu" : customerOrderLabel(state)}
                              </span>
                            </div>
                          </div>

                          <div className="text-right tabular-nums shrink-0">
                            <span className="font-display text-sm font-black text-[var(--km-ink)]">
                              {formatCurrency(order.total)}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-[var(--km-muted)]">
                              {formatTime(order.timestamp)}
                            </span>
                          </div>
                        </div>

                        {!state.terminal && <DeliveryReceiptCode code={receiptByOrder[order.id]} />}
                        {Array.isArray(order.itens) && order.itens.length > 0 && (
                          <div className="mt-3 space-y-1 border-t border-[var(--km-line-subtle)] pt-2.5 text-[11px] text-[var(--km-muted)]">
                            {order.itens.slice(0, 3).map((item, idx) => (
                              <div key={idx} className="truncate">
                                <strong className="text-[var(--km-ink-2)]">{item.quantidade}×</strong> {item.nome}
                              </div>
                            ))}
                            {order.itens.length > 3 && (
                              <span className="text-[10px] text-[var(--km-subtle)]">
                                + {order.itens.length - 3} {order.itens.length - 3 === 1 ? "item" : "itens"}
                              </span>
                            )}
                          </div>
                        )}

                        {!rejected && progress && (
                          <div className="mt-3.5 border-t border-[var(--km-line-subtle)] pt-3.5">
                            <div className="flex items-start justify-between">
                              {progress.labels.map((label, idx) => {
                                const stepNum = idx + 1;
                                const isDone = progress.current > stepNum;
                                const isCurrent = progress.current === stepNum;
                                const passed = progress.current >= stepNum;
                                const MilestoneIcon = getMilestoneIcon(label, idx, progress.labels.length);
                                const isLast = idx === progress.labels.length - 1;
                                return (
                                  <React.Fragment key={label}>
                                    <div className="flex flex-col items-center gap-1.5 min-w-[54px]">
                                      <span
                                        className={clsx(
                                          "grid h-8 w-8 place-items-center rounded-full border transition-all",
                                          isCurrent
                                            ? "border-[var(--km-accent)] bg-[var(--km-accent)] text-[var(--km-on-accent)] ring-4 ring-[var(--km-accent-soft)]"
                                            : isDone
                                              ? "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]"
                                              : "border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-muted)]",
                                        )}
                                      >
                                        {isDone ? (
                                          <Check className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden="true" />
                                        ) : (
                                          <MilestoneIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                        )}
                                      </span>
                                      <span
                                        className={clsx(
                                          "text-[10px] leading-tight text-center",
                                          isCurrent
                                            ? "font-black text-[var(--km-accent-text)]"
                                            : passed
                                              ? "font-bold text-[var(--km-ink)]"
                                              : "font-medium text-[var(--km-subtle)]",
                                        )}
                                      >
                                        {getShortMilestoneLabel(label)}
                                      </span>
                                    </div>
                                    {!isLast && (
                                      <div className="mt-[15px] flex-1 px-1" aria-hidden="true">
                                        <div className="h-[2px] w-full rounded-full bg-[var(--km-line)] overflow-hidden">
                                          <div
                                            className="h-full rounded-full bg-[var(--km-accent)] transition-all duration-300"
                                            style={{ width: progress.current > stepNum ? "100%" : "0%" }}
                                          />
                                        </div>
                                      </div>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {state.phase === "payment_pending" && (
                          <div className="mt-3 rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] p-3 text-left">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-[var(--km-accent-text)]">
                                <QrCode className="h-4 w-4 shrink-0" />
                                <span className="text-xs font-black text-[var(--km-ink)]">
                                  {order.pagamento?.confirmacao_manual && order.pagamento?.cliente_informou_pagamento
                                    ? "Pagamento informado"
                                    : "Aguardando Pix"}
                                </span>
                              </div>
                              {order.pagamento?.qr_code && (
                                <button
                                  type="button"
                                  onClick={() => setPixModalOrder(order)}
                                  className="inline-flex items-center gap-1 rounded-full bg-[var(--km-accent)] hover:bg-[var(--km-accent-hover)] px-3 py-1.5 text-[11px] font-black text-[var(--km-on-accent)] transition cursor-pointer"
                                >
                                  <QrCode className="h-3.5 w-3.5" />
                                  Pagar Pix
                                </button>
                              )}
                            </div>
                            <p className="mt-1 text-[11px] text-[var(--km-muted)] leading-relaxed">
                              {order.pagamento?.confirmacao_manual && order.pagamento?.cliente_informou_pagamento
                                ? "Aguardando confirmação do restaurante."
                                : "O preparo inicia após a confirmação do Pix."}
                            </p>
                          </div>
                        )}

                        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--km-line-subtle)] pt-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {(order.tracking_url || order.tracking_token) && state.can_chat && (
                              <button
                                type="button"
                                onClick={() => openChat(order.id)}
                                className={clsx(
                                  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition cursor-pointer",
                                  unread > 0
                                    ? "border-[var(--km-accent)] bg-[var(--km-accent)] text-[var(--km-on-accent)] shadow-sm"
                                    : "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)] hover:border-[var(--km-accent)]",
                                )}
                              >
                                <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{unread > 0 ? `Ler ${unread === 1 ? "mensagem" : "mensagens"}` : "Falar com a loja"}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                onSelectOrder(order.id);
                                closeDrawer();
                              }}
                              className={clsx(
                                "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition cursor-pointer",
                                isSelected
                                  ? "border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]"
                                  : "border border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-ink-2)] hover:border-[var(--km-accent-border)] hover:text-[var(--km-ink)]",
                              )}
                            >
                              {isSelected && <Check className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden="true" />}
                              <span>{isSelected ? "Fixado no topo" : "Fixar no topo"}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {finishedOrders.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[var(--km-muted)]">
                      Histórico Recente ({finishedOrders.length})
                    </span>
                  </div>

                  {finishedOrders.map((order) => {
                    const state = resolveOrderState(order);
                    const rejected = state.rejected;
                    const unread = unreadFor(order.id);

                    return (
                      <div
                        key={order.id}
                        className={clsx(
                          "rounded-2xl border p-3.5 transition",
                          unread > 0
                            ? "border-[var(--km-accent)] bg-[var(--km-accent-soft)]"
                            : "border-[var(--km-line)] bg-[var(--km-panel)]",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            <div
                              className={clsx(
                                "grid h-8 w-8 shrink-0 place-items-center rounded-xl",
                                unread > 0
                                  ? "bg-[var(--km-accent)] text-[var(--km-on-accent)]"
                                  : rejected
                                    ? ""
                                    : "bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]",
                              )}
                              style={
                                unread === 0 && rejected
                                  ? {
                                      background: "var(--koma-danger-bg)",
                                      color: "var(--koma-danger-text)",
                                    }
                                  : undefined
                              }
                            >
                              {unread > 0 ? <MessageCircle className="h-4 w-4" /> : rejected ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-black text-[var(--km-ink)]">
                                  Pedido #{order.numero_pedido}
                                </span>
                                <span className="rounded-md bg-[var(--km-raised)] px-1.5 py-0.5 text-[8px] font-bold text-[var(--km-muted)]">
                                  {orderFulfillmentLabel(state.fulfillment)}
                                </span>
                                {unread > 0 && (
                                  <span className="rounded-full bg-[var(--km-accent)] px-1.5 py-0.5 text-[8px] font-black text-[var(--km-on-accent)]">
                                    {unread} nova{unread > 1 ? "s" : ""}
                                  </span>
                                )}
                              </div>
                              <span
                                className={clsx("mt-0.5 block text-[10px] font-bold", !rejected && "text-[var(--km-accent-text)]")}
                                style={rejected ? { color: "var(--koma-danger-text)" } : undefined}
                              >
                                {unread > 0 ? "Nova resposta do restaurante" : customerOrderLabel(state)}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1 tabular-nums">
                            <span className="text-xs font-bold text-[var(--km-ink-2)]">
                              {formatCurrency(order.total)}
                            </span>
                            <span className="text-[9px] text-[var(--km-subtle)]">
                              {formatTime(order.timestamp)}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--km-line-subtle)] pt-2.5 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                onSelectOrder(order.id);
                                closeDrawer();
                              }}
                              className="inline-flex min-h-9 items-center rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] px-3 py-1 text-[11px] font-bold text-[var(--km-ink-2)] transition hover:border-[var(--km-accent-border)] hover:text-[var(--km-ink)] cursor-pointer"
                            >
                              Ver detalhes
                            </button>
                            {(order.tracking_url || order.tracking_token) && (
                              <button
                                type="button"
                                onClick={() => openChat(order.id)}
                                className={clsx(
                                  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold transition cursor-pointer",
                                  rejected
                                    ? ""
                                    : unread > 0
                                      ? "border-[var(--km-accent)] bg-[var(--km-accent)] text-[var(--km-on-accent)]"
                                      : "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)] hover:border-[var(--km-accent)]",
                                )}
                                style={
                                  rejected
                                    ? {
                                        background: "var(--koma-danger-bg)",
                                        borderColor: "var(--koma-danger-border)",
                                        color: "var(--koma-danger-text)",
                                      }
                                    : undefined
                                }
                              >
                                <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{rejected ? "Ver motivo" : unread > 0 ? "Ler mensagem" : "Chat"}</span>
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => onRemoveOrder(order.id)}
                            className="inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-[var(--km-subtle)] transition hover:bg-rose-500/10 hover:text-rose-500 cursor-pointer"
                            title="Remover do histórico local"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Remover</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {pixModalOrder && pixModalOrder.pagamento?.qr_code && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center p-4 transition-opacity"
          style={{ backgroundColor: "var(--km-overlay)" }}
          id="pix-payment-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPixModalOrder(null);
            }
          }}
        >
          <div
            className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-3xl border border-[var(--km-line)] bg-[var(--km-dialog)] p-5 text-center text-[var(--km-ink)] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={`Pagamento Pix do Pedido #${pixModalOrder.numero_pedido}`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[var(--km-line-subtle)]">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]">
                  <QrCode className="h-4 w-4" />
                </div>
                <div className="text-left">
                  <h3 className="text-xs font-black text-[var(--km-ink)]">
                    Pagar Pedido #{pixModalOrder.numero_pedido}
                  </h3>
                  <span className="text-[10px] text-[var(--km-muted)]">Pagamento via Pix</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPixModalOrder(null);
                }}
                className="grid h-8 w-8 place-items-center rounded-xl border border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-ink-2)] hover:text-[var(--km-ink)]"
                aria-label="Fechar modal Pix"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="my-4">
              <span className="text-xs font-bold text-[var(--km-muted)] block">Valor total</span>
              <span className="text-2xl font-black text-[var(--km-accent-text)] block mt-0.5 tabular-nums">
                {formatCurrency(pixModalOrder.total)}
              </span>
            </div>

            {!pixModalOrder.pagamento.qr_code_base64 && pixModalOrder.pagamento.qr_code && (
              <QRCodeSVG value={pixModalOrder.pagamento.qr_code} size={208} level="M" marginSize={4}
                role="img" aria-label="QR Code Pix do pedido" className="mx-auto my-3 rounded-xl bg-white p-2" />
            )}
            {pixModalOrder.pagamento.qr_code_base64 && (
              <div className="mx-auto my-3 flex justify-center">
                <img
                  className="h-48 w-48 rounded-2xl bg-white p-2.5 shadow-md"
                  src={`data:image/png;base64,${pixModalOrder.pagamento.qr_code_base64}`}
                  alt="QR Code Pix do pedido"
                />
              </div>
            )}

            {pixModalOrder.pagamento.qr_code && <PixCopyCode code={pixModalOrder.pagamento.qr_code} />}

            <DirectPixCustomerConfirm
              order={pixModalOrder}
              apiBaseUrl={API_BASE_URL}
              onReported={(nextPayment) => {
                const updatedPayment = { ...pixModalOrder.pagamento, ...nextPayment };
                setPixModalOrder((current) => (current ? { ...current, pagamento: updatedPayment } : current));
                onOrderPaymentUpdated?.(pixModalOrder.id, updatedPayment);
              }}
            />

            <ManualPixReceiptContact order={pixModalOrder} phone={restaurantPhone} restaurantId={restaurantId} />

            {pixModalOrder.pagamento.ticket_url && (
              <a
                href={pixModalOrder.pagamento.ticket_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 flex h-10 w-full items-center justify-center rounded-xl border border-[var(--km-line)] bg-[var(--km-raised)] text-xs font-bold text-[var(--km-ink)] hover:bg-[var(--km-card)]"
              >
                Abrir link do pagamento
              </a>
            )}

            {!pixModalOrder.pagamento.confirmacao_manual && <p className="mt-3 text-xs text-[var(--km-muted)]">A confirmação do pagamento é automática.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
