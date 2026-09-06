import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const storage = new Map<string, string>();
const events = new EventTarget();

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    location: {
      hostname: "localhost",
      protocol: "http:",
      host: "localhost:3000",
    },
    sessionStorage: {
      get length() { return storage.size; },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, String(value)),
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  },
});

const api = await import("../src/super-admin/superAdminApi.ts");
const { SuperAdminGate } = await import("../src/super-admin/SuperAdminGate.tsx");

test.beforeEach(() => {
  storage.clear();
});

test("sem token o gate renderiza somente o login", () => {
  const markup = renderToStaticMarkup(React.createElement(SuperAdminGate));
  assert.match(markup, /data-testid="superadmin-login"/);
  assert.match(markup, /name="username"/);
  assert.match(markup, /name="password"/);
  assert.doesNotMatch(markup, /id="superadmin-root"/);
});

test("a rota principal usa o gate e não renderiza o painel diretamente", () => {
  const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /React\.lazy\(\(\) => import\('\.\/super-admin\/SuperAdminGate'\)/);
  assert.match(source, /default: module\.SuperAdminGate/);
  assert.match(source, /<AppRouteBoundary[^>]+><SuperAdminGate\s*\/><\/AppRouteBoundary>/);
  assert.doesNotMatch(source, /return <SuperAdminPanel\s*\/>;/);
});

test("login usa POST /api/super-admin/token e salva somente o access_token dedicado", async () => {
  let requestUrl = "";
  let requestMethod = "";
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestMethod = init?.method || "GET";
    return new Response(JSON.stringify({ access_token: "issued-token", token_type: "bearer" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await api.loginSuperAdmin("owner", "secret");

  assert.equal(requestUrl, "http://localhost:8000/api/super-admin/token");
  assert.equal(requestMethod, "POST");
  assert.equal(api.getSuperAdminToken(), "issued-token");
  assert.equal(storage.size, 1);
});

test("requisição autenticada usa API_BASE_URL e substitui Authorization pelo bearer dedicado", async () => {
  api.setSuperAdminToken("dedicated-token");
  let requestUrl = "";
  let authorization = "";
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    authorization = new Headers(init?.headers).get("Authorization") || "";
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await api.superAdminFetch("/api/super-admin/restaurantes", {
    headers: { Authorization: "Bearer token-errado" },
  });

  assert.equal(requestUrl, "http://localhost:8000/api/super-admin/restaurantes");
  assert.equal(authorization, "Bearer dedicated-token");
});

test("401 remove a sessão e solicita retorno ao login", async () => {
  api.setSuperAdminToken("expired-token");
  let authEvents = 0;
  const listener = () => { authEvents += 1; };
  events.addEventListener(api.SUPER_ADMIN_AUTH_REQUIRED_EVENT, listener);
  globalThis.fetch = async () => new Response(
    JSON.stringify({ detail: "expired" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );

  await assert.rejects(
    api.superAdminFetch("/api/super-admin/restaurantes"),
    (error: unknown) => error instanceof api.SuperAdminApiError && error.status === 401,
  );

  assert.equal(api.getSuperAdminToken(), null);
  assert.equal(authEvents, 1);
  events.removeEventListener(api.SUPER_ADMIN_AUTH_REQUIRED_EVENT, listener);
});

test("501 e 503 são tratados como capacidade indisponível", async () => {
  api.setSuperAdminToken("valid-token");
  globalThis.fetch = async () => new Response(
    JSON.stringify({ detail: "executor real ausente" }),
    { status: 501, headers: { "Content-Type": "application/json" } },
  );

  await assert.rejects(
    api.superAdminFetch("/api/super-admin/railway/restart"),
    (error: unknown) => (
      error instanceof api.SuperAdminApiError
      && error.unavailable
      && error.message.includes("Indisponível")
    ),
  );
});

test("falha de suspensão não possui mutação local e o painel não simula feed de webhooks", () => {
  const source = readFileSync(new URL("../src/super-admin/SuperAdminPanel.tsx", import.meta.url), "utf8");
  const suspension = source.slice(
    source.indexOf("const handleToggleTenantStatus"),
    source.indexOf("const triggerTelegramAlert"),
  );

  const suspensionCatch = suspension.slice(suspension.indexOf("catch"));
  assert.doesNotMatch(suspensionCatch, /setTenants\s*\(/);
  assert.match(suspensionCatch, /return false/);
  assert.doesNotMatch(source, /failedWebhooks|webhooksAvailable|handleForceConfirmWebhook/);
});

test("painel expõe inbox de contratações real com badge e sem simular ativações", () => {
  const panel = readFileSync(new URL("../src/super-admin/SuperAdminPanel.tsx", import.meta.url), "utf8");
  const inbox = readFileSync(new URL("../src/super-admin/SuperAdminContractsTab.tsx", import.meta.url), "utf8");

  assert.match(panel, /label: "Contratações"/);
  assert.match(panel, /\/api\/super-admin\/contracts\?status=all&limit=200/);
  assert.match(panel, /pendingContractsCount/);
  assert.match(panel, /30_000/);
  assert.match(inbox, /SIGNED_PENDING_ACTIVATION/);
  assert.match(inbox, /Aguardando ativação/);
  assert.match(inbox, /Evidência jurídica/);
  assert.match(inbox, /Nenhum restaurante foi criado ou vinculado automaticamente/);
  assert.doesNotMatch(inbox, /Ativar restaurante/);
});
