import test from "node:test";
import assert from "node:assert/strict";
import { enrichOperationalSignal } from "../src/analytics/operational";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

test("support error ring buffer bounds to 5, expires at 30m, and isolates scopes", async () => {
  const storage = createMemoryStorage();
  Object.assign(globalThis, {
    sessionStorage: storage,
    window: { location: { hostname: "localhost", protocol: "http:", href: "http://localhost:3000/" } },
  });
  const {
    RECENT_API_ERRORS_KEY,
    clearRecentApiErrors,
    getLatestApiError,
    getRecentApiErrors,
    recordRecentApiError,
  } = await import("../src/utils/supportCode");

  clearRecentApiErrors();
  const baseTime = 1_700_000_000_000;
  for (let i = 1; i <= 7; i++) {
    recordRecentApiError(
      {
        support_code: `req-code-${i}`.padEnd(11, "0"),
        status: 500,
        endpoint: "/api/orders",
        area: "orders",
        at: baseTime + i * 1000,
      },
      "42:user-a",
      baseTime + i * 1000,
    );
  }

  const scopedA = getRecentApiErrors("42:user-a", baseTime + 7000);
  assert.equal(scopedA.length, 5);
  assert.equal(scopedA[0].support_code, "req-code-70");
  assert.equal(getLatestApiError("42:user-a", baseTime + 7000)?.support_code, "req-code-70");

  // Outro tenant/usuário não enxerga erros do escopo anterior
  assert.deepEqual(getRecentApiErrors("43:user-b", baseTime + 7000), []);
  assert.equal(getLatestApiError("42:user-b", baseTime + 7000), null);

  // Expiração após TTL de 30 minutos
  const afterTtl = baseTime + 31 * 60 * 1000;
  assert.deepEqual(getRecentApiErrors("42:user-a", afterTtl), []);

  // Rejeita endpoint inválido com querystring no ring buffer
  recordRecentApiError(
    {
      support_code: "badcode123",
      status: 400,
      endpoint: "https://external.example/leak?token=abc",
      area: "other",
      at: baseTime,
    },
    "42:user-a",
    baseTime,
  );
  assert.equal(storage.getItem(RECENT_API_ERRORS_KEY)?.includes("token=abc"), false);

  clearRecentApiErrors();
  assert.equal(storage.getItem(RECENT_API_ERRORS_KEY), null);
});

test("installSupportCodeObserver records >=400 and inline support errors into scoped buffer while dispatching toast only on >=500 non-inline", async () => {
  const storage = createMemoryStorage();
  storage.setItem("koma_active_operational_portal", "caixa");
  storage.setItem(
    "koma_operator_session_caixa",
    JSON.stringify({ user: { restaurante_id: 19, id: "u-9" } }),
  );
  const events: Array<{ type: string; detail: any }> = [];
  const fakeWindow = {
    location: { hostname: "localhost", protocol: "http:", href: "http://localhost:3000/" },
    fetch: async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("inline-500")) {
        return new Response(null, { status: 500, headers: { "X-Request-ID": "inline500req123" } });
      }
      if (url.includes("bad-422")) {
        return new Response(null, { status: 422, headers: { "X-Request-ID": "bad422req1234" } });
      }
      return new Response(null, { status: 503, headers: { "X-Request-ID": "server503req1" } });
    },
    dispatchEvent: (event: CustomEvent<any>) => {
      events.push({ type: event.type, detail: event.detail });
      return true;
    },
  };
  Object.assign(globalThis, { sessionStorage: storage, window: fakeWindow });

  const {
    SUPPORT_ERROR_EVENT,
    clearRecentApiErrors,
    fetchWithInlineSupport,
    getRecentApiErrors,
    installSupportCodeObserver,
  } = await import("../src/utils/supportCode");

  clearRecentApiErrors();
  installSupportCodeObserver();
  await fakeWindow.fetch("http://localhost:8000/bad-422?telefone=85999999999");
  await fetchWithInlineSupport("http://localhost:8000/cardapio/inline-500");
  await fakeWindow.fetch("http://localhost:8000/pedidos/server-503");

  assert.equal(events.length, 1);
  assert.equal(events[0].type, SUPPORT_ERROR_EVENT);
  assert.equal(events[0].detail.code, "server503req");

  const recorded = getRecentApiErrors();
  assert.equal(recorded.length, 3);
  assert.deepEqual(
    recorded.map((item) => ({ status: item.status, code: item.support_code })),
    [
      { status: 503, code: "server503req" },
      { status: 500, code: "inline500req" },
      { status: 422, code: "bad422req123" },
    ],
  );
  assert.equal(recorded.every((item) => !item.endpoint.includes("85999999999")), true);
});

test("enrichOperationalSignal attaches support_code prefix when request_id is safe", () => {
  const enriched = enrichOperationalSignal(
    {
      endpoint: "/api/print-jobs",
      method: "POST",
      status: 502,
      duration_ms: 120,
      outcome: "http_error",
      request_id: "req-1234567890abcd",
    },
    "caixa",
  );
  assert.equal(enriched.support_code, "req-12345678");
  assert.equal(enriched.area, "printing");
  assert.equal(enriched.surface, "caixa");

  const withoutId = enrichOperationalSignal(
    {
      endpoint: "/pedidos",
      method: "GET",
      status: 0,
      duration_ms: 50,
      outcome: "network_error",
    },
    "garcom",
  );
  assert.equal("support_code" in withoutId, false);
});
