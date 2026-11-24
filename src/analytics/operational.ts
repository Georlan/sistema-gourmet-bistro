/** Bounded, explicit operational telemetry. Never reads request/response bodies or DOM text. */
export interface OperationalSignal {
  endpoint: string;
  method: string;
  status: number;
  duration_ms: number;
  outcome: 'http_error' | 'network_error' | 'slow';
  request_id?: string;
  support_code?: string;
  area?: ReturnType<typeof operationalArea>;
  surface?: string;
  is_diagnostic?: boolean;
}

/** Enriches an operational signal for analytics without mutating the base capture test contract. */
export function enrichOperationalSignal(
  signal: OperationalSignal,
  surface?: string,
): OperationalSignal {
  const reqId = typeof signal.request_id === 'string' ? signal.request_id.trim() : '';
  const supportCode = /^[A-Za-z0-9_-]{8,64}$/.test(reqId) ? reqId.slice(0, 12) : undefined;
  return {
    ...signal,
    ...(supportCode ? { support_code: supportCode } : {}),
    area: operationalArea(signal.endpoint),
    ...(surface ? { surface } : {}),
  };
}

const ROUTE_WORDS = new Set(('api caixa comandas itens lancamentos cardapio cardapio-digital assets promotion pedidos produtos categorias '
  + 'clientes fidelidade lookup auth login logout refresh turno-atual resumo pagamentos pendentes fechar status '
  + 'print-agents heartbeat jobs claim-batch register configuracoes restaurantes relatorios '
  + 'promocoes dashboard financeiro estoque motoboys entregadores mesas capabilities '
  + 'contracts payment-methods-v2 subscription billing setup pix select accept activate-free signups current print-jobs print impressao imprimir reimprimir recibo delivery deliveries entregas payments intents refunds simulator '
  + 'teste_extremo health ping simulador sources diagnostico diagnostic').split(' '));

/** Identifies diagnostic or simulation endpoints that should not distort commercial error metrics. */
export function isDiagnosticEndpoint(endpoint: string): boolean {
  return /simulator|simulador|teste_extremo|health|ping|diagnostic|diagnostico/i.test(endpoint);
}

function isTimeoutReason(reason: unknown): boolean {
  if (!reason || typeof reason !== 'object') return false;
  const name = (reason as { name?: string }).name;
  if (name === 'TimeoutError') return true;
  const msg = (reason as { message?: string }).message;
  return typeof msg === 'string' && /\b(timed?\s*out|timeout)\b/i.test(msg);
}

/** Differentiates intentional client aborts/unloads from real backend transport failures and timeouts. */
export function isAbortOrCancellation(
  error: unknown,
  signal?: AbortSignal | null,
  input?: RequestInfo | URL,
): boolean {
  // If the error itself or the abort reason was a timeout, it is a legitimate failure, NOT an intentional abort.
  if (isTimeoutReason(error)) return false;
  if (signal?.aborted && isTimeoutReason(signal.reason)) return false;
  if (input instanceof Request && input.signal?.aborted && isTimeoutReason(input.signal.reason)) return false;

  // Intentional aborts via signal
  if (signal?.aborted) return true;
  if (input instanceof Request && input.signal?.aborted) return true;

  // Intentional abort errors (e.g. DOMException AbortError, Axios CanceledError)
  if (error && typeof error === 'object') {
    const err = error as { name?: string; message?: string };
    if (err.name === 'AbortError' || err.name === 'CanceledError' || err.name === 'CancelledError') {
      return true;
    }
    if (typeof err.message === 'string' && /\b(aborted|canceled|cancelled)\b/i.test(err.message)) {
      return true;
    }
  }

  return false;
}

/** Fixed categories, never inferred from customer text or request bodies. */
export function operationalArea(endpoint: string): 'printing' | 'payments' | 'orders' | 'delivery' | 'catalog' | 'auth' | 'other' {
  const parts = new Set(endpoint.split('/'));
  const has = (...values: string[]) => values.some(value => parts.has(value));
  if (has('print-agents', 'print-jobs', 'print', 'impressao', 'imprimir', 'reimprimir', 'recibo', 'simulator')) return 'printing';
  if (has('pagamentos', 'payments', 'billing', 'pix', 'intents', 'refunds')) return 'payments';
  if (has('motoboys', 'entregadores', 'delivery', 'deliveries', 'entregas')) return 'delivery';
  if (has('pedidos', 'comandas', 'mesas', 'lancamentos')) return 'orders';
  if (has('cardapio', 'cardapio-digital', 'produtos', 'categorias', 'promocoes', 'promotion')) return 'catalog';
  if (has('auth', 'login', 'logout', 'refresh')) return 'auth';
  return 'other';
}

/** Filters unhandled Android WebView bridge teardown noise (e.g. Instagram in-app browser). */
export function isKnownExternalWebViewNoise(event: { event?: string; properties?: Record<string, any> } | null | undefined): boolean {
  if (!event || event.event !== '$exception') return false;
  const props = event.properties;
  if (!props || typeof props !== 'object') return false;
  const values: unknown[] = Array.isArray(props.$exception_values) ? props.$exception_values : [];
  const listValues: unknown[] = Array.isArray(props.$exception_list)
    ? props.$exception_list.map((entry: any) => entry?.value)
    : [];
  const messages = [...values, ...listValues].filter((v): v is string => typeof v === 'string');
  return messages.some(msg => msg.includes('Error invoking postMessage: Java object is gone'));
}

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
        emit({
          endpoint,
          method,
          status,
          outcome,
          duration_ms: Math.min(120_000, Math.max(0, Math.round(now() - started))),
          ...(isDiagnosticEndpoint(endpoint) ? { is_diagnostic: true } : {}),
          ...(/^[A-Za-z0-9_-]{8,64}$/.test(requestId || '') ? { request_id: requestId! } : {}),
        });
      } catch { /* Observability must not affect the caller. */ }
    };
    let response: Response;
    try { response = await original(input, init); }
    catch (error) {
      const signal = init?.signal || (input instanceof Request ? input.signal : null);
      if (!isAbortOrCancellation(error, signal, input)) {
        report(0, 'network_error');
      }
      throw error;
    }
    if (response.status >= 400) report(response.status, 'http_error', response.headers.get('X-Request-ID'));
    else if (now() - started >= 3000 && !response.headers.get('content-type')?.includes('text/event-stream')) report(response.status, 'slow', response.headers.get('X-Request-ID'));
    return response;
  };
}
