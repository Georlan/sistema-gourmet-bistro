export type PopularProductEntry = {
  produto_id: string | number;
  escolhas?: number;
};

type CacheEntry = {
  expiresAt: number;
  ids: string[];
};

const POPULAR_TTL_MS = 60_000;
const inFlightRequests = new Map<string, Promise<string[]>>();
const recentResults = new Map<string, CacheEntry>();
const aliasKeys = new Map<string, string>();

function buildKey(apiBaseUrl: string, kind: 'slug' | 'id', value: string): string {
  return `${apiBaseUrl}\u0000${kind}\u0000${value.trim().toLowerCase()}`;
}

export function registerPopularProductsAlias(
  apiBaseUrl: string,
  restaurantId: string | number,
  slug: string,
): void {
  const cleanId = String(restaurantId || '').trim();
  const cleanSlug = String(slug || '').trim();
  if (!cleanId || !cleanSlug) return;
  aliasKeys.set(
    buildKey(apiBaseUrl, 'id', cleanId),
    buildKey(apiBaseUrl, 'slug', cleanSlug),
  );
}

export function clearPopularProductsCache(): void {
  inFlightRequests.clear();
  recentResults.clear();
  aliasKeys.clear();
}

export function fetchPopularProducts({
  apiBaseUrl,
  slug,
  restaurantId,
  force = false,
}: {
  apiBaseUrl: string;
  slug?: string | null;
  restaurantId?: string | number | null;
  force?: boolean;
}): Promise<string[]> {
  const cleanSlug = String(slug || '').trim();
  const cleanId = String(restaurantId || '').trim();
  if (!cleanSlug && !cleanId) return Promise.resolve([]);

  const rawKey = cleanSlug
    ? buildKey(apiBaseUrl, 'slug', cleanSlug)
    : buildKey(apiBaseUrl, 'id', cleanId);
  const key = aliasKeys.get(rawKey) ?? rawKey;
  const now = Date.now();

  if (force) {
    recentResults.delete(key);
  } else {
    const cached = recentResults.get(key);
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.ids);
    }
  }

  let flight = inFlightRequests.get(key);
  if (!flight) {
    const query = cleanSlug
      ? `slug=${encodeURIComponent(cleanSlug)}`
      : `restaurante_id=${encodeURIComponent(cleanId)}`;
    flight = (async () => {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/populares?${query}`);
      if (!response.ok) return [];
      const payload = (await response.json()) as { produtos?: PopularProductEntry[] };
      const ids = Array.isArray(payload?.produtos)
        ? payload.produtos.map((item) => String(item.produto_id || '')).filter(Boolean)
        : [];
      recentResults.set(key, { expiresAt: Date.now() + POPULAR_TTL_MS, ids });
      return ids;
    })().finally(() => {
      if (inFlightRequests.get(key) === flight) {
        inFlightRequests.delete(key);
      }
    });
    inFlightRequests.set(key, flight);
  }

  return flight;
}
