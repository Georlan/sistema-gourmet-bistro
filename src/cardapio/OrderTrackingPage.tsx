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

/**
 * Compatibilidade para links antigos /acompanhar/:token.
 *
 * A experiência de acompanhamento/chat agora pertence ao Cardápio e ao drawer
 * lateral de "Pedido / Chat". Esta rota apenas recupera o pedido pelo token,
 * restaura o snapshot local necessário e redireciona para o Cardápio.
 */
export function OrderTrackingPage({ token: propToken }: OrderTrackingPageProps) {
  const token = useMemo(() => resolveTrackingToken(propToken), [propToken]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setError("Link de acompanhamento inválido.");
      return;
    }

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
          fechado: Boolean(payload.fechada),
          itens: Array.isArray(payload.itens) ? payload.itens : undefined,
          created_at: payload.criado_em || undefined,
          tracking_token: token,
          tracking_url: `/acompanhar/${encodeURIComponent(token)}`,
        });

        window.location.replace(`/cardapio?restaurante_id=${encodeURIComponent(String(restauranteId))}`);
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
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-koma-page p-6 text-koma-foreground">
      <section className="w-full max-w-sm rounded-3xl border border-koma-border bg-koma-card p-7 text-center shadow-2xl">
        {error ? (
          <>
            <h1 className="text-base font-black">Não foi possível abrir este pedido</h1>
            <p className="mt-2 text-xs leading-relaxed text-koma-muted">{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 h-10 rounded-xl border border-koma-border px-4 text-xs font-bold text-koma-secondary transition hover:text-white"
            >
              Tentar novamente
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500" />
            <h1 className="mt-4 text-sm font-black">Abrindo seu pedido no cardápio</h1>
            <p className="mt-1.5 text-xs leading-relaxed text-koma-muted">
              O acompanhamento e a conversa agora ficam juntos em Pedido / Chat.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
