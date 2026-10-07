/// <reference types="vite/client" />
import "./components/auth/passwordRecoveryToken";
import "./components/auth/customerRegistrationToken";
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./components/shared/operationalHeader.css";
import { CustomerSupportWidget } from "./components/app/CustomerSupportWidget";
import { KomaLoading } from "./components/app/KomaLoading";
import { TenantSuspensionBoundary } from "./components/auth/TenantSuspensionBoundary";
import { initializeKomaTheme } from "./config/theme";
import { AppRecoveryBoundary } from "./components/auth/AppRecoveryBoundary";
import { SupportCodeNotice } from "./components/app/SupportCodeNotice";
import { installSupportCodeObserver } from "./utils/supportCode";
import { AnalyticsProvider, initAnalytics } from "./analytics";

import {
  KOMA_OPERATIONAL_APP_URL,
  isCentralSupportOperationalBridge,
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
    || pathname.startsWith("/contratar")
    || pathname.startsWith("/cearatech");
}

function isOperationalUtilityRoute(): boolean {
  const pathname = window.location.pathname;
  return pathname === "/recuperar-senha"
    || pathname === "/confirmar-cadastro"
    || pathname.startsWith("/ferramentas/simulador-impressao")
    || pathname.startsWith("/smartpos")
    || pathname.startsWith("/ativar")
    || pathname.startsWith("/acompanhar")
    || pathname.startsWith("/entregador");
}

function hasInternalSupportSessionContext(): boolean {
  try {
    return Boolean(window.sessionStorage.getItem("koma_support_session"));
  } catch {
    return false;
  }
}

function isLocalOperationalTestRoute(): boolean {
  const hostname = window.location.hostname.trim().toLowerCase();
  if (hostname !== "127.0.0.1" && hostname !== "localhost") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("view")?.toLowerCase() === "operacional";
}

function isCanonicalOperationalEntryRoute(): boolean {
  const localOperationalTestRoute = isLocalOperationalTestRoute();
  if (!isOperationalAppHost() && !localOperationalTestRoute) return false;

  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get("view")?.toLowerCase() || "";

  // app.komafood.com.br é autoridade canônica da equipe. Links operacionais
  // antigos (/garcom, /caixa, ?view=garcom, ?view=caixa etc.) também entram
  // pelo login unificado; somente superfícies públicas/utilitárias escapam.
  // O view=operacional em loopback existe exclusivamente para exercitar este
  // mesmo shell canônico no Playwright, sem alterar o roteamento público.
  if (isPublicMenuRoute() || (!localOperationalTestRoute && isPublicCommercialRoute()) || isOperationalUtilityRoute()) return false;

  return viewParam !== "cardapio"
    && viewParam !== "landing"
    && viewParam !== "ativar"
    && viewParam !== "acompanhar"
    && viewParam !== "entregador";
}

function isHostedManagementEntryRoute(): boolean {
  if (isOperationalAppHost() || isLocalOperationalTestRoute()) return false;
  if (isPublicMenuRoute() || isPublicCommercialRoute() || isOperationalUtilityRoute()) return false;
  if (isCentralSupportOperationalBridge()) return hasInternalSupportSessionContext();
  return resolveKomaHost().surface === "caixa";
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
    || pathname === "/confirmar-cadastro"
    || pathname.startsWith("/super-admin")
    || (isCentralSupportOperationalBridge() && hasInternalSupportSessionContext())
    || pathname.startsWith("/ferramentas/simulador-impressao")
    || pathname.startsWith("/c/")
    || pathname.startsWith("/cardapio")
    || pathname.startsWith("/ativar")
    || pathname.startsWith("/acompanhar")
    || pathname.startsWith("/entregador")
    || pathname.startsWith("/cearatech")
    || resolved.surface === "public"
    || resolved.surface === "landing"
    || resolved.surface === "central"
    || resolved.surface === "ativar"
    || resolved.surface === "acompanhar"
    || resolved.surface === "entregador"
    || isPublicCommercialRoute();
}

const isLegacyOperationalRedirect = redirectLegacyOperationalStaffHost();
installSupportCodeObserver();

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

