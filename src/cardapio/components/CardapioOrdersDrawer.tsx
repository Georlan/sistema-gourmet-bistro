/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  CheckCircle2,
  Clock3,
  Package,
  RefreshCw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import {
  StoredOrder,
  isRejectedStatus,
  isTerminalStatus,
  orderStatusLabel,
  orderStep,
} from "../orderTracking";

interface CardapioOrdersDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  orders: StoredOrder[];
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string) => void;
  onRefresh: () => void;
  onRemoveOrder: (orderId: string) => void;
  isRefreshing?: boolean;
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
}: CardapioOrdersDrawerProps) {
  if (!isOpen) return null;

  const activeOrders = orders.filter((order) => !isTerminalStatus(order.status));
  const finishedOrders = orders.filter((order) => isTerminalStatus(order.status));

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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm transition-opacity" id="orders-drawer-backdrop">
      <div
        className="flex h-full w-full max-w-md flex-col bg-koma-card text-koma-foreground shadow-2xl transition-transform duration-300"
        role="dialog"
        aria-label="Meus Pedidos"
        id="orders-drawer-panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-koma-border p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <Package className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-black text-koma-foreground">Meus Pedidos</h2>
              <p className="text-[10px] text-koma-muted">
                {activeOrders.length > 0
                  ? `${activeOrders.length} em andamento`
                  : "Acompanhe seus pedidos em tempo real"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="grid h-9 w-9 place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-secondary transition hover:text-white disabled:opacity-50"
              title="Atualizar status"
              aria-label="Atualizar status"
            >
              <RefreshCw className={clsx("h-4 w-4", isRefreshing && "animate-spin text-emerald-400")} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-secondary transition hover:text-white"
              title="Fechar"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
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
              {/* Pedidos em andamento */}
              {activeOrders.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                      Em andamento ({activeOrders.length})
                    </span>
                  </div>

                  {activeOrders.map((order) => {
                    const rejected = isRejectedStatus(order.status);
                    const step = orderStep(order.status);
                    const isDelivery = String(order.tipo || "").toLocaleLowerCase("pt-BR").includes("delivery");
                    const steps = isDelivery
                      ? ["Recebido", "Preparo", "Saiu", "Entregue"]
                      : ["Recebido", "Preparo", "Pronto", "Concluído"];
                    const isSelected = selectedOrderId === order.id;

                    return (
                      <div
                        key={order.id}
                        className={clsx(
                          "rounded-2xl border p-4 transition-all shadow-md",
                          isSelected
                            ? "border-emerald-500 bg-emerald-950/20 ring-1 ring-emerald-500/40"
                            : "border-koma-border bg-koma-panel hover:border-emerald-500/30",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400">
                              <Clock3 className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-black text-koma-foreground">
                                  Pedido #{order.numero_pedido}
                                </span>
                                <span className="rounded-md bg-koma-raised px-1.5 py-0.5 text-[9px] font-bold text-koma-secondary">
                                  {isDelivery ? "Delivery" : "Retirada"}
                                </span>
                              </div>
                              <span className="mt-0.5 block text-[11px] font-bold text-emerald-400">
                                {orderStatusLabel(order.status)}
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

                        {/* Itens resumo */}
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

                        {/* Barra de progresso */}
                        {!rejected && (
                          <div className="mt-3 grid grid-cols-4 gap-1 border-t border-koma-border/60 pt-2.5">
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

                        {/* Ação rápida */}
                        <div className="mt-3 flex items-center justify-between border-t border-koma-border/60 pt-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectOrder(order.id);
                              onClose();
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
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Histórico / Concluídos */}
              {finishedOrders.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-koma-muted">
                      Histórico Recente ({finishedOrders.length})
                    </span>
                  </div>

                  {finishedOrders.map((order) => {
                    const rejected = isRejectedStatus(order.status);
                    const isDelivery = String(order.tipo || "").toLocaleLowerCase("pt-BR").includes("delivery");

                    return (
                      <div
                        key={order.id}
                        className="rounded-2xl border border-koma-border/80 bg-koma-panel/60 p-3.5 transition"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            <div className={clsx(
                              "grid h-8 w-8 shrink-0 place-items-center rounded-xl",
                              rejected ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400",
                            )}>
                              {rejected ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-black text-koma-foreground">
                                  Pedido #{order.numero_pedido}
                                </span>
                                <span className="rounded-md bg-koma-raised px-1.5 py-0.5 text-[8px] font-bold text-koma-muted">
                                  {isDelivery ? "Delivery" : "Retirada"}
                                </span>
                              </div>
                              <span className={clsx("mt-0.5 block text-[10px] font-bold", rejected ? "text-rose-400" : "text-emerald-400")}>
                                {orderStatusLabel(order.status)}
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

                        <div className="mt-2.5 flex items-center justify-between border-t border-koma-border/40 pt-2 text-[10px]">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectOrder(order.id);
                              onClose();
                            }}
                            className="text-koma-muted hover:text-white"
                          >
                            Ver detalhes
                          </button>
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
