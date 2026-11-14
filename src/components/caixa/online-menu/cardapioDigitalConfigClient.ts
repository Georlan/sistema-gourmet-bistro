type CacheEntry = {
  expiresAt: number;
  data: unknown;
};

const RECENT_TTL_MS = 3000;
const inFlightRequests = new Map<string, Promise<unknown>>();
const recentResponses = new Map<string, CacheEntry>();

function buildScopeKey(url: string, authorization: string): string {
  return `${url}\u0000${authorization}`;
}

export function invalidateCardapioDigitalConfigCache(): void {
  recentResponses.clear();
}

export async function fetchCardapioDigitalConfig<T = Record<string, unknown>>(
  apiBaseUrl: string,
  authorization: string,
  options?: { restaurantId?: number | null; force?: boolean; signal?: AbortSignal },
): Promise<T> {
  const query = options?.restaurantId ? `?restaurante_id=${options.restaurantId}` : '';
  const url = `${apiBaseUrl}/api/cardapio-digital/config${query}`;
  const key = buildScopeKey(url, authorization);
  const now = Date.now();

  if (options?.force) {
    recentResponses.delete(key);
  } else {
    const cached = recentResponses.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.data as T;
    }
  }

  let flight = inFlightRequests.get(key);
  if (!flight) {
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