if (typeof window !== "undefined") {
  (window as unknown as { __KOMA_BUILD__?: unknown }).__KOMA_BUILD__ = {
    sha: import.meta.env.VITE_BUILD_SHA,
    builtAt: import.meta.env.VITE_BUILD_TIME,
  };

  window.addEventListener("vite:preloadError", (event) => {
    const CHUNK_RELOAD_KEY = "koma_chunk_reload_attempt";
    const now = Date.now();
    let lastAttempt = 0;
    try {
      lastAttempt = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    } catch {
      lastAttempt = 0;
    }

    // Vite documenta que preventDefault() impede que o erro de import seja
    // relançado. Fazemos isso somente quando realmente iniciaremos o reload;
    // uma segunda falha dentro do throttle continua disponível ao ErrorBoundary.
    if (now - lastAttempt > 15000) {
      event.preventDefault();
      try {
        window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
      } catch {
        // Se sessionStorage estiver indisponível, ainda é melhor tentar um reload.
      }
      const url = new URL(window.location.href);
      url.searchParams.set("__koma_refresh", String(now));
      window.location.replace(url.toString());
    }
  });
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

initAnalytics();

const pathname = window.location.pathname;
const isSmartPosRoute = pathname.startsWith("/smartpos");
const isPrintSimulatorRoute = pathname.startsWith("/ferramentas/simulador-impressao");
const isLegalRoute = pathname.startsWith("/legal");
const isPlanContractRoute = pathname.startsWith("/contratar");
const isCearaTechQrRoute = pathname === "/cearatech/qr";
const isCearaTechRoute = pathname.startsWith("/cearatech");
const isUnifiedOperationalRoute = isCanonicalOperationalEntryRoute() || isLegacyOperationalRedirect;
const isOnboardingAwareManagementRoute = isHostedManagementEntryRoute();
const isInternalSupportOperationalRoute =
  isCentralSupportOperationalBridge() && hasInternalSupportSessionContext();
const hasCustomerSupportSurface =
  !pathname.startsWith("/super-admin")
  && !isInternalSupportOperationalRoute
  && (isUnifiedOperationalRoute || isOnboardingAwareManagementRoute || isSmartPosRoute);

// O Chrome mobile pode esconder path/query na barra e fazer links legados
// parecerem o domínio puro. Em produção, antes de montar o shell, removemos
// rota/query legadas. A única exceção são os parâmetros efêmeros de pareamento
// do Print Agent: eles precisam sobreviver ao login unificado para que o App
// consiga devolver a credencial ao servidor localhost do agente.
if (
  isUnifiedOperationalRoute
  && isOperationalAppHost()
  && (window.location.pathname !== "/" || window.location.search || window.location.hash)
) {
  const currentParams = new URLSearchParams(window.location.search);
  const pairingNonce = currentParams.get("pair_print_agent")?.trim() || "";
  const pairingPortText = currentParams.get("agent_port")?.trim() || "";
  const pairingPort = Number(pairingPortText);
  const hasValidPrintPairingContext = Boolean(pairingNonce)
    && Number.isInteger(pairingPort)
    && pairingPort >= 17654
    && pairingPort <= 17664;

  const canonicalParams = new URLSearchParams();
  if (hasValidPrintPairingContext) {
    canonicalParams.set("pair_print_agent", pairingNonce);
    canonicalParams.set("agent_port", String(pairingPort));
  }

  const canonicalSearch = canonicalParams.toString();
  window.history.replaceState(
    window.history.state,
    "",
    canonicalSearch ? `/?${canonicalSearch}` : "/",
  );
}

const RootApp = React.lazy(
  pathname === "/recuperar-senha"
    ? () => import("./components/auth/PasswordResetPage")
    : pathname === "/confirmar-cadastro"
      ? () => import("./components/auth/CustomerRegistrationConfirmPage")
    : isPrintSimulatorRoute
    ? () => import("./printing-simulator/PrintingSimulatorPage")
    : isSmartPosRoute
      ? () => import("./smartpos/SmartPosPage")
      : isLegalRoute
      ? () => import("./legal/LegalPage")
      : isPlanContractRoute
        ? () => import("./legal/PlanContractPageV2")
        : isCearaTechQrRoute
          ? () => import("./landing/CearaTechQrPage")
          : isCearaTechRoute
            ? () => import("./landing/CearaTechLeadPage")
            : isUnifiedOperationalRoute
            ? () => import("./components/auth/UnifiedOperationalEntry")
            : isOnboardingAwareManagementRoute
              ? () => import("./components/onboarding/OnboardingAwareOperationalEntry")
              : () => import("./App"),
);

const RouteLoading = () => (pathname === "/recuperar-senha" || pathname === "/confirmar-cadastro")
  ? (
    <main className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">Preparando recuperação…</p>
    </main>
  )
  : <KomaLoading label="Preparando Kôma…" />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AnalyticsProvider>
      <AppRecoveryBoundary>
      <TenantSuspensionBoundary disabled={bypassTenantSuspensionBoundary()}>
        <React.Suspense fallback={<RouteLoading />}>
          <RootApp />
        </React.Suspense>
        {hasCustomerSupportSurface ? <CustomerSupportWidget /> : null}
        <SupportCodeNotice />
      </TenantSuspensionBoundary>
      </AppRecoveryBoundary>
    </AnalyticsProvider>
  </React.StrictMode>,
);
