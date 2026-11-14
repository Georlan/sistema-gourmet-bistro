import { resolveKomaHost } from '../domain/komaHost';

export interface PublicMenuPayload {
  restaurante: Record<string, any>;
  categorias: Array<Record<string, any>>;
  produtos: Array<Record<string, any>>;
  produtos_promocionais?: Array<Record<string, any>>;
  promocoes?: Array<Record<string, any>>;
  promocao_composicao_explicita?: boolean;
}

type CacheEntry = {
  expiresAt: number;
  payload: PublicMenuPayload;
};

const PUBLIC_MENU_TTL_MS = 10_000;
const inFlightRequests = new Map<string, Promise<PublicMenuPayload>>();
const recentResults = new Map<string, CacheEntry>();

function buildKey(apiBaseUrl: string, identifier: string): string {
  return `${apiBaseUrl}\u0000${identifier.trim().toLowerCase()}`;
}

export function getPublicMenuIdentifier(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const restaurantId = params.get('restaurant_id') || params.get('restaurante_id');
  if (restaurantId) return restaurantId;

  const resolved = resolveKomaHost();
  if (resolved.tenantSlug) return resolved.tenantSlug;

  const slug = params.get('slug');
  if (slug) return slug;

  return null;
}

export function clearPublicMenuCache(): void {
  inFlightRequests.clear();
  recentResults.clear();
}

export function fetchPublicMenu({
  apiBaseUrl,
  identifier,
  force = false,
}: {
  apiBaseUrl: string;
  identifier: string;
  force?: boolean;
}): Promise<PublicMenuPayload> {
  const cleanIdentifier = String(identifier || '').trim();
  if (!cleanIdentifier) {
    return Promise.reject(new Error('CARDAPIO_NOT_FOUND'));
  }

  const key = buildKey(apiBaseUrl, cleanIdentifier);
  const now = Date.now();

  if (force) {
    recentResults.delete(key);
  } else {
    const cached = recentResults.get(key);
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.payload);
    }
  }

  let flight = inFlightRequests.get(key);
  if (!flight) {
    const isNumericIdentifier = /^\d+$/.test(cleanIdentifier);
    const query = new URLSearchParams(
      isNumericIdentifier ? { restaurante_id: cleanIdentifier } : { slug: cleanIdentifier },
    );
    flight = (async () => {
      const response = await fetch(
        `${apiBaseUrl}/api/cardapio-digital/public?${query.toString()}`,
        { cache: 'no-store' },
      );
      if (response.status === 404) throw new Error('CARDAPIO_NOT_FOUND');
      if (!response.ok) throw new Error(`CARDAPIO_HTTP_${response.status}`);

      const payload = (await response.json()) as PublicMenuPayload;
      if (
        !payload?.restaurante
        || !Array.isArray(payload.categorias)
        || !Array.isArray(payload.produtos)
      ) {
        throw new Error('CARDAPIO_INVALID_RESPONSE');
      }

      recentResults.set(key, {
        expiresAt: Date.now() + PUBLIC_MENU_TTL_MS,
        payload,
      });
      return payload;
    })().finally(() => {
      if (inFlightRequests.get(key) === flight) {
        inFlightRequests.delete(key);
      }
    });
    inFlightRequests.set(key, flight);
  }

  return flight;
}
