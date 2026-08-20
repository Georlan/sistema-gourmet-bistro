export const OPERATION_TIMEOUT_MS = 20_000;

export class OperationalRequestTimeoutError extends Error {
  constructor() {
    super('O servidor demorou para responder. Confira o pedido antes de tentar novamente.');
    this.name = 'OperationalRequestTimeoutError';
  }
}

export async function operationalFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = OPERATION_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw new OperationalRequestTimeoutError();
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function makeOperationKey(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

type PendingOperation = {
  fingerprint: string;
  key: string;
};

export function getOrCreatePersistedOperationKey(
  storageKey: string,
  fingerprint: string,
  prefix: string,
) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as PendingOperation | null;
    if (saved?.fingerprint === fingerprint && saved.key) return saved.key;
  } catch {
    // Um storage corrompido não deve bloquear a operação; ele será substituído.
  }

  const key = makeOperationKey(prefix);
  try {
    localStorage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
  } catch {
    // Navegadores restritos ainda contam com o bloqueio de clique da sessão.
  }
  return key;
}

export function clearPersistedOperationKey(storageKey: string, expectedKey: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as PendingOperation | null;
    if (!saved || saved.key === expectedKey) localStorage.removeItem(storageKey);
  } catch {
    // A confirmação do servidor já aconteceu. Falhas de storage não podem
    // transformar sucesso em erro nem restaurar o carrinho confirmado.
  }
}
