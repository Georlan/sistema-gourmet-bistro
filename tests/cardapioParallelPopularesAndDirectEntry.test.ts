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
