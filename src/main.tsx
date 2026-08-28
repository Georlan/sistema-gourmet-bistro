/// <reference types="vite/client" />
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { initializeKomaTheme } from "./config/theme";

// Aplica o tema persistido antes do primeiro paint do React, inclusive nas rotas
// que retornam cedo dentro de App (/cardapio, /landing, /super-admin, etc.).
initializeKomaTheme();

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  void import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn: sentryDsn,
      // Limita o monitoramento de performance a 10% para nunca estourar o plano gratuito.
      tracesSampleRate: 0.1,
    });
  });
}

const isSmartPosRoute = window.location.pathname.startsWith("/smartpos");
const isLandingRoute = window.location.pathname.startsWith("/landing")
  || new URLSearchParams(window.location.search).get("view") === "landing";
const RootApp = React.lazy(
  isSmartPosRoute
    ? () => import("./smartpos/SmartPosPage")
    : isLandingRoute
      ? () => import("./landing/LandingPage")
      : () => import("./App")
);

const RouteLoading = () => (
  <main className="flex min-h-dvh items-center justify-center bg-[#07110e] px-6 text-white">
    <p className="font-sans text-xs font-semibold tracking-[0.12em] text-[#00c99a]">Carregando Kôma…</p>
  </main>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <React.Suspense fallback={<RouteLoading />}>
      <RootApp />
    </React.Suspense>
  </React.StrictMode>
);
