/// <reference types="vite/client" />
import "./components/auth/passwordRecoveryToken";
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { TenantSuspensionBoundary } from "./components/auth/TenantSuspensionBoundary";
import { initializeKomaTheme } from "./config/theme";
import { AppRecoveryBoundary } from "./components/auth/AppRecoveryBoundary";

import {
  KOMA_OPERATIONAL_APP_URL,
  isOperationalAppHost,
  parseTenantSubdomain,
  resolveKomaHost,
} from "./domain/komaHost";

function isPublicMenuRoute(): boolean {
  const pathname = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  if (
    pathname.startsWith("/cardapio")
    || pathname.startsWith("/c/")
    || params.get("view") === "cardapio"
  ) {
    return true;
  }
  const resolved = resolveKomaHost();
  return resolved.surface === "public";
}

function isPublicCommercialRoute(): boolean {
  const pathname = window.location.pathname;
  const resolved = resolveKomaHost();
  return resolved.surface === "landing"
    || pathname.startsWith("/landing")
    || pathname.startsWith("/legal")
    || pathname.startsWith("/contratar");
}

function isOperationalUtilityRoute(): boolean {
  const pathname = window.location.pathname;
  return pathname === "/recuperar-senha"
    || pathname.startsWith("/smartpos")
    || pathname.startsWith("/ativar")
    || pathname.startsWith("/acompanhar")
    || pathname.startsWith("/entregador");
}

function isCanonicalOperationalEntryRoute(): boolean {
  if (!isOperationalAppHost()) return false;

  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get("view")?.toLowerCase() || "";

  // app.komafood.com.br é autoridade canônica da equipe. Links operacionais
  // antigos (/garcom, /caixa, ?view=garcom, ?view=caixa etc.) também entram
  // pelo login unificado; somente superfícies públicas/utilitárias escapam.
  if (isPublicMenuRoute() || isPublicCommercialRoute() || isOperationalUtilityRoute()) return false;

  return viewParam !== "cardapio"
    && viewParam !== "landing"
    && viewParam !== "ativar"
    && viewParam !== "acompanhar"
    && viewParam !== "entregador";
}

function redirectLegacyOperationalStaffHost(): boolean {
  const hostname = window.location.hostname.trim().toLowerCase();
  if (!hostname.endsWith(".komafood.com.br") || isOperationalAppHost(hostname)) return false;

  const subdomain = hostname.replace(/\.komafood\.com\.br$/, "");
  const parsed = parseTenantSubdomain(subdomain);
  const isLegacyStaffSurface = parsed?.surface === "caixa" || parsed?.surface === "garcom";
  if (!isLegacyStaffSurface) return false;

  // Links antigos como restaurante-caixa/restaurante-garcom não são mais uma
  // segunda autenticação. Em produção eles convergem para o único acesso da equipe.
  if (isPublicMenuRoute() || isPublicCommercialRoute() || isOperationalUtilityRoute()) return false;
  window.location.replace(KOMA_OPERATIONAL_APP_URL);
  return true;
}

function bypassTenantSuspensionBoundary(): boolean {
  const pathname = window.location.pathname;
  const resolved = resolveKomaHost();

  return pathname === "/recuperar-senha"
    || pathname.startsWith("/super-admin")
    || pathname.startsWith("/c/")
    || pathname.startsWith("/cardapio")
    || pathname.startsWith("/ativar")
    || pathname.startsWith("/acompanhar")
    || pathname.startsWith("/entregador")
    || resolved.surface === "public"
    || resolved.surface === "landing"
    || resolved.surface === "central"
    || resolved.surface === "ativar"
    || resolved.surface === "acompanhar"
    || resolved.surface === "entregador"
    || isPublicCommercialRoute();
}

const isLegacyOperationalRedirect = redirectLegacyOperationalStaffHost();

// O cardápio público preserva seu contrato explícito de isolamento do tema
// operacional. As demais rotas públicas comerciais seguem o mesmo tema escuro,
// mas em ramo separado para não diluir essa invariante.
if (isPublicMenuRoute()) {
  document.documentElement.setAttribute("data-koma-theme", "dark");
} else if (isPublicCommercialRoute()) {
  document.documentElement.setAttribute("data-koma-theme", "dark");
} else {
  initializeKomaTheme();
}

// O service worker não possui fetch/cache handler: registrá-lo globalmente é
// seguro para o Vite e não solicita permissão. A permissão de notificação só é
// pedida depois de gesto explícito do cliente no acompanhamento do pedido.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/koma-sw.js", { scope: "/", updateViaCache: "none" }).catch((error: unknown) => {
      console.warn("[push] Service Worker indisponível.", error);
    });
  }, { once: true });
}

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  void import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn: sentryDsn,
      // Limita o monitoramento de performance a 10% para nunca estourar o plano gratuito.
      tracesSampleRate: 0.1,
    });
  }).catch((error: unknown) => {
    console.warn('[monitoring] Monitoramento indisponível.', error);
  });
}

const pathname = window.location.pathname;
const isSmartPosRoute = pathname.startsWith("/smartpos");
const isLegalRoute = pathname.startsWith("/legal");
const isPlanContractRoute = pathname.startsWith("/contratar");
const isUnifiedOperationalRoute = isCanonicalOperationalEntryRoute() || isLegacyOperationalRedirect;

// O Chrome mobile pode esconder path/query na barra e fazer links legados
// parecerem o domínio puro. Antes de montar o shell, convertemos toda entrada
// operacional canônica para exatamente https://app.komafood.com.br/.
if (
  isUnifiedOperationalRoute
  && (window.location.pathname !== "/" || window.location.search || window.location.hash)
) {
  window.history.replaceState(window.history.state, "", "/");
}

const RootApp = React.lazy(
  pathname === "/recuperar-senha"
    ? () => import("./components/auth/PasswordResetPage")
    : isSmartPosRoute
    ? () => import("./smartpos/SmartPosPage")
    : isLegalRoute
      ? () => import("./legal/LegalPage")
      : isPlanContractRoute
        ? () => import("./legal/PlanContractPage")
        : isUnifiedOperationalRoute
          ? () => import("./components/auth/UnifiedOperationalEntry")
          : () => import("./App"),
);

const RouteLoading = () => (
  <main className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground">
    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">Preparando Kôma…</p>
  </main>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRecoveryBoundary>
    <TenantSuspensionBoundary disabled={bypassTenantSuspensionBoundary()}>
      <React.Suspense fallback={<RouteLoading />}>
        <RootApp />
      </React.Suspense>
    </TenantSuspensionBoundary>
    </AppRecoveryBoundary>
  </React.StrictMode>
);
