export const AUTH_REQUEST_TIMEOUT_MS = 12_000;

export class AuthRequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Authentication request timed out after ${timeoutMs}ms`);
    this.name = 'AuthRequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

async function performAuthRequest<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let timedOut = false;

  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return await consume(response, controller.signal);
  } catch (error) {
    if (timedOut) throw new AuthRequestTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}

/** Callers which need a raw Response keep the existing contract. */
export function authFetch(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = AUTH_REQUEST_TIMEOUT_MS): Promise<Response> {
  return performAuthRequest(input, init, timeoutMs, async response => response);
}

/** Keep the deadline active until the JSON body finishes, not only the headers. */
export function authFetchJson(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
  return performAuthRequest(input, init, timeoutMs, async (response, signal) => {
    let data: unknown = null;
    try { data = await response.json(); }
    catch (error) { if (signal.aborted) throw error; }
    return { response, data };
  });
}

export function authRequestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AuthRequestTimeoutError) {
    return 'O servidor demorou para responder. Confira a conexão e tente novamente.';
  }
  if (
    error instanceof TypeError
    && /failed to fetch|networkerror|network request failed/i.test(error.message)
  ) {
    return 'O servidor do KÔMA está indisponível no momento. Aguarde alguns instantes e tente novamente.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
