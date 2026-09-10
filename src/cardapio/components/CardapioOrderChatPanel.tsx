/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Send,
  X,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { API_BASE_URL } from "../../config/api";
import {
  OrderStateContract,
  StoredOrder,
  fallbackOrderState,
  isOrderStateContract,
} from "../orderTracking";
import "../cardapioChatPolish.css";
import CardapioPushNotifications from "./CardapioPushNotifications";
import { KomaOrderChatIcon } from "./KomaPublicIcons";

interface TrackingPayload {
  status: string;
  state?: OrderStateContract;
  tipo: string;
  closed_at?: string | null;
  conversa?: {
    closed_at?: string | null;
    unread_count?: number;
    can_chat?: boolean;
  } | null;
}

interface TrackingMessage {
  id: string;
  sender_type: "system" | "customer" | "staff";
  body: string;
  created_at?: string | null;
}

interface CardapioOrderChatPanelProps {
  order: StoredOrder;
  onBack: () => void;
  onClose: () => void;
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

function formatTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function CardapioOrderChatPanel({
  order,
  onBack,
  onClose,
}: CardapioOrderChatPanelProps) {
  const token = useMemo(() => resolveTrackingToken(order), [order]);
  const [tracking, setTracking] = useState<TrackingPayload | null>(null);
  const [messages, setMessages] = useState<TrackingMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const apiRoot = token
    ? `${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${encodeURIComponent(token)}`
    : null;

  const refresh = useCallback(async () => {
    if (!apiRoot) {
      setLoading(false);
      setError("Este pedido não possui um link de acompanhamento válido.");
      return;
    }

    try {
      const [orderRes, messagesRes] = await Promise.all([
        fetch(apiRoot, { cache: "no-store" }),
        fetch(`${apiRoot}/messages`, { cache: "no-store" }),
      ]);
      if (!orderRes.ok) throw new Error("Não foi possível atualizar o pedido.");
      const orderData = await orderRes.json() as TrackingPayload;
      setTracking(orderData);
      if (messagesRes.ok) {
        const messageData = await messagesRes.json() as TrackingMessage[];
        if (Array.isArray(messageData)) setMessages(messageData);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a conversa.");
    } finally {
      setLoading(false);
    }
  }, [apiRoot]);

  const markRead = useCallback(() => {
    if (!apiRoot || document.visibilityState !== "visible") return;
    void fetch(`${apiRoot}/read`, { method: "POST" }).catch(() => {});
  }, [apiRoot]);

  useEffect(() => {
    void refresh();
    if (!apiRoot) return;

    let source: EventSource | null = null;
    let fallbackInterval: number | null = null;

    const stopFallback = () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };
    const startFallback = () => {
      if (fallbackInterval !== null) return;
      fallbackInterval = window.setInterval(() => void refresh(), 15000);
    };

    try {
      source = new EventSource(`${apiRoot}/events`);
      source.onopen = stopFallback;
      source.onerror = startFallback;
      source.addEventListener("message", (event: MessageEvent) => {
        try {
          const incoming = JSON.parse(event.data) as TrackingMessage;
          setMessages((current) => current.some((item) => item.id === incoming.id)
            ? current
            : [...current, incoming]);
        } catch {
          startFallback();
        }
      });
      source.addEventListener("status", () => {
        void refresh();
      });
    } catch {
      source = null;
      startFallback();
    }

    return () => {
      stopFallback();
      source?.close();
    };
  }, [apiRoot, refresh]);

  useEffect(() => {
    markRead();
    const handleVisibility = () => markRead();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [markRead, messages.length]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const rawStatus = tracking?.status || order.status || "pendente";
  const rawType = tracking?.tipo || order.tipo || "Retirada";
  const state = isOrderStateContract(tracking?.state)
    ? tracking.state
    : isOrderStateContract(order.state)
      ? order.state
      : fallbackOrderState(rawStatus, rawType);
  const isDelivery = state.fulfillment === "delivery";
  const currentStep = state.progress_step;
  const rejected = state.rejected;
  const steps = isDelivery
    ? ["Recebido", "Em preparo", "Pronto", "Saiu", "Concluído"]
    : ["Recebido", "Em preparo", "Pronto", "Concluído"];
  const isClosed = !state.can_chat || tracking?.conversa?.can_chat === false;

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = input.trim();
    if (!apiRoot || !body || sending || isClosed) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch(`${apiRoot}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail || "Não foi possível enviar a mensagem.");
      const sent = payload as TrackingMessage;
      setMessages((current) => current.some((item) => item.id === sent.id)
        ? current
        : [...current, sent]);
      setInput("");
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-koma-card text-koma-foreground" id="inline-order-chat-panel">
      <div className="flex items-center justify-between border-b border-koma-border p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-secondary transition hover:text-white"
            aria-label="Voltar para meus pedidos"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <KomaOrderChatIcon size={16} className="shrink-0" aria-hidden="true" />
              <h2 className="truncate text-sm font-black">Pedido #{order.numero_pedido}</h2>
            </div>
            <p className="mt-0.5 text-[10px] text-koma-muted">Chat e acompanhamento sem sair do cardápio</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void refresh()}
            className="grid h-9 w-9 place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-secondary transition hover:text-white"
            aria-label="Atualizar conversa"
          >
            <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-secondary transition hover:text-white"
            aria-label="Fechar conversa"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="border-b border-koma-border bg-koma-panel/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className={clsx(
              "grid h-8 w-8 place-items-center rounded-xl",
              rejected ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400",
            )}>
              {rejected ? <XCircle className="h-4 w-4" /> : currentStep >= steps.length ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
            </div>
            <div>
              <span className="text-[9px] font-black uppercase tracking-wider text-koma-muted">Status atual</span>
              <p className={clsx("text-xs font-black", rejected ? "text-rose-400" : "text-emerald-400")}>{state.label}</p>
            </div>
          </div>
          <span className="text-[10px] font-bold text-koma-muted">{isDelivery ? "Delivery" : "Retirada"}</span>
        </div>

        {!rejected && (
          <div className={clsx("mt-3 grid gap-1", isDelivery ? "grid-cols-5" : "grid-cols-4")}>
            {steps.map((label, index) => {
              const passed = currentStep >= index + 1;
              return (
                <div key={label} className="text-center">
                  <div className={clsx("h-1.5 rounded-full", passed ? "bg-emerald-500" : "bg-koma-raised")} />
                  <span className={clsx("mt-1 block text-[8px] font-bold", passed ? "text-emerald-300" : "text-koma-subtle")}>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CardapioPushNotifications order={order} />

      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto p-4 sm:p-5" aria-live="polite">
        {loading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-koma-muted">Carregando conversa…</div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-koma-muted">
            <KomaOrderChatIcon size={32} className="opacity-30" aria-hidden="true" />
            <p className="mt-2 text-xs">Nenhuma mensagem ainda.</p>
          </div>
        ) : messages.map((message) => (
          <div
            key={message.id}
            className={clsx(
              "flex",
              message.sender_type === "customer"
                ? "justify-end"
                : message.sender_type === "system"
                  ? "justify-center"
                  : "justify-start",
            )}
          >
            <div className={clsx(
              "max-w-[86%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed",
              message.sender_type === "customer"
                ? "rounded-br-md bg-emerald-500 text-white"
                : message.sender_type === "staff"
                  ? "rounded-bl-md border border-koma-border bg-koma-panel text-koma-foreground"
                  : "border border-koma-border/70 bg-koma-raised/70 text-center text-koma-muted",
            )}>
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
              {message.created_at && (
                <span className={clsx(
                  "mt-1 block text-[8px]",
                  message.sender_type === "customer" ? "text-white/70" : "text-koma-subtle",
                )}>{formatTime(message.created_at)}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={sendMessage} className="border-t border-koma-border p-3 sm:p-4">
        {error && <p className="mb-2 text-[10px] font-bold text-rose-400">{error}</p>}
        {isClosed ? (
          <div className="rounded-xl border border-koma-border bg-koma-panel px-3 py-3 text-center text-[10px] text-koma-muted">
            O atendimento deste pedido foi encerrado.
          </div>
        ) : (
          <div className="space-y-2">
            {state.terminal && !rejected && (
              <p className="text-[10px] text-koma-muted">Pedido concluído · sua mensagem abrirá um atendimento de pós-venda sem reabrir o pedido.</p>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={1}
                maxLength={1000}
                placeholder="Escreva para o restaurante…"
                className="min-h-[44px] max-h-28 flex-1 resize-none rounded-xl border border-koma-border bg-koma-panel px-3 py-3 text-xs text-koma-foreground outline-none transition focus:border-emerald-500/60"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Enviar mensagem"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
