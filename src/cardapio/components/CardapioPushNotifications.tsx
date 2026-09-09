/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Bell, BellOff, Check, Smartphone } from "lucide-react";
import { API_BASE_URL } from "../../config/api";
import { StoredOrder } from "../orderTracking";
import {
  persistPushResumeCapability,
  removePushResumeCapability,
} from "../pushResumeStore";

const PUSH_OPT_IN_KEY = "koma_web_push_opt_in";

type PushState = "checking" | "ready" | "enabling" | "enabled" | "denied" | "unsupported" | "unavailable" | "ios-install" | "error";

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

function isIosDevice(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  const legacyStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacyStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function getServerConfig(apiRoot: string): Promise<{ enabled: boolean; publicKey: string }> {
  const response = await fetch(`${apiRoot}/push-config`, { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível consultar as notificações.");
  return response.json();
}

async function persistSubscription(apiRoot: string, subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("O navegador não forneceu uma assinatura válida.");
  }
  const response = await fetch(`${apiRoot}/push-subscription`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      expirationTime: json.expirationTime ?? null,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || "Não foi possível ativar os avisos.");
  }
}

interface Props {
  order: StoredOrder;
}

export default function CardapioPushNotifications({ order }: Props) {
  const token = React.useMemo(() => resolveTrackingToken(order), [order]);
  const apiRoot = token
    ? `${API_BASE_URL}/api/cardapio/pedidos/acompanhar/${encodeURIComponent(token)}`
    : null;
  const [state, setState] = React.useState<PushState>("checking");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    const inspect = async () => {
      if (!apiRoot || !token || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }
      if (isIosDevice() && !isStandalone()) {
        if (!cancelled) setState("ios-install");
        return;
      }
      try {
        const config = await getServerConfig(apiRoot);
        if (!config.enabled || !config.publicKey) {
          if (!cancelled) setState("unavailable");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        const optedIn = localStorage.getItem(PUSH_OPT_IN_KEY) === "true";
        if (subscription && Notification.permission === "granted" && optedIn) {
          // O token bruto continua limitado à sessão da aba. Para permitir cold-start
          // de uma notificação, guardamos somente ciphertext derivado da própria
          // PushSubscription antes de reassociar o pedido no backend.
          await persistPushResumeCapability(order.id, token, subscription);
          await persistSubscription(apiRoot, subscription);
          if (!cancelled) setState("enabled");
          return;
        }
        if (!cancelled) setState("ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao verificar notificações.");
          setState("error");
        }
      }
    };
    void inspect();
    return () => { cancelled = true; };
  }, [apiRoot, order.id, token]);

  const enable = async () => {
    if (!apiRoot || !token || state === "enabling") return;
    if (isIosDevice() && !isStandalone()) {
      setState("ios-install");
      return;
    }
    setState("enabling");
    setError("");
    try {
      const config = await getServerConfig(apiRoot);
      if (!config.enabled || !config.publicKey) {
        setState("unavailable");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "ready");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(config.publicKey) as BufferSource,
        });
      }
      // Fail closed: o backend só considera o push habilitado depois de o browser
      // conseguir proteger a capability necessária para reabrir o pedido.
      await persistPushResumeCapability(order.id, token, subscription);
      await persistSubscription(apiRoot, subscription);
      localStorage.setItem(PUSH_OPT_IN_KEY, "true");
      setState("enabled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ativar as notificações.");
      setState("error");
    }
  };

  const disable = async () => {
    if (!apiRoot || !("serviceWorker" in navigator)) return;
    setError("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch(`${apiRoot}/push-subscription`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      }
      await removePushResumeCapability(order.id);
      // Não chamamos PushSubscription.unsubscribe(): a mesma assinatura pode estar
      // vinculada a outro pedido recente neste aparelho.
      localStorage.setItem(PUSH_OPT_IN_KEY, "false");
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível desativar os avisos.");
      setState("error");
    }
  };

  if (state === "unsupported") return null;

  if (state === "ios-install") {
    return (
      <div className="border-b border-koma-border bg-emerald-500/5 px-4 py-3">
        <div className="flex gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <div>
            <p className="text-xs font-black text-koma-foreground">Receba avisos mesmo depois de sair do cardápio</p>
            <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
              No iPhone/iPad, toque em Compartilhar → Adicionar à Tela de Início. Abra o KÔMA pelo ícone e ative os avisos deste pedido.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state === "unavailable") {
    return null;
  }

  if (state === "denied") {
    return (
      <div className="border-b border-koma-border bg-amber-500/5 px-4 py-3 text-[10px] text-amber-100">
        <div className="flex items-center gap-2 font-bold"><BellOff className="h-4 w-4" /> Notificações bloqueadas no navegador</div>
        <p className="mt-1 text-amber-100/70">Libere as notificações nas configurações do navegador para receber avisos deste pedido.</p>
      </div>
    );
  }

  if (state === "enabled") {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400"><Check className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="text-[11px] font-black text-emerald-200">Avisos do pedido ativados</p>
            <p className="truncate text-[9px] text-emerald-100/60">Pode sair do cardápio. Avisaremos sobre status e mensagens.</p>
          </div>
        </div>
        <button type="button" onClick={() => void disable()} className="shrink-0 text-[9px] font-bold text-koma-muted underline underline-offset-2 hover:text-white">Desativar</button>
      </div>
    );
  }

  return (
    <div className="border-b border-koma-border bg-emerald-500/5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><Bell className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="text-[11px] font-black text-koma-foreground">Receba avisos do seu pedido</p>
            <p className="text-[9px] leading-relaxed text-koma-muted">Você pode abrir TikTok, Instagram ou fechar esta tela. Avisaremos quando houver algo importante.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void enable()}
          disabled={state === "checking" || state === "enabling"}
          className="shrink-0 rounded-xl bg-emerald-500 px-3 py-2 text-[10px] font-black text-white shadow-lg transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {state === "enabling" ? "Ativando…" : state === "checking" ? "Verificando…" : "Ativar"}
        </button>
      </div>
      {error && <p className="mt-2 text-[9px] font-bold text-rose-400">{error}</p>}
    </div>
  );
}
