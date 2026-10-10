const flights = new Map<string, Promise<Response>>();

export function invalidateSnapshotReads() { flights.clear(); }

/** Small JSON snapshots only; SSE and binary transfers use native fetch. */
export function snapshotFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if ((init.method || 'GET').toUpperCase() !== 'GET') {
    invalidateSnapshotReads();
    return globalThis.fetch(input, init).finally(invalidateSnapshotReads);
  }
  const headers = [...new Headers(init.headers).entries()].sort(([a], [b]) => a.localeCompare(b));
  const key = JSON.stringify([input, headers, init.cache, init.credentials]);
  const shared = !init.signal && flights.get(key);
  if (shared) return shared.then(response => response.clone());
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('SNAPSHOT_TIMEOUT')), 8000);
  const request = (async () => {
    try {
      const response = await globalThis.fetch(input, { ...init, signal: controller.signal });
      // Consume a clone so the deadline covers slow bodies, too; each owner gets its own response.
      await response.clone().arrayBuffer();
      return response;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
    }
  })();
  if (!init.signal) {
    flights.set(key, request);
    void request.finally(() => { if (flights.get(key) === request) flights.delete(key); }).catch(() => {});
  }
  return request.then(response => response.clone());
}
