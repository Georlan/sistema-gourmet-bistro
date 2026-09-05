/// <reference types="vite/client" />
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { TenantSuspensionBoundary } from "./components/auth/TenantSuspensionBoundary";
import { initializeKomaTheme } from "./config/theme";
import { AppRecoveryBoundary } from "./components/auth/AppRecoveryBoundary";

function isPublicMenuRoute(): boolean {
  const pathname = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  if (
    pathname.startsWith("/cardapio")
    || pathname.startsWith("/c/")
    || params.get("view") === "cardapio"
  ) return true;

  const hostname = window.location.hostname.toLowerCase();
  const parts = hostname.split(".");
  const ignoredSubdomains = ["www", "localhost", "sistema-gourmet-bistro"];
  const isPlatformHost = hostname.endsWith(".pages.dev")
    || hostname.endsWith(".railway.app")
    || hostname.endsWith(".up.railway.app")
    || hostname.endsWith(".vercel.app")
    || hostname.endsWith(".netlify.app")
    || hostname.endsWith(".github.io");

  return parts.length > 2
    && !ignoredSubdomains.includes(parts[0])
    && !parts[0].startsWith("ais-dev")
    && !parts[0].startsWith("ais-pre")
    && !isPlatformHost;
}

function isPublicCommercialRoute(): boolean {
  const pathname = window.location.pathname;
  return pathname.startsWith("/landing")
    || pathname.startsWith("/legal")
    || pathname.startsWith("/contratar");
}

function bypassTenantSuspensionBoundary(): boolean {
  const pathname = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  return isPublicMenuRoute()
    || isPublicCommercialRoute()
    || pathname.startsWith("/super-admin")
    || pathname.startsWith("/ativar")
    || params.get("view") === "landing"
    || params.get("view") === "ativar";
}

// O tema operacional pertence ao app autenticado. Rotas públicas têm
// apresentação própria e não devem herdar a preferência local do operador.
if (isPublicMenuRoute() || isPublicCommercialRoute()) {
  document.documentElement.setAttribute("data-koma-theme", "dark");
} else {
  initializeKomaTheme();
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
const isPocketContractRoute = pathname.startsWith("/contratar/pocket");

const RootApp = React.lazy(
  isSmartPosRoute
    ? () => import("./smartpos/SmartPosPage")
    : isLegalRoute
      ? () => import("./legal/LegalPage")
      : isPocketContractRoute
        ? () => import("./legal/PocketContractPage")
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
