export interface OnlineOrdersControlResult {
  ok: boolean;
  status: number;
  payload: Record<string, any> | null;
}

const CONTROL_CACHE_TTL_MS = 3000;
const inFlight = new Map<string, Promise<OnlineOrdersControlResult>>();
const recentCache = new Map<string, { expiresAt: number; result: OnlineOrdersControlResult }>();

export function invalidateOnlineOrdersControlCache() {
  inFlight.clear();
  recentCache.clear();
}

export function fetchOnlineOrdersControl(
  apiBaseUrl: string,
  authorizationHeader: string,
  options?: { force?: boolean },
): Promise<OnlineOrdersControlResult> {
  const key = `${apiBaseUrl}|${authorizationHeader}`;
  const force = options?.force === true;

  if (!force) {
    const cached = recentCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.result);
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
  }

  const request = (async (): Promise<OnlineOrdersControlResult> => {
    const response = await fetch(`${apiBaseUrl}/api/online-orders/control`, {
      headers: authorizationHeader ? { Authorization: authorizationHeader } : {},
      cache: 'no-store',
    });
    if (!response.ok) {
      return { ok: false, status: response.status, payload: null };
    }
    const payload = (await response.json()) as Record<string, any>;
    const result: OnlineOrdersControlResult = { ok: true, status: response.status, payload };
    recentCache.set(key, {
      expiresAt: Date.now() + CONTROL_CACHE_TTL_MS,
      result,
    });
    return result;
  })();

  inFlight.set(key, request);
  void request.finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }).catch(() => {});

  return request;
}
