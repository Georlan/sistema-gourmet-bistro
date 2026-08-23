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
const RootApp = React.lazy(isSmartPosRoute
  ? () => import("./smartpos/SmartPosPage")
  : () => import("./App"));

const RouteLoading = () => (
  <main className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground">
    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">Preparando Kôma…</p>
  </main>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <React.Suspense fallback={<RouteLoading />}>
      <RootApp />
    </React.Suspense>
  </React.StrictMode>
);
