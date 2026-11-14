export interface CaixaConfigResult {
  ok: boolean;
  status: number;
  data: Record<string, any> | null;
}

const CONFIG_CACHE_TTL_MS = 3000;
const REQUEST_TIMEOUT_MS = 8000;
const inFlight = new Map<string, Promise<CaixaConfigResult>>();
const recentCache = new Map<string, { expiresAt: number; result: CaixaConfigResult }>();

export function invalidateCaixaConfiguracoesCache() {
  inFlight.clear();
  recentCache.clear();
}

export function fetchCaixaConfiguracoes(
  apiBaseUrl: string,
  headers: Record<string, string>,
  options?: { force?: boolean },
): Promise<CaixaConfigResult> {
  const auth = headers.Authorization || headers.authorization || '';
  const key = `${apiBaseUrl}|${auth}`;
  const force = options?.force === true;

  if (!force) {
    const cached = recentCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.result);
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
  }

  const request = (async (): Promise<CaixaConfigResult> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await globalThis.fetch(`${apiBaseUrl}/caixa/configuracoes`, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        return { ok: false, status: response.status, data: null };
      }
      const data = (await response.json()) as Record<string, any>;
      const result: CaixaConfigResult = { ok: true, status: response.status, data };
      recentCache.set(key, {
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
        result,
      });
      return result;
    } finally {
      clearTimeout(timeout);
    }
  })();

  inFlight.set(key, request);
  void request.finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }).catch(() => {});

  return request;
}
