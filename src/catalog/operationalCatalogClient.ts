export interface OperationalCatalogResult {
  status: number;
  ok: boolean;
  payload?: unknown;
  errorBodyText?: string;
}

type CacheEntry = {
  expiresAt: number;
  result: OperationalCatalogResult;
};

const OPERATIONAL_CATALOG_TTL_MS = 5_000;
const inFlightRequests = new Map<string, Promise<OperationalCatalogResult>>();
const recentResults = new Map<string, CacheEntry>();

function buildKey(apiBaseUrl: string, token: string): string {
  return `${apiBaseUrl}\u0000${token}`;
}

export function clearOperationalCatalogCache(): void {
  inFlightRequests.clear();
  recentResults.clear();
}

export function fetchOperationalCatalog({
  apiBaseUrl,
  token,
  force = false,
  fetcher = fetch,
}: {
  apiBaseUrl: string;
  token: string;
  force?: boolean;
  fetcher?: typeof fetch;
}): Promise<OperationalCatalogResult> {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) {
    return Promise.resolve({ status: 401, ok: false, errorBodyText: '' });
  }

  const key = buildKey(apiBaseUrl, cleanToken);
  const now = Date.now();

  if (force) {
    recentResults.delete(key);
  } else {
    const cached = recentResults.get(key);
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.result);
    }
  }

  let flight = inFlightRequests.get(key);
  if (!flight) {
    const headers: Record<string, string> = { Authorization: `Bearer ${cleanToken}` };
    flight = (async (): Promise<OperationalCatalogResult> => {
      const catalogResponse = await fetcher(`${apiBaseUrl}/produtos/catalogo`, {
        headers,
        cache: 'no-store',
      });

      if (catalogResponse.ok) {
        const payload = await catalogResponse.json();
        const result: OperationalCatalogResult = {
          status: catalogResponse.status,
          ok: true,
          payload,
        };
        recentResults.set(key, {
          expiresAt: Date.now() + OPERATIONAL_CATALOG_TTL_MS,
          result,
        });
        return result;
      }

      if (catalogResponse.status === 404 || catalogResponse.status === 405) {
        // Compatibilidade durante deploy gradual: o endpoint atômico pode
        // chegar alguns segundos depois do frontend novo.
        const [productsResponse, categoriesResponse] = await Promise.all([
          fetcher(`${apiBaseUrl}/produtos/`, { headers, cache: 'no-store' }),
          fetcher(`${apiBaseUrl}/produtos/categorias`, { headers, cache: 'no-store' }),
        ]);

        if (productsResponse.status === 401 || categoriesResponse.status === 401) {
          return { status: 401, ok: false, errorBodyText: '' };
        }

        if (!productsResponse.ok || !categoriesResponse.ok) {
          const failed = !productsResponse.ok ? productsResponse : categoriesResponse;
          const errorBodyText = await failed.text().catch(() => '');
          return {
            status: failed.status,
            ok: false,
            errorBodyText,
          };
        }

        const payload = {
          produtos: await productsResponse.json(),
          categorias: await categoriesResponse.json(),
        };
        const result: OperationalCatalogResult = {
          status: 200,
          ok: true,
          payload,
        };
        recentResults.set(key, {
          expiresAt: Date.now() + OPERATIONAL_CATALOG_TTL_MS,
          result,
        });
        return result;
      }

      const errorBodyText = await catalogResponse.text().catch(() => '');
      return {
        status: catalogResponse.status,
        ok: false,
        errorBodyText,
      };
    })().finally(() => {
      if (inFlightRequests.get(key) === flight) {
        inFlightRequests.delete(key);
      }
    });
    inFlightRequests.set(key, flight);
  }

  return flight;
}
