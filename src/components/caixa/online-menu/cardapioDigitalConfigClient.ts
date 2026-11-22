type CacheEntry = {
  expiresAt: number;
  data: unknown;
};

export interface CardapioDigitalConfigCacheStats {
  hits: number;
  misses: number;
  invalidations: number;
}

export const CARDAPIO_DIGITAL_CONFIG_UPDATED_EVENT = 'koma_cardapio_config_updated';
export const CARDAPIO_DIGITAL_CONFIG_TTL_MS = 30_000;
const RECENT_TTL_MS = CARDAPIO_DIGITAL_CONFIG_TTL_MS;
const inFlightRequests = new Map<string, Promise<unknown>>();
const recentResponses = new Map<string, CacheEntry>();
let lastScopeKey: string | null = null;
const cacheStats: CardapioDigitalConfigCacheStats = {
  hits: 0,
  misses: 0,
  invalidations: 0,
};

function emitCardapioDigitalConfigUpdated(): void {
  if (
    typeof window !== 'undefined'
    && typeof window.dispatchEvent === 'function'
    && typeof Event === 'function'
  ) {
    window.dispatchEvent(new Event(CARDAPIO_DIGITAL_CONFIG_UPDATED_EVENT));
  }
}

export function getCardapioDigitalConfigCacheStats(): CardapioDigitalConfigCacheStats {
  return { ...cacheStats };
}

export function resetCardapioDigitalConfigCacheStats(): void {
  cacheStats.hits = 0;
  cacheStats.misses = 0;
  cacheStats.invalidations = 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveRequestUrl(
  apiBaseUrl: string,
  restaurantId?: number | null,
): string {
  const query = restaurantId ? `?restaurante_id=${restaurantId}` : '';
  return `${apiBaseUrl}/api/cardapio-digital/config${query}`;
}

function buildScopeKey(
  apiBaseUrl: string,
  authorization: string,
  restaurantId?: number | null,
): string {
  const hasAuth = Boolean(authorization && authorization.trim());
  const base = `${apiBaseUrl}/api/cardapio-digital/config`;
  if (hasAuth) {
    return `${base}\u0000${authorization}`;
  }
  const query = restaurantId ? `?restaurante_id=${restaurantId}` : '';
  return `${base}${query}\u0000`;
}

function mergeCachedData(previous: unknown, next: unknown): unknown {
  if (isPlainRecord(previous) && isPlainRecord(next)) {
    return { ...previous, ...next };
  }
  return next;
}

export function invalidateCardapioDigitalConfigCache(): void {
  inFlightRequests.clear();
  recentResponses.clear();
  lastScopeKey = null;
  cacheStats.invalidations += 1;
  emitCardapioDigitalConfigUpdated();
}

export function updateCardapioDigitalConfigCache<T = Record<string, unknown>>(
  apiBaseUrl: string,
  authorization: string,
  data: T,
): void;
export function updateCardapioDigitalConfigCache<T = Record<string, unknown>>(
  data: T,
): void;
export function updateCardapioDigitalConfigCache<T = Record<string, unknown>>(
  first: string | T,
  second?: string,
  third?: T,
): void {
  const now = Date.now();
  if (typeof first === 'string' && typeof second === 'string') {
    const key = buildScopeKey(first, second);
    const existing = recentResponses.get(key);
    recentResponses.set(key, {
      expiresAt: now + RECENT_TTL_MS,
      data: mergeCachedData(existing?.data, third),
    });
    lastScopeKey = key;
    emitCardapioDigitalConfigUpdated();
    return;
  }

  const key = lastScopeKey;
  if (!key) return;
  const existing = recentResponses.get(key);
  recentResponses.set(key, {
    expiresAt: now + RECENT_TTL_MS,
    data: mergeCachedData(existing?.data, first),
  });
  emitCardapioDigitalConfigUpdated();
}

export async function fetchCardapioDigitalConfig<T = Record<string, unknown>>(
  apiBaseUrl: string,
  authorization: string,
  options?: { restaurantId?: number | null; force?: boolean; signal?: AbortSignal },
): Promise<T> {
  const url = resolveRequestUrl(apiBaseUrl, options?.restaurantId);
  const key = buildScopeKey(apiBaseUrl, authorization, options?.restaurantId);
  const now = Date.now();

  if (options?.force) {
    recentResponses.delete(key);
  } else {
    const cached = recentResponses.get(key);
    if (cached && cached.expiresAt > now) {
      cacheStats.hits += 1;
      lastScopeKey = key;
      return cached.data as T;
    }
  }

  let flight = inFlightRequests.get(key);
  if (flight) {
    cacheStats.hits += 1;
  } else {
    cacheStats.misses += 1;
    flight = (async () => {
      const response = await fetch(url, {
        headers: { Authorization: authorization },
        cache: 'no-store',
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new Error(`Falha ao carregar configuração do cardápio (${response.status})`);
      }
      const data = await response.json();
      recentResponses.set(key, { expiresAt: Date.now() + RECENT_TTL_MS, data });
      lastScopeKey = key;
      return data;
    })().finally(() => {
      if (inFlightRequests.get(key) === flight) {
        inFlightRequests.delete(key);
      }
    });
    inFlightRequests.set(key, flight);
  }

  return (await flight) as T;
}
