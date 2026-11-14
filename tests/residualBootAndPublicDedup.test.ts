import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clearPublicMenuCache, fetchPublicMenu } from '../src/cardapio/publicMenuClient';
import {
  clearOperationalCatalogCache,
  fetchOperationalCatalog,
} from '../src/catalog/operationalCatalogClient';

test('fetchPublicMenu coalesces concurrent cold-load calls into one HTTP request and honors force refresh', async () => {
  clearPublicMenuCache();
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls += 1;
    assert.match(String(url), /\/api\/cardapio-digital\/public\?slug=d8-burger/);
    return new Response(
      JSON.stringify({
        restaurante: { id: 6, slug: 'd8-burger', nome: 'D8 Burger' },
        categorias: [{ id: 1, nome: 'Burgers' }],
        produtos: [{ id: 10, nome: 'Smash', preco: 25 }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const [first, second] = await Promise.all([
      fetchPublicMenu({ apiBaseUrl: 'https://api.test', identifier: 'd8-burger' }),
      fetchPublicMenu({ apiBaseUrl: 'https://api.test', identifier: 'd8-burger' }),
    ]);
    assert.equal(calls, 1);
    assert.equal(first.restaurante.id, 6);
    assert.equal(second.restaurante.id, 6);

    // Subsequent non-forced call within TTL reuses cache.
    await fetchPublicMenu({ apiBaseUrl: 'https://api.test', identifier: 'd8-burger' });
    assert.equal(calls, 1);

    // Forced background refresh hits the network.
    await fetchPublicMenu({ apiBaseUrl: 'https://api.test', identifier: 'd8-burger', force: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearPublicMenuCache();
  }
});

test('fetchOperationalCatalog coalesces /produtos/catalogo without calling /produtos/categorias unless 404/405', async () => {
  clearOperationalCatalogCache();
  const seenUrls: string[] = [];

  const okFetcher = (async (url: RequestInfo | URL) => {
    seenUrls.push(String(url));
    return new Response(JSON.stringify({ produtos: [{ id: 1 }], categorias: [{ id: 2 }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const [probeResult, hookResult] = await Promise.all([
    fetchOperationalCatalog({ apiBaseUrl: 'https://api.test', token: 'tok-1', fetcher: okFetcher }),
    fetchOperationalCatalog({ apiBaseUrl: 'https://api.test', token: 'tok-1', fetcher: okFetcher }),
  ]);

  assert.equal(seenUrls.length, 1);
  assert.match(seenUrls[0], /\/produtos\/catalogo$/);
  assert.equal(probeResult.ok, true);
  assert.equal(hookResult.ok, true);

  // Fallback to /produtos/ + /produtos/categorias only when /produtos/catalogo returns 404/405.
  clearOperationalCatalogCache();
  const fallbackUrls: string[] = [];
  const fallbackFetcher = (async (url: RequestInfo | URL) => {
    const target = String(url);
    fallbackUrls.push(target);
    if (target.endsWith('/produtos/catalogo')) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const fallbackResult = await fetchOperationalCatalog({
    apiBaseUrl: 'https://api.test',
    token: 'tok-2',
    fetcher: fallbackFetcher,
  });
  assert.equal(fallbackResult.ok, true);
  assert.deepEqual(fallbackUrls, [
    'https://api.test/produtos/catalogo',
    'https://api.test/produtos/',
    'https://api.test/produtos/categorias',
  ]);
  clearOperationalCatalogCache();
});

test('PostHog operational initialization provides bootstrap.distinctID when disable_persistence is enabled', () => {
  const analyticsSource = readFileSync('src/analytics/posthog.ts', 'utf8');
  assert.match(analyticsSource, /bootstrap:\s*\{\s*distinctID:\s*getOrCreateTabDistinctId\(\)\s*\}/);
  assert.match(analyticsSource, /sessionStorage\.getItem\(storageKey\)/);
});
