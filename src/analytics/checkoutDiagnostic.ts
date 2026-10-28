/** One bounded, technical result per actual submission. No customer/cart/error text. */
export type CheckoutStage = 'catalog' | 'submission';
export type CheckoutOutcome = 'accepted' | 'http_error' | 'network_error' | 'timeout'
  | 'invalid_response' | 'catalog_changed' | 'ordering_blocked' | 'session_expired' | 'client_error';
export interface CheckoutDiagnosticSignal {
  restaurant_id: number;
  attempt_id: string;
  support_code: string;
  stage: CheckoutStage;
  outcome: CheckoutOutcome;
  status: number;
  duration_ms: number;
  request_id?: string;
}

export function createCheckoutDiagnostics(
  emit: (signal: CheckoutDiagnosticSignal) => void,
  now: () => number = Date.now,
  createId: () => string = () => crypto.randomUUID().replaceAll('-', ''),
) {
  let windowStart = now();
  let count = 0;
  return (restaurantId: number) => {
    const started = now();
    let attemptId = '';
    try { attemptId = createId(); } catch { /* Diagnostics must never prevent ordering. */ }
    if (!/^[a-f0-9]{32}$/.test(attemptId)) attemptId = '';
    let stage: CheckoutStage = 'catalog';
    let status = 0;
    let requestId: string | undefined;
    let completed = false;
    return {
      // POST already preflights for JSON/idempotency. Catalog GET gains no custom header.
      headers: attemptId ? { 'X-Request-ID': attemptId } : {},
      setStage(next: CheckoutStage) { stage = next; status = 0; requestId = undefined; },
      response(response: Response) {
        status = response.status;
        const id = response.headers.get('X-Request-ID')?.trim() || '';
        requestId = /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : undefined;
      },
      finish(outcome: CheckoutOutcome) {
        const supportCode = (requestId || attemptId).slice(0, 12);
        if (completed) return supportCode;
        completed = true;
        if (started - windowStart >= 300_000) { windowStart = started; count = 0; }
        if (attemptId && Number.isSafeInteger(restaurantId) && restaurantId > 0 && count < 20) {
          count++;
          try {
            emit({ restaurant_id: restaurantId, attempt_id: attemptId, support_code: supportCode,
              stage, outcome, status, duration_ms: Math.max(0, Math.min(120_000, Math.round(now() - started))),
              ...(requestId ? { request_id: requestId } : {}) });
          } catch { /* A blocked SDK cannot change the order's outcome. */ }
        }
        return supportCode;
      },
      failure(error: unknown): CheckoutOutcome {
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'TimeoutError' || /abort|timeout/i.test(error.message))
        ) {
          return 'timeout';
        }
        if (status >= 400) return 'http_error';
        if (error instanceof SyntaxError || status > 0) return 'invalid_response';
        return error instanceof TypeError ? 'network_error' : 'client_error';
      },
    };
  };
}
