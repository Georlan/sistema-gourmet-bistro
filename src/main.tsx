/// <reference types="vite/client" />
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import * as Sentry from "@sentry/react";
import { initializeKomaTheme } from "./config/theme";

// Aplica o tema persistido antes do primeiro paint do React, inclusive nas rotas
// que retornam cedo dentro de App (/cardapio, /landing, /super-admin, etc.).
initializeKomaTheme();

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    // Limita o monitoramento de performance a 10% para nunca estourar o plano gratuito.
    tracesSampleRate: 0.1,
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
