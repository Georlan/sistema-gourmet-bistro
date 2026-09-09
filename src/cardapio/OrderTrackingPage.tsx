/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../config/api";
import { saveStoredOrder, type StoredOrder } from "./orderTracking";

interface OrderTrackingPageProps {
  token?: string | null;
}

interface LegacyTrackingPayload {
  id?: string;
  numero_pedido?: string | number;
  status?: string;
  state?: StoredOrder["state"];
  tipo?: string;
  total?: number;
  fechada?: boolean;
  criado_em?: string | null;
  itens?: StoredOrder["itens"];
  restaurante?: {
    id?: number | string;
  } | null;
}

function resolveTrackingToken(propToken?: string | null): string {
  if (propToken?.trim()) return propToken.trim();

  // Retomada de Web Push: fragmentos não são enviados ao servidor no request
  // inicial nem viram Referer HTTP. A URL é limpa no início do efeito abaixo.
  const fromFragment = new URLSearchParams(window.location.hash.replace(/^#/, ""))
    .get("token")
    ?.trim();
  if (fromFragment) return fromFragment;

  // Compatibilidade com links históricos. Nenhum link novo deve usar query string.
  const fromQuery = new URLSearchParams(window.location.search).get("token")?.trim();
  if (fromQuery) return fromQuery;

  const parts = window.location.pathname.split("/").filter(Boolean);
  const trackingIndex = parts.indexOf("acompanhar");
  if (trackingIndex < 0 || !parts[trackingIndex + 1]) return "";

  try {
    return decodeURIComponent(parts[trackingIndex + 1]).trim();
  } catch {
    return parts[trackingIndex + 1].trim();
  }
}

function scrubTrackingCapabilityFromAddressBar(): void {
  if (typeof window === "undefined") return;
  // Depois de capturar a capability em memória, removemos fragmento, query e
  // eventual token legado no path antes de qualquer fetch subsequente.
  window.history.replaceState(window.history.state, "", "/acompanhar");
}

/**
 * Compatibilidade para links antigos /acompanhar/:token e retomada segura de
 * Web Push via /acompanhar#token=... .
 *
 * A experiência de acompanhamento/chat pertence ao Cardápio e ao drawer
 * lateral de "Pedidos & chat". Esta rota só recupera silenciosamente o pedido,
 * restaura o snapshot da sessão atual e redireciona direto para o pedido/chat.
 */
export function OrderTrackingPage({ token: propToken }: OrderTrackingPageProps) {
  const token = useMemo(() => resolveTrackingToken(propToken), [propToken]);
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!token) {
      setError("Link de acompanhamento inválido.");
      return;
    }

    scrubTrackingCapabilityFromAddressBar();
    let cancelled = false;

    const redirectToInlineTracking = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(response.status === 404
            ? "Pedido não encontrado."
            : "Não foi possível carregar o pedido.");
        }

        const payload = await response.json() as LegacyTrackingPayload;
        if (cancelled) return;

        const pedidoId = String(payload.id || "").trim();
        const restauranteId = Number(payload.restaurante?.id);
        if (!pedidoId || !Number.isFinite(restauranteId)) {
          throw new Error("O link do pedido está incompleto.");
        }

        const createdTimestamp = payload.criado_em
          ? new Date(payload.criado_em).getTime()
          : Date.now();
        const timestamp = Number.isFinite(createdTimestamp) ? createdTimestamp : Date.now();

        saveStoredOrder({
          id: pedidoId,
          numero_pedido: payload.numero_pedido ?? pedidoId,
          timestamp,
          restaurante_id: restauranteId,
          tipo: String(payload.tipo || "Retirada"),
          total: Number(payload.total || 0),
          idempotency_key: `tracking:${pedidoId}`,
          status: String(payload.status || "pendente"),
          state: payload.state,
          fechado: Boolean(payload.fechada),
          itens: Array.isArray(payload.itens) ? payload.itens : undefined,
          created_at: payload.criado_em || undefined,
          tracking_token: token,
        });

        window.location.replace(
          `/cardapio?restaurante_id=${encodeURIComponent(String(restauranteId))}`
          + `#koma-order=${encodeURIComponent(pedidoId)}`,
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Não foi possível abrir o pedido.");
        }
      }
    };

    void redirectToInlineTracking();
    return () => {
      cancelled = true;
    };
  }, [token, retryNonce]);

  if (!error) {
    // Compatibilidade legada não deve parecer uma segunda página do produto.
    // Mantemos apenas um estado silencioso e acessível durante o lookup curto.
    return (
      <main className="min-h-screen bg-koma-page" aria-busy="true">
        <span className="sr-only" role="status">Abrindo seu pedido.</span>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-koma-page p-6 text-koma-foreground">
      <section className="w-full max-w-sm rounded-3xl border border-koma-border bg-koma-card p-7 text-center shadow-2xl">
        <h1 className="text-base font-black">Não foi possível abrir este pedido</h1>
        <p className="mt-2 text-xs leading-relaxed text-koma-muted">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError("");
            setRetryNonce((current) => current + 1);
          }}
          className="mt-5 h-10 rounded-xl border border-koma-border px-4 text-xs font-bold text-koma-secondary transition hover:text-white"
        >
          Tentar novamente
        </button>
      </section>
    </main>
  );
}
