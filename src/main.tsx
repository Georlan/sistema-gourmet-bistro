/// <reference types="vite/client" />
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import * as Sentry from "@sentry/react";

// Inicializa o monitoramento de erros de forma limpa usando a variável do .env
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // Limita o monitoramento de performance a 10% para nunca estourar o plano gratuito
  tracesSampleRate: 0.1,
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);