import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  clearPopularProductsCache,
  fetchPopularProducts,
  registerPopularProductsAlias,
} from '../src/cardapio/popularProductsClient';

test('fetchPopularProducts coalesces slug and aliased restaurantId requests into one fetch', async () => {
  clearPopularProductsCache();
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls += 1;
    assert.match(String(url), /\/api\/cardapio-digital\/populares\?slug=d8-burger/);
    return new Response(JSON.stringify({ produtos: [{ produto_id: 10 }, { produto_id: 22 }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const firstPromise = fetchPopularProducts({ apiBaseUrl: 'https://api.test', slug: 'd8-burger' });
    registerPopularProductsAlias('https://api.test', 42, 'd8-burger');
    const secondPromise = fetchPopularProducts({ apiBaseUrl: 'https://api.test', restaurantId: 42 });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.equal(calls, 1);
    assert.deepEqual(first, ['10', '22']);
    assert.deepEqual(second, ['10', '22']);
  } finally {
    globalThis.fetch = originalFetch;
    clearPopularProductsCache();
  }
});

test('fetchPopularProducts promotes restaurantId in-flight and cached entries to aliased slug', async () => {
  clearPopularProductsCache();
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls += 1;
    assert.match(String(url), /\/api\/cardapio-digital\/populares\?restaurante_id=2$/);
    return new Response(JSON.stringify({ produtos: [{ produto_id: 7 }, { produto_id: 9 }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    // 1. In-flight promotion: restaurantId started before alias was registered, then slug requested while in-flight
    const firstPromise = fetchPopularProducts({ apiBaseUrl: 'https://api.test', restaurantId: 2 });
    registerPopularProductsAlias('https://api.test', 2, 'bella-italia');
    const secondPromise = fetchPopularProducts({
      apiBaseUrl: 'https://api.test',
      slug: 'bella-italia',
      restaurantId: 2,
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.equal(calls, 1);
    assert.deepEqual(first, ['7', '9']);
    assert.deepEqual(second, ['7', '9']);

    // 2. Cached result promotion when alias is registered after initial request already resolved
    clearPopularProductsCache();
    calls = 0;
    const preResolved = await fetchPopularProducts({ apiBaseUrl: 'https://api.test', restaurantId: 2 });
    registerPopularProductsAlias('https://api.test', 2, 'bella-italia');
    const postAlias = await fetchPopularProducts({ apiBaseUrl: 'https://api.test', slug: 'bella-italia' });
    assert.equal(calls, 1);
    assert.deepEqual(preResolved, ['7', '9']);
    assert.deepEqual(postAlias, ['7', '9']);
  } finally {
    globalThis.fetch = originalFetch;
    clearPopularProductsCache();
  }
});

test('main.tsx routes public menu directly to CardapioPage and lazy-loads operational wrappers', () => {
  const mainTsx = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  assert.match(mainTsx, /isPublicMenuRoute\(\).*import\("\.\/cardapio\/CardapioPage"\)/s);
  assert.match(mainTsx, /const TenantSuspensionBoundary = React\.lazy/);
  assert.match(mainTsx, /const CustomerSupportWidget = React\.lazy/);
});

test('CardapioPage starts popular products fetch before awaiting public menu response', () => {
  const cardapioPage = fs.readFileSync(path.resolve('src/cardapio/CardapioPage.tsx'), 'utf8');
  const popularIndex = cardapioPage.indexOf('fetchPopularProducts({');
  const publicIndex = cardapioPage.indexOf('fetchPublicMenu({');
  assert.ok(popularIndex > 0 && publicIndex > popularIndex);
});
