/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  CheckCircle2,
  Clock3,
  MessageCircle,
  Package,
  RefreshCw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { API_BASE_URL } from "../../config/api";
import {
  StoredOrder,
  resolveOrderState,
} from "../orderTracking";
import CardapioOrderChatPanel from "./CardapioOrderChatPanel";

interface CardapioOrdersDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  orders: StoredOrder[];
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string) => void;
  onRefresh: () => void;
  onRemoveOrder: (orderId: string) => void;
  isRefreshing?: boolean;
  hasFloatingCart?: boolean;
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

export default function CardapioOrdersDrawer({
  isOpen,
  onClose,
  orders,
  selectedOrderId,
  onSelectOrder,
  onRefresh,
  onRemoveOrder,
  isRefreshing = false,
  hasFloatingCart = false,
}: CardapioOrdersDrawerProps) {
  const [chatOrderId, setChatOrderId] = React.useState<string | null>(null);
  const [floatingOpen, setFloatingOpen] = React.useState(false);
  const [unreadByOrder, setUnreadByOrder] = React.useState<Record<string, number>>({});
  const drawerOpen = isOpen || floatingOpen;

  const ordersWithChat = React.useMemo(
    () => orders.filter((order) => Boolean(resolveTrackingToken(order))),
    [orders],
  );

  const refreshUnreadCounts = React.useCallback(async () => {
    const targets = ordersWithChat
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
            `${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${encodeURIComponent(token)}`,
            { cache: "no-store" },
          );
          if (!response.ok) return null;
          const payload = await response.json() as { conversa?: { unread_count?: number } };
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
      Object.keys(next).forEach((orderId) => {
        if (!ordersWithChat.some((order) => order.id === orderId)) delete next[orderId];
      });
      return next;
    });
  }, [ordersWithChat]);

  React.useEffect(() => {
    void refreshUnreadCounts();
    const interval = window.setInterval(() => {
      if (!document.hidden) void refreshUnreadCounts();
    }, 6000);
    const onVisibilityChange = () => {
      if (!document.hidden) void refreshUnreadCounts();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshUnreadCounts]);

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
    () => ordersWithChat.reduce((total, order) => total + unreadFor(order.id), 0),
    [ordersWithChat, unreadFor],
  );

  const sortUnreadFirst = React.useCallback(
    (left: StoredOrder, right: StoredOrder) => {
      const unreadDelta = unreadFor(right.id) - unreadFor(left.id);
      if (unreadDelta !== 0) return unreadDelta;
      return Number(right.timestamp || 0) - Number(left.timestamp || 0);
    },
    [unreadFor],
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
    const activeOrderForFab = preferredChatOrder || activeOrders[0] || null;
    if (!activeOrderForFab) return null;

    const displayOrder = activeOrderForFab;
    const displayState = resolveOrderState(displayOrder);
    const isChatAvailable = Boolean(resolveTrackingToken(displayOrder)) && displayState.can_chat;
    const statusText = displayState.label;

    return (
      <div
        className={clsx(
          "fixed right-4 z-40 sm:right-6 transition-all duration-300 pointer-events-auto",
          hasFloatingCart
            ? "bottom-24"
            : "bottom-5 sm:bottom-6 pb-[env(safe-area-inset-bottom,0px)]"
        )}
        id="floating-order-chat-container"
      >
        <button
          type="button"
          onClick={() => {
            if (totalUnread > 0 && preferredChatOrder) {
              openFloatingChat();
            } else {
              setFloatingOpen(true);
            }
          }}
          className={clsx(
            "group relative flex min-h-12 items-center gap-2.5 rounded-full border border-emerald-500/40 bg-[#0d1612]/95 px-3.5 py-2 text-emerald-100 shadow-2xl backdrop-blur-md transition hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-[#13261c] active:scale-95 cursor-pointer",
            totalUnread > 0 ? "ring-4 ring-emerald-500/20" : ""
          )}
          id="floating-order-chat-trigger"
          aria-label={totalUnread > 0
            ? `Abrir chat do pedido, ${totalUnread} ${totalUnread === 1 ? "mensagem nova" : "mensagens novas"}`
            : "Abrir chat do pedido"}
        >
          {totalUnread > 0 ? (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-emerald-400 px-1 text-[10px] font-black text-black shadow-lg animate-pulse">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          ) : (
            <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
          )}
          <span className={clsx(
            "grid h-8 w-8 place-items-center rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 shrink-0",
            totalUnread > 0 && "animate-pulse"
          )}>
            {isChatAvailable ? <MessageCircle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
          </span>
          <div className="text-left pr-1">
            <div className="flex items-center gap-1.5">
              <span className="block text-[9px] font-black uppercase tracking-wider text-emerald-400">
                Pedido #{displayOrder.numero_pedido}
              </span>
              <strong className="text-[10px] font-black text-emerald-300">
                {totalUnread > 0 ? "Nova mensagem" : "Chat do pedido"}
              </strong>
            </div>
            <span className="block text-[11px] font-bold text-white leading-tight">
              {statusText} · <small className="text-[9px] text-emerald-200/70 font-normal">Fale com o restaurante</small>
            </span>
          </div>
        </button>
      </div>
    );
  }

  if (chatOrder) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm transition-opacity" id="orders-drawer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
        <div
          className="flex h-full w-full max-w-md flex-col bg-koma-card text-koma-foreground shadow-2xl transition-transform duration-300"
          role="dialog"
          aria-label={`Chat do Pedido #${chatOrder.numero_pedido}`}
          id="orders-drawer-panel"
        >
          <CardapioOrderChatPanel
            order={chatOrder}
            onBack={() => setChatOrderId(null)}
            onClose={closeDrawer}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm transition-opacity" id="orders-drawer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-koma-card text-koma-foreground shadow-2xl transition-transform duration-300"
        role="dialog"
        aria-label="Meus Pedidos"
        id="orders-drawer-panel"
      >
        <div className="flex items-center justify-between border-b border-koma-border p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <Package className="h-5 w-5 text-emerald-400" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-koma-foreground">Meus Pedidos</h2>
                {totalUnread > 0 && (
                  <span className="rounded-full bg-emerald-400 px-2 py-0.5 text-[9px] font-black text-black">
                    {totalUnread} {totalUnread === 1 ? "nova" : "novas"}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-koma-muted">
                {totalUnread > 0
                  ? "O restaurante respondeu. Abra a conversa destacada."
                  : activeOrders.length > 0
                    ? `${activeOrders.length} em andamento`
                    : "Acompanhe seus pedidos e converse com o restaurante"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onRefresh();
                void refreshUnreadCounts();
              }}
              disabled={isRefreshing}
              className="grid h-9 w-9 place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-secondary transition hover:text-white disabled:opacity-50"
              title="Atualizar status"
              aria-label="Atualizar status"
            >
              <RefreshCw className={clsx("h-4 w-4", isRefreshing && "animate-spin text-emerald-400")} />
            </button>
            <button
              type="button"
              onClick={closeDrawer}
              className="grid h-9 w-9 place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-secondary transition hover:text-white"
              title="Fechar"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl border border-koma-border bg-koma-panel text-koma-muted">
                <Package className="h-8 w-8 opacity-40" />
              </div>
              <h3 className="mt-4 text-sm font-bold text-koma-foreground">Nenhum pedido recente</h3>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-koma-muted">
                Quando você enviar um pedido pelo cardápio, ele aparecerá aqui para você acompanhar cada etapa do preparo e entrega.
              </p>
            </div>
          ) : (
            <>
              {activeOrders.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                      Em andamento ({activeOrders.length})
                    </span>
                  </div>

                  {activeOrders.map((order) => {
                    const state = resolveOrderState(order);
                    const rejected = state.rejected;
                    const isDelivery = state.fulfillment === "delivery";
                    const step = state.progress_step;
                    const steps = isDelivery
                      ? ["Recebido", "Preparo", "Pronto", "Saiu", "Entregue"]
                      : ["Recebido", "Preparo", "Pronto", "Concluído"];
                    const isSelected = selectedOrderId === order.id;
                    const unread = unreadFor(order.id);

                    return (
                      <div
                        key={order.id}
                        className={clsx(
                          "rounded-2xl border p-4 transition-all shadow-md",
                          unread > 0
                            ? "border-emerald-400 bg-emerald-950/30 ring-1 ring-emerald-400/40"
                            : isSelected
                              ? "border-emerald-500 bg-emerald-950/20 ring-1 ring-emerald-500/40"
                              : "border-koma-border bg-koma-panel hover:border-emerald-500/30",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            <div className={clsx(
                              "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                              unread > 0 ? "bg-emerald-400 text-black" : "bg-emerald-500/15 text-emerald-400",
                            )}>
                              {unread > 0 ? <MessageCircle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-black text-koma-foreground">
                                  Pedido #{order.numero_pedido}
                                </span>
                                <span className="rounded-md bg-koma-raised px-1.5 py-0.5 text-[9px] font-bold text-koma-secondary">
                                  {isDelivery ? "Delivery" : "Retirada"}
                                </span>
                                {unread > 0 && (
                                  <span className="rounded-full bg-emerald-400 px-2 py-0.5 text-[8px] font-black uppercase tracking-wide text-black animate-pulse">
                                    {unread} {unread === 1 ? "nova" : "novas"}
                                  </span>
                                )}
                              </div>
                              <span className="mt-0.5 block text-[11px] font-bold text-emerald-400">
                                {unread > 0 ? "O restaurante respondeu" : state.label}
                              </span>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-xs font-black text-koma-foreground">
                              {formatCurrency(order.total)}
                            </span>
                            <span className="mt-0.5 block text-[9px] text-koma-muted">
                              {formatTime(order.timestamp)}
                            </span>
                          </div>
                        </div>

                        {Array.isArray(order.itens) && order.itens.length > 0 && (
                          <div className="mt-2.5 space-y-0.5 border-t border-koma-border/60 pt-2 text-[10px] text-koma-muted">
                            {order.itens.slice(0, 3).map((item, idx) => (
                              <div key={idx} className="truncate">
                                • {item.quantidade}x {item.nome}
                              </div>
                            ))}
                            {order.itens.length > 3 && (
                              <span className="text-[9px] text-koma-subtle">
                                + {order.itens.length - 3} itens adicionais
                              </span>
                            )}
                          </div>
                        )}

                        {!rejected && (
                          <div className={clsx(
                            "mt-3 grid gap-1 border-t border-koma-border/60 pt-2.5",
                            isDelivery ? "grid-cols-5" : "grid-cols-4",
                          )}>
                            {steps.map((label, idx) => {
                              const passed = step >= idx + 1;
                              return (
                                <div key={label} className="text-center">
                                  <div className={clsx("h-1 rounded-full", passed ? "bg-emerald-500" : "bg-koma-raised")} />
                                  <span className={clsx("mt-1 block text-[8px] font-bold", passed ? "text-emerald-300" : "text-koma-subtle")}>
                                    {label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between border-t border-koma-border/60 pt-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                onSelectOrder(order.id);
                                closeDrawer();
                              }}
                              className={clsx(
                                "rounded-xl px-3 py-1.5 text-[10px] font-black transition",
                                isSelected
                                  ? "bg-emerald-500 text-white"
                                  : "border border-koma-border bg-koma-card text-koma-secondary hover:text-white",
                              )}
                            >
                              {isSelected ? "Acompanhando no topo" : "Ver no topo"}
                            </button>

                            {(order.tracking_url || order.tracking_token) && state.can_chat && (
                              <button
                                type="button"
                                onClick={() => openChat(order.id)}
                                className={clsx(
                                  "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[10px] font-black transition",
                                  unread > 0
                                    ? "border-emerald-300 bg-emerald-400 text-black hover:bg-emerald-300"
                                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20",
                                )}
                              >
                                <MessageCircle className="h-3.5 w-3.5" />
                                {unread > 0 ? `Abrir ${unread === 1 ? "mensagem" : "mensagens"}` : "Chat & Status"}
                              </button>
                            )}
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
                    <span className="text-[10px] font-black uppercase tracking-wider text-koma-muted">
                      Histórico Recente ({finishedOrders.length})
                    </span>
                  </div>

                  {finishedOrders.map((order) => {
                    const state = resolveOrderState(order);
                    const rejected = state.rejected;
                    const isDelivery = state.fulfillment === "delivery";
                    const unread = unreadFor(order.id);

                    return (
                      <div
                        key={order.id}
                        className={clsx(
                          "rounded-2xl border p-3.5 transition",
                          unread > 0
                            ? "border-emerald-400/70 bg-emerald-950/25"
                            : "border-koma-border/80 bg-koma-panel/60",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            <div className={clsx(
                              "grid h-8 w-8 shrink-0 place-items-center rounded-xl",
                              unread > 0
                                ? "bg-emerald-400 text-black"
                                : rejected
                                  ? "bg-rose-500/15 text-rose-400"
                                  : "bg-emerald-500/15 text-emerald-400",
                            )}>
                              {unread > 0 ? <MessageCircle className="h-4 w-4" /> : rejected ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-black text-koma-foreground">
                                  Pedido #{order.numero_pedido}
                                </span>
                                <span className="rounded-md bg-koma-raised px-1.5 py-0.5 text-[8px] font-bold text-koma-muted">
                                  {isDelivery ? "Delivery" : "Retirada"}
                                </span>
                                {unread > 0 && (
                                  <span className="rounded-full bg-emerald-400 px-1.5 py-0.5 text-[8px] font-black text-black">
                                    {unread} nova{unread > 1 ? "s" : ""}
                                  </span>
                                )}
                              </div>
                              <span className={clsx("mt-0.5 block text-[10px] font-bold", rejected ? "text-rose-400" : "text-emerald-400")}>
                                {unread > 0 ? "Nova resposta do restaurante" : state.label}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1">
                            <span className="text-xs font-bold text-koma-secondary">
                              {formatCurrency(order.total)}
                            </span>
                            <span className="text-[9px] text-koma-subtle">
                              {formatTime(order.timestamp)}
                            </span>
                          </div>
                        </div>

                        <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-koma-border/40 pt-2 text-[10px]">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                onSelectOrder(order.id);
                                closeDrawer();
                              }}
                              className="text-koma-muted hover:text-white"
                            >
                              Ver detalhes
                            </button>
                            {(order.tracking_url || order.tracking_token) && (
                              <button
                                type="button"
                                onClick={() => openChat(order.id)}
                                className={clsx(
                                  "inline-flex items-center gap-1 font-bold",
                                  unread > 0 ? "text-emerald-300" : "text-emerald-400 hover:text-emerald-300",
                                )}
                              >
                                <MessageCircle className="h-3 w-3" /> {unread > 0 ? "Ler mensagem" : "Chat"}
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => onRemoveOrder(order.id)}
                            className="flex items-center gap-1 text-koma-subtle hover:text-rose-400"
                            title="Remover do histórico local"
                          >
                            <Trash2 className="h-3 w-3" />
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
    </div>
  );
}
