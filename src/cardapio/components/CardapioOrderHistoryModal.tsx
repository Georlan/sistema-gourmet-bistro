/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { X, Clock, CheckCircle2, Package, AlertCircle, RefreshCw, ShoppingBag } from "lucide-react";
import { supabase } from "../SupabaseClient";

interface CardapioOrderHistoryModalProps {
  onClose: () => void;
  orders: any[]; // Local active or all orders passed from state
  activeBrand: any;
  user: any;
  onReorder: (items: any[]) => void;
}

export default function CardapioOrderHistoryModal({
  onClose,
  orders,
  activeBrand,
  user,
  onReorder
}: CardapioOrderHistoryModalProps) {
  const [activeTab, setActiveTab] = useState<"active" | "history">("active");
  const [historyOrders, setHistoryOrders] = useState<any[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const getStatusInfo = (status: string) => {
    const s = String(status).toUpperCase();
    switch (s) {
      case "PENDENTE_PAGAMENTO":
      case "PENDING":
        return { label: "Pendente Pagamento", color: "bg-amber-950/50 text-amber-400 border-amber-800" };
      case "RECEBIDO":
      case "PAID":
        return { label: "Recebido (Pago)", color: "bg-green-950/50 text-green-400 border-green-800" };
      case "EM_PREPARO":
      case "PREPARING":
        return { label: "Em Preparação", color: "bg-blue-950/50 text-blue-400 border-blue-800" };
      case "READY":
      case "PRONTO":
        return { label: "Pronto p/ Retirada", color: "bg-emerald-950/50 text-emerald-400 border-emerald-800" };
      case "SAIU_PARA_ENTREGA":
      case "DELIVERING":
        return { label: "Saiu para Entrega", color: "bg-indigo-950/50 text-indigo-400 border-indigo-800" };
      case "ENTREGUE":
      case "COMPLETED":
        return { label: "Entregue", color: "bg-slate-800/80 text-slate-400 border-slate-700" };
      case "CANCELADO":
      case "CANCELLED":
        return { label: "Cancelado", color: "bg-red-950/50 text-red-400 border-red-800" };
      default:
        return { label: "Pendente", color: "bg-slate-900/60 text-slate-400 border-slate-800" };
    }
  };

  const formatPrice = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value);
  };

  // Filter active orders (status is NOT 'ENTREGUE'/completed or 'CANCELADO'/cancelled)
  const activeOrders = orders.filter((order) => {
    const s = String(order.status).toUpperCase();
    return s !== "ENTREGUE" && s !== "COMPLETED" && s !== "CANCELADO" && s !== "CANCELLED";
  });

  // Load history from Supabase when History Tab is selected
  useEffect(() => {
    if (activeTab === "history" && user) {
      const userPhone = user.phone || user.telefone;
      if (!userPhone) return;

      const fetchHistory = async () => {
        setIsHistoryLoading(true);
        try {
          // Query pedidos filtering by phone
          const { data, error } = await supabase
            .from("pedidos")
            .select("*")
            .or(`customerPhone.eq.${userPhone},telefone.eq.${userPhone},customer_phone.eq.${userPhone}`);

          if (data && data.length > 0) {
            // Filter completed/cancelled for History tab
            const completed = data.filter((o: any) => {
              const s = String(o.status).toUpperCase();
              return s === "ENTREGUE" || s === "COMPLETED" || s === "CANCELADO" || s === "CANCELLED";
            });

            // Sort by date_pedido or created_at descending
            const sorted = completed.sort((a, b) => {
              const dateA = new Date(a.data_pedido || a.created_at || a.createdAt || 0).getTime();
              const dateB = new Date(b.data_pedido || b.created_at || b.createdAt || 0).getTime();
              return dateB - dateA;
            });
            setHistoryOrders(sorted);
          } else {
            // Fallback to local completed/cancelled orders
            const completedLocal = orders.filter((o: any) => {
              const s = String(o.status).toUpperCase();
              return s === "ENTREGUE" || s === "COMPLETED" || s === "CANCELADO" || s === "CANCELLED";
            });
            setHistoryOrders([...completedLocal].reverse());
          }
        } catch (err) {
          console.warn("Erro ao buscar histórico no Supabase:", err);
          // Resilient Fallback to local completed/cancelled orders
          const completedLocal = orders.filter((o: any) => {
            const s = String(o.status).toUpperCase();
            return s === "ENTREGUE" || s === "COMPLETED" || s === "CANCELADO" || s === "CANCELLED";
          });
          setHistoryOrders([...completedLocal].reverse());
        } finally {
          setIsHistoryLoading(false);
        }
      };

      fetchHistory();
    } else if (activeTab === "history" && !user) {
      // Fallback if user object is missing
      const completedLocal = orders.filter((o: any) => {
        const s = String(o.status).toUpperCase();
        return s === "ENTREGUE" || s === "COMPLETED" || s === "CANCELADO" || s === "CANCELLED";
      });
      setHistoryOrders([...completedLocal].reverse());
    }
  }, [activeTab, user, orders]);

  // Repeat Order / Adicionar ao carrinho
  const handleRepeatOrder = (order: any) => {
    if (!order.items || order.items.length === 0) {
      alert("Este pedido não possui itens válidos.");
      return;
    }

    const itemsToAdd: any[] = [];
    order.items.forEach((item: any) => {
      // Find product in current brand catalog to make sure it's still available
      const matchedProduct = activeBrand?.products?.find(
        (p: any) =>
          String(p.id) === String(item.product?.id || item.productId || item.id) ||
          p.name.toLowerCase() === item.name.toLowerCase()
      );

      if (matchedProduct && matchedProduct.isAvailable !== false) {
        itemsToAdd.push({
          product: matchedProduct,
          quantity: item.quantity || 1,
          selectedOptions: item.selectedOptions || {},
          notes: item.notes || ""
        });
      }
    });

    if (itemsToAdd.length > 0) {
      onReorder(itemsToAdd);
    } else {
      alert("Desculpe, os itens desse pedido não estão disponíveis no estoque no momento.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-fade-in" id="order-history-overlay">
      <div className="relative w-full max-w-md rounded-3xl bg-[#121420] border border-slate-800 p-6 shadow-2xl flex flex-col max-h-[85vh] animate-scale-up text-slate-100" id="order-history-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <h2 className="font-display text-base font-black uppercase tracking-wide text-white">Meus Pedidos</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition"
            id="btn-close-orders"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800/80 mt-3 shrink-0 text-xs">
          <button
            onClick={() => setActiveTab("active")}
            className={`flex-1 py-3 text-center font-bold tracking-wide uppercase transition relative ${
              activeTab === "active" ? "text-primary font-black" : "text-slate-400 hover:text-white"
            }`}
          >
            Ativos ({activeOrders.length})
            {activeTab === "active" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex-1 py-3 text-center font-bold tracking-wide uppercase transition relative ${
              activeTab === "history" ? "text-primary font-black" : "text-slate-400 hover:text-white"
            }`}
          >
            Histórico
            {activeTab === "history" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        </div>

        {/* Scrollable Lists */}
        <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1 no-scrollbar text-xs">
          {activeTab === "active" ? (
            /* ACTIVE ORDERS TAB */
            activeOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
                <AlertCircle className="h-10 w-10 text-slate-600" />
                <p className="font-semibold text-slate-400 text-xs">Não há pedidos ativos no momento.</p>
                <p className="text-[10px] text-slate-500">Faça um novo pedido na loja para acompanhá-lo aqui!</p>
              </div>
            ) : (
              [...activeOrders].reverse().map((order: any) => {
                const status = getStatusInfo(order.status);
                const displayId = String(order.id).length > 6 ? `PED-${String(order.id).slice(-4).toUpperCase()}` : `PED-${order.id}`;
                const supportMessage = `Olá, gostaria de saber o status do meu pedido ${displayId}`;
                const whatsappUrl = `https://wa.me/${activeBrand?.phone || "5511999999999"}?text=${encodeURIComponent(supportMessage)}`;

                return (
                  <div
                    key={order.id}
                    className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 space-y-3.5 shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[8px] font-extrabold text-slate-500 tracking-wider block uppercase">LOJA / PEDIDO {displayId}</span>
                        <h4 className="text-xs font-black text-white">{order.brandName || activeBrand?.name}</h4>
                      </div>
                      <span className={`text-[9px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${status.color}`}>
                        {status.label}
                      </span>
                    </div>

                    <div className="border-t border-b border-slate-800/50 py-2.5 space-y-1.5 text-slate-300">
                      {order.items.map((item: any, iIdx: number) => (
                        <div key={iIdx} className="flex justify-between items-start">
                          <span>
                            {item.quantity}x <strong className="font-bold text-white">{item.name}</strong>
                            {item.optionsText && (
                              <span className="block text-[10px] text-slate-400">({item.optionsText})</span>
                            )}
                          </span>
                          <span className="font-medium text-white">{formatPrice(item.price * item.quantity)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-between items-center gap-2">
                      <span className="text-[9px] text-slate-500 font-bold uppercase flex items-center gap-1">
                        <Clock className="h-3 w-3 text-emerald-400 animate-pulse" />
                        {new Date(order.createdAt || order.data_pedido).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <span className="text-[8px] text-slate-500 font-bold block uppercase">Total</span>
                          <span className="font-black text-emerald-400 text-sm">{formatPrice(order.total)}</span>
                        </div>

                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 bg-slate-800/80 hover:bg-slate-700 hover:text-white active:scale-95 text-slate-400 text-[9px] font-bold uppercase tracking-wider rounded-xl transition flex items-center gap-1 shrink-0"
                        >
                          💬 Dúvidas sobre o pedido?
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            /* COMPLETED HISTORY TAB */
            isHistoryLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                <RefreshCw className="h-8 w-8 text-primary animate-spin" />
                <p className="font-semibold text-slate-400">Carregando histórico do Supabase...</p>
              </div>
            ) : historyOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
                <AlertCircle className="h-10 w-10 text-slate-600" />
                <p className="font-semibold text-slate-400">Nenhum pedido finalizado encontrado.</p>
              </div>
            ) : (
              historyOrders.map((order: any) => {
                const status = getStatusInfo(order.status);
                // Display numeric ID as PED-XXXX or actual string ID
                const displayId = String(order.id).length > 6 ? `PED-${String(order.id).slice(-4).toUpperCase()}` : `PED-${order.id}`;
                const orderDate = new Date(order.data_pedido || order.createdAt || order.created_at);

                return (
                  <div
                    key={order.id}
                    className="rounded-2xl border border-slate-800/80 bg-slate-900/20 p-4 space-y-3.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[8px] font-extrabold text-slate-500 tracking-wider block uppercase">CÓDIGO DE COMPRA</span>
                        <h4 className="text-xs font-black text-white">{displayId}</h4>
                      </div>
                      <span className={`text-[9px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${status.color}`}>
                        {status.label}
                      </span>
                    </div>

                    <div className="border-t border-b border-slate-800/50 py-2.5 space-y-1.5 text-slate-400">
                      {order.items && Array.isArray(order.items) ? (
                        order.items.map((item: any, iIdx: number) => (
                          <div key={iIdx} className="flex justify-between items-start text-[11px]">
                            <span>
                              {item.quantity}x <strong className="font-semibold text-slate-300">{item.name}</strong>
                            </span>
                            <span className="font-medium text-slate-300">{formatPrice(item.price * item.quantity)}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-[10px] text-slate-500">Resumo de itens indisponível.</p>
                      )}
                    </div>

                    <div className="flex justify-between items-end">
                      <span className="text-[9px] text-slate-500 font-bold uppercase block leading-normal">
                        {orderDate.toLocaleDateString("pt-BR")} às{" "}
                        {orderDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-[8px] text-slate-500 font-bold block uppercase">Valor Total</span>
                          <span className="font-black text-emerald-400">{formatPrice(order.total)}</span>
                        </div>
                        
                        <button
                          onClick={() => handleRepeatOrder(order)}
                          className="px-3 py-1.5 bg-primary hover:opacity-90 active:scale-95 text-slate-950 text-[10px] font-black uppercase tracking-wider rounded-xl transition"
                        >
                          Repetir Pedido
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>

        {/* Footer info tip */}
        <div className="mt-4 pt-3 border-t border-slate-800 text-center shrink-0">
          <p className="text-[9px] text-slate-500 leading-tight">
            💡 <strong className="text-slate-400">Acompanhamento:</strong> Pedidos ativos atualizam em tempo real conforme as etapas da cozinha.
          </p>
        </div>
      </div>
    </div>
  );
}
