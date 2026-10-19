/** Bounded, explicit operational telemetry. Never reads request/response bodies or DOM text. */
export interface OperationalSignal {
  endpoint: string;
  method: string;
  status: number;
  duration_ms: number;
  outcome: 'http_error' | 'network_error' | 'slow';
  request_id?: string;
}

const ROUTE_WORDS = new Set(('api caixa comandas itens lancamentos cardapio pedidos produtos categorias '
  + 'clientes auth login logout refresh turno-atual resumo pagamentos pendentes fechar status '
  + 'print-agents heartbeat jobs claim-batch register configuracoes restaurantes relatorios '
  + 'promocoes dashboard financeiro estoque motoboys entregadores mesas capabilities').split(' '));

export function operationalEndpoint(input: string, apiOrigin: string, pageUrl: string): string | null {
  try {
    const url = new URL(input, pageUrl);
    if (url.origin !== apiOrigin || /\/(events|stream|ws)(\/|$)/.test(url.pathname)) return null;
    return '/' + url.pathname.split('/').filter(Boolean).slice(0, 8)
      .map(segment => ROUTE_WORDS.has(segment) ? segment : ':id').join('/');
  } catch { return null; }
}

export function createSignalBudget(now: () => number = Date.now) {
  const seen = new Map<string, number>();
  let windowStart = now();
  let count = 0;
  return (key: string): boolean => {
    const time = now();
    if (time - windowStart >= 300_000) { seen.clear(); count = 0; windowStart = time; }
    if (count >= 30 || (seen.has(key) && time - seen.get(key)! < 60_000)) return false;
    seen.set(key, time);
    count++;
    return true;
  };
}

/** Returns the exact original response/rejection; telemetry failures cannot break application requests. */
export function observeOperationalFetch(
  original: typeof fetch,
  apiOrigin: string,
  pageUrl: string,
  emit: (signal: OperationalSignal) => void,
  now: () => number = Date.now,
): typeof fetch {
  const accept = createSignalBudget(now);
  return async (input, init) => {
    const endpoint = operationalEndpoint(input instanceof Request ? input.url : String(input), apiOrigin, pageUrl);
    const rawMethod = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(rawMethod) ? rawMethod : 'OTHER';
    const started = now();
    const report = (status: number, outcome: OperationalSignal['outcome'], requestId?: string | null) => {
      if (!endpoint || !accept(`${endpoint}:${method}:${status}:${outcome}`)) return;
      try {
        emit({ endpoint, method, status, outcome, duration_ms: Math.min(120_000, Math.max(0, Math.round(now() - started))),
          ...(/^[a-f0-9-]{16,64}$/i.test(requestId || '') ? { request_id: requestId! } : {}) });
      } catch { /* Observability must not affect the caller. */ }
    };
    let response: Response;
    try { response = await original(input, init); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) report(0, 'network_error');
      throw error;
    }
    if (response.status >= 400) report(response.status, 'http_error', response.headers.get('X-Request-ID'));
    else if (now() - started >= 3000 && !response.headers.get('content-type')?.includes('text/event-stream')) report(response.status, 'slow');
    return response;
  };
}
