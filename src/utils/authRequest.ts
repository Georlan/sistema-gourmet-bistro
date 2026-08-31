export const AUTH_REQUEST_TIMEOUT_MS = 12_000;

export class AuthRequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Authentication request timed out after ${timeoutMs}ms`);
    this.name = 'AuthRequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): Promise<Response> {
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
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new AuthRequestTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}

export function authRequestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AuthRequestTimeoutError) {
    return 'O servidor demorou para responder. Confira a conexão e tente novamente.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
