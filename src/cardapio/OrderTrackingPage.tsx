/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  MapPin,
  MessageSquare,
  Package,
  Send,
  Sparkles,
  Truck,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { API_BASE_URL } from "../config/api";
import { saveStoredOrder, StoredOrder } from "./orderTracking";

interface TrackingOrderItem {
  id?: string;
  nome: string;
  quantidade: number;
  preco_unitario: number;
  observacao?: string | null;
}

interface TrackingRestaurantInfo {
  id: number;
  nome: string;
  slug?: string | null;
}

interface TrackingOrderData {
  id: string;
  numero_pedido: number;
  status: string;
  tipo: string;
  criado_em?: string | null;
  total: number;
  delivery_taxa?: number;
  delivery_endereco?: string | null;
  delivery_bairro?: string | null;
  forma_pagamento?: string | null;
  restaurante: TrackingRestaurantInfo;
  itens: TrackingOrderItem[];
  closed_at?: string | null;
}

interface TrackingMessage {
  id: string;
  conversation_id: string;
  pedido_id: string;
  sender_type: "system" | "customer" | "staff";
  sender_user_id?: number | null;
  body: string;
  event_key?: string | null;
  created_at?: string | null;
}

interface OrderTrackingPageProps {
  token?: string | null;
}

export function OrderTrackingPage({ token: propToken }: OrderTrackingPageProps) {
  const token = useMemo(() => {
    if (propToken && propToken.trim()) return propToken.trim();
    // Tenta obter da URL: /acompanhar/:token ou ?token=...
    const urlParams = new URLSearchParams(window.location.search);
    const queryToken = urlParams.get("token");
    if (queryToken && queryToken.trim()) return queryToken.trim();

    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const acompanharIdx = pathParts.indexOf("acompanhar");
    if (acompanharIdx !== -1 && pathParts[acompanharIdx + 1]) {
      return pathParts[acompanharIdx + 1].trim();
    }
    return null;
  }, [propToken]);

  const [order, setOrder] = useState<TrackingOrderData | null>(null);
  const [messages, setMessages] = useState<TrackingMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    return typeof Notification !== "undefined" && Notification.permission === "granted";
  });

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef<number>(0);

  const scrollToBottom = useCallback((smooth = true) => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    }
  }, []);

  // Notificação do navegador
  const triggerNotification = useCallback((title: string, body: string) => {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      document.visibilityState !== "visible"
    ) {
      try {
        new Notification(title, {
          body,
          icon: "/favicon.ico",
        });
      } catch (e) {
        console.warn("Falha ao emitir notificação no navegador:", e);
      }
    }
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    try {
      const perm = await Notification.requestPermission();
      setNotificationsEnabled(perm === "granted");
    } catch (e) {
      console.warn("Erro ao solicitar permissão de notificações:", e);
    }
  }, []);

  // Carrega dados iniciais do pedido e mensagens
  const loadInitialData = useCallback(async (currentToken: string) => {
    try {
      const [orderRes, msgsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${currentToken}`),
        fetch(`${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${currentToken}/messages`),
      ]);

      if (!orderRes.ok) {
        if (orderRes.status === 404) {
          throw new Error("Pedido não encontrado ou link expirado.");
        }
        throw new Error("Não foi possível carregar os dados do pedido.");
      }

      const orderData: TrackingOrderData = await orderRes.json();
      setOrder(orderData);
      prevStatusRef.current = orderData.status;

      // Sincroniza pedido no localStorage local para histórico do cliente
      try {
        const storedOrder: StoredOrder = {
          id: orderData.id,
          numero_pedido: orderData.numero_pedido,
          timestamp: Date.now(),
          restaurante_id: orderData.restaurante.id,
          tipo: orderData.tipo,
          total: orderData.total,
          idempotency_key: `tracking-${orderData.id}`,
          status: orderData.status,
          itens: orderData.itens.map((it) => ({
            id: it.id,
            nome: it.nome,
            quantidade: it.quantidade,
            observacao: it.observacao || undefined,
          })),
        };
        saveStoredOrder(storedOrder);
      } catch (storageErr) {
        console.warn("Não foi possível persistir no localStorage:", storageErr);
      }

      if (msgsRes.ok) {
        const msgsData: TrackingMessage[] = await msgsRes.json();
        setMessages(msgsData);
        prevMsgCountRef.current = msgsData.length;
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Erro ao carregar o acompanhamento.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Conexão SSE em tempo real com fallback para polling curto
  useEffect(() => {
    if (!token) {
      setError("Código de acompanhamento não fornecido.");
      setLoading(false);
      return;
    }

    loadInitialData(token);

    // Configura SSE
    const sseUrl = `${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${token}/events`;
    let sse: EventSource | null = null;
    try {
      sse = new EventSource(sseUrl);
      eventSourceRef.current = sse;

      sse.addEventListener("message", (event: MessageEvent) => {
        try {
          const newMsg: TrackingMessage = JSON.parse(event.data);
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          if (newMsg.sender_type === "staff") {
            triggerNotification(
              `Mensagem do ${order?.restaurante.nome || "Restaurante"}`,
              newMsg.body,
            );
          }
          setTimeout(() => scrollToBottom(true), 50);
        } catch (parseErr) {
          console.warn("Erro ao processar evento SSE message:", parseErr);
        }
      });

      sse.addEventListener("status", (event: MessageEvent) => {
        try {
          const statusPayload = JSON.parse(event.data);
          const newStatus = statusPayload.status;
          setOrder((prev) => (prev ? { ...prev, status: newStatus, closed_at: statusPayload.closed_at ?? prev.closed_at } : prev));
          triggerNotification(
            `Status do Pedido #${order?.numero_pedido || ""}`,
            statusPayload.body || `Status atualizado: ${newStatus}`,
          );
        } catch (parseErr) {
          console.warn("Erro ao processar evento SSE status:", parseErr);
        }
      });
    } catch (sseErr) {
      console.warn("SSE indisponível, utilizando fallback polling:", sseErr);
    }

    // Polling de fallback a cada 6 segundos
    const pollInterval = setInterval(() => {
      fetch(`${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${token}/messages`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data: TrackingMessage[]) => {
          if (Array.isArray(data) && data.length > 0) {
            setMessages(data);
          }
        })
        .catch(() => {});

      fetch(`${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${token}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: TrackingOrderData | null) => {
          if (data) {
            setOrder((prev) => {
              if (prev && prev.status !== data.status) {
                triggerNotification(
                  `Status do Pedido #${data.numero_pedido}`,
                  `Status atualizado para: ${data.status}`,
                );
              }
              return data;
            });
          }
        })
        .catch(() => {});
    }, 6000);

    return () => {
      clearInterval(pollInterval);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [token, loadInitialData, triggerNotification, scrollToBottom]);

  // Marca lidas ao focar a página ou carregar novas mensagens
  useEffect(() => {
    if (!token) return;
    const markRead = () => {
      fetch(`${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${token}/read`, {
        method: "POST",
      }).catch(() => {});
    };

    if (document.visibilityState === "visible") {
      markRead();
    }
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        markRead();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [token, messages.length]);

  // Rola ao fim ao carregar mensagens inicialmente
  useEffect(() => {
    scrollToBottom(false);
  }, [messages.length, scrollToBottom]);

  // Envio de mensagem pelo cliente
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !inputText.trim() || sending) return;

    setSending(true);
    setSendError(null);
    const bodyToSend = inputText.trim();

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${token}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: bodyToSend }),
        },
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || "Erro ao enviar mensagem.");
      }

      const sentMsg: TrackingMessage = await res.json();
      setMessages((prev) => {
        if (prev.some((m) => m.id === sentMsg.id)) return prev;
        return [...prev, sentMsg];
      });
      setInputText("");
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: any) {
      setSendError(err?.message || "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  };

  const isClosed = useMemo(() => {
    if (!order?.closed_at) return false;
    return new Date().getTime() > new Date(order.closed_at).getTime();
  }, [order?.closed_at]);

  // Etapas da Timeline Canônica
  const currentStep = useMemo(() => {
    if (!order) return 0;
    const st = (order.status || "").toLowerCase();
    if (st === "recusado" || st === "cancelado") return -1;
    if (st === "finalizado") return 4;
    if (st === "transito") return 3;
    if (st === "pronto") return 2;
    if (st === "producao") return 1;
    return 0; // 'pendente' ou 'analise'
  }, [order?.status]);

  const timelineSteps = useMemo(() => {
    const isDelivery = (order?.tipo || "").toLowerCase().includes("delivery") || (order?.tipo || "").toLowerCase().includes("entrega");
    return [
      { label: "Recebido", desc: "Pedido enviado à cozinha" },
      { label: "Em preparo", desc: "Cozinha preparando seu prato" },
      { label: "Pronto", desc: isDelivery ? "Aguardando entregador" : "Pronto para retirada" },
      { label: isDelivery ? "A caminho" : "Balcão", desc: isDelivery ? "Saiu para entrega" : "Disponível para retirar" },
      { label: "Concluído", desc: "Entregue e finalizado" },
    ];
  }, [order?.tipo]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090a0f] text-[#e0e0e0] flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">
          Localizando seu pedido…
        </p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-[#090a0f] text-[#e0e0e0] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mb-4">
          <XCircle size={32} />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Pedido não encontrado</h1>
        <p className="text-sm text-zinc-400 max-w-md mb-6">
          {error || "O código de acompanhamento é inválido ou o atendimento já foi expirado."}
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/cardapio";
          }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          Voltar ao Cardápio
        </button>
      </div>
    );
  }

  const isRecusado = currentStep === -1;

  return (
    <div className="min-h-screen bg-[#090a0f] text-zinc-100 flex flex-col">
      {/* Topbar */}
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-[#0d0f15]/90 backdrop-blur-md px-4 py-3 sm:px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                const restaurantParam = order.restaurante.slug
                  ? `slug=${order.restaurante.slug}`
                  : `restaurant_id=${order.restaurante.id}`;
                window.location.href = `/cardapio?${restaurantParam}`;
              }}
              className="w-9 h-9 rounded-xl bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 flex items-center justify-center transition-colors"
              title="Voltar ao cardápio"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                {order.restaurante.nome}
              </span>
              <h1 className="text-base font-bold text-white leading-tight">
                Pedido #{order.numero_pedido}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!notificationsEnabled && typeof Notification !== "undefined" && (
              <button
                type="button"
                onClick={requestNotificationPermission}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition-colors"
                title="Ativar avisos de atualização no navegador"
              >
                <Bell size={14} className="text-emerald-400" />
                <span>Ativar avisos</span>
              </button>
            )}
            <span
              className={clsx(
                "px-3 py-1 rounded-full text-xs font-semibold tracking-wide capitalize",
                isRecusado
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  : currentStep === 4
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30",
              )}
            >
              {isRecusado ? "Recusado" : order.status}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto w-full p-4 sm:p-6 flex-1 flex flex-col gap-6">
        {/* Timeline Visual */}
        <section className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 sm:p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
              <Sparkles size={16} className="text-emerald-400" />
              Linha do Tempo ao Vivo
            </h2>
            <span className="text-xs text-zinc-400 font-mono">
              {order.tipo}
            </span>
          </div>

          {isRecusado ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-3">
              <AlertCircle size={20} className="text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-rose-200 text-sm font-semibold block">
                  Pedido não aceito pelo restaurante
                </strong>
                <p className="text-xs text-rose-300/80 mt-0.5">
                  Infelizmente o restaurante não pôde prosseguir com seu pedido neste momento. Verifique a conversa abaixo para mais informações.
                </p>
              </div>
            </div>
          ) : (
            <div className="relative">
              {/* Barra de progresso para desktop */}
              <div className="hidden md:grid grid-cols-5 gap-2 relative">
                {timelineSteps.map((step, idx) => {
                  const isPassed = idx < currentStep;
                  const isCurrent = idx === currentStep;
                  return (
                    <div key={step.label} className="flex flex-col items-center text-center relative">
                      <div
                        className={clsx(
                          "w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs transition-all mb-2 z-10",
                          isPassed
                            ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
                            : isCurrent
                            ? "bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500 ring-4 ring-emerald-500/10 animate-pulse"
                            : "bg-zinc-800 text-zinc-500 border border-zinc-700",
                        )}
                      >
                        {isPassed ? <Check size={16} /> : idx + 1}
                      </div>
                      <span
                        className={clsx(
                          "text-xs font-semibold block mb-0.5",
                          isCurrent ? "text-emerald-400" : isPassed ? "text-zinc-200" : "text-zinc-500",
                        )}
                      >
                        {step.label}
                      </span>
                      <span className="text-[10px] text-zinc-500 max-w-[120px] leading-tight">
                        {step.desc}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Linha vertical para mobile */}
              <div className="md:hidden flex flex-col gap-4 pl-2 border-l-2 border-zinc-800 ml-4">
                {timelineSteps.map((step, idx) => {
                  const isPassed = idx < currentStep;
                  const isCurrent = idx === currentStep;
                  return (
                    <div key={step.label} className="relative pl-6">
                      <div
                        className={clsx(
                          "absolute -left-[25px] top-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all",
                          isPassed
                            ? "bg-emerald-500 text-black"
                            : isCurrent
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500 ring-2 ring-emerald-500/20 animate-pulse"
                            : "bg-zinc-800 text-zinc-500",
                        )}
                      >
                        {isPassed ? <Check size={12} /> : idx + 1}
                      </div>
                      <span
                        className={clsx(
                          "text-xs font-semibold block",
                          isCurrent ? "text-emerald-400" : isPassed ? "text-zinc-200" : "text-zinc-500",
                        )}
                      >
                        {step.label}
                      </span>
                      <span className="text-[11px] text-zinc-400 block mt-0.5">
                        {step.desc}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Grade principal: Resumo do Pedido + Chat com Restaurante */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Coluna Esquerda: Itens e Detalhes do Pedido (5 cols) */}
          <section className="lg:col-span-5 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 backdrop-blur-sm flex flex-col gap-4">
            <h2 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
              <Package size={15} className="text-emerald-400" />
              Itens do Pedido
            </h2>

            <div className="divide-y divide-zinc-800/60 max-h-60 overflow-y-auto pr-1">
              {order.itens.map((it, idx) => (
                <div key={`${it.id || it.nome}-${idx}`} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-200 truncate">
                      <span className="text-emerald-400 font-semibold mr-1.5">{it.quantidade}x</span>
                      {it.nome}
                    </p>
                    {it.observacao && (
                      <p className="text-xs text-zinc-400 italic mt-0.5">
                        Obs: {it.observacao}
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-mono text-zinc-300 whitespace-nowrap">
                    R$ {(it.preco_unitario * it.quantidade).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-zinc-800/80 pt-3 space-y-1.5 text-xs text-zinc-400">
              {Boolean(order.delivery_taxa) && (
                <div className="flex justify-between">
                  <span>Taxa de entrega</span>
                  <span className="font-mono text-zinc-300">R$ {Number(order.delivery_taxa).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold text-white pt-1">
                <span>Total</span>
                <span className="font-mono text-emerald-400">R$ {order.total.toFixed(2)}</span>
              </div>
            </div>

            {order.delivery_endereco && (
              <div className="border-t border-zinc-800/80 pt-3 flex items-start gap-2.5 text-xs text-zinc-300">
                <MapPin size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="block text-zinc-200">Endereço de entrega</strong>
                  <span>{order.delivery_endereco}</span>
                  {order.delivery_bairro && <span className="text-zinc-400 block">{order.delivery_bairro}</span>}
                </div>
              </div>
            )}
          </section>

          {/* Coluna Direita: Chat Texto em Tempo Real (7 cols) */}
          <section className="lg:col-span-7 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl flex flex-col h-[520px] backdrop-blur-sm overflow-hidden">
            {/* Cabeçalho do Chat */}
            <div className="px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-950/40 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <MessageSquare size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-zinc-200">
                    Conversa com o Restaurante
                  </h3>
                  <span className="text-[10px] text-zinc-500 block">
                    Respostas em tempo real via sistema próprio KÔMA
                  </span>
                </div>
              </div>
              {isClosed && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                  Encerrado
                </span>
              )}
            </div>

            {/* Lista de Mensagens */}
            <div
              ref={chatScrollRef}
              className="flex-1 p-4 overflow-y-auto space-y-3.5"
            >
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 text-xs">
                  <MessageSquare size={28} className="mb-2 opacity-30" />
                  <p>Inicie uma conversa caso tenha alguma dúvida sobre seu pedido.</p>
                </div>
              ) : (
                messages.map((msg) => {
                  if (msg.sender_type === "system") {
                    return (
                      <div key={msg.id} className="flex justify-center my-2">
                        <span className="px-3 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/60 text-[11px] text-zinc-300 font-medium">
                          {msg.body}
                        </span>
                      </div>
                    );
                  }

                  const isCustomer = msg.sender_type === "customer";
                  return (
                    <div
                      key={msg.id}
                      className={clsx(
                        "flex flex-col max-w-[85%]",
                        isCustomer ? "ml-auto items-end" : "mr-auto items-start",
                      )}
                    >
                      <span className="text-[10px] text-zinc-500 mb-1 px-1">
                        {isCustomer ? "Você" : order.restaurante.nome}
                      </span>
                      <div
                        className={clsx(
                          "rounded-2xl px-3.5 py-2 text-xs leading-relaxed break-words",
                          isCustomer
                            ? "bg-emerald-600 text-white rounded-tr-none shadow-sm shadow-emerald-950/40"
                            : "bg-zinc-800 border border-zinc-700/60 text-zinc-200 rounded-tl-none",
                        )}
                        dangerouslySetInnerHTML={{ __html: msg.body }}
                      />
                      {msg.created_at && (
                        <span className="text-[9px] text-zinc-600 mt-1 px-1 font-mono">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Input de Mensagem */}
            <div className="p-3 border-t border-zinc-800/80 bg-zinc-950/40">
              {isClosed ? (
                <p className="text-xs text-center text-zinc-500 py-2">
                  O atendimento pós-venda para este pedido foi encerrado.
                </p>
              ) : (
                <form onSubmit={handleSendMessage} className="flex flex-col gap-1.5">
                  {sendError && (
                    <span className="text-[11px] text-rose-400 px-1">
                      {sendError}
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Envie uma mensagem para a equipe..."
                      maxLength={1000}
                      disabled={sending}
                      className="flex-1 bg-zinc-900 border border-zinc-700/80 rounded-xl px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 transition-all"
                    />
                    <button
                      type="submit"
                      disabled={sending || !inputText.trim()}
                      className="w-9 h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center disabled:opacity-40 disabled:hover:bg-emerald-600 transition-colors shrink-0"
                      title="Enviar mensagem"
                    >
                      <Send size={15} />
                    </button>
                  </div>
                  <span className="text-[10px] text-zinc-600 self-end font-mono">
                    {inputText.length}/1000
                  </span>
                </form>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default OrderTrackingPage;
