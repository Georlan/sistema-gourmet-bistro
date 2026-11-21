import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getSellableProducts, isProductSellable } from '../src/catalog/catalog';
import {
  CATALOG_REFRESH_COALESCE_WINDOW_MS,
  createCatalogRefreshCoalescer,
} from '../src/components/app/data/useOperationalCatalog';
import {
  CARDAPIO_DIGITAL_CONFIG_TTL_MS,
  fetchCardapioDigitalConfig,
  invalidateCardapioDigitalConfigCache,
  updateCardapioDigitalConfigCache,
} from '../src/components/caixa/online-menu/cardapioDigitalConfigClient';
import { pdvCartItemUnitPrice, type PdvCartItem } from '../src/components/caixa/pdv/useCashierPdv';
import { resolveWaiterProductPrice } from '../src/components/MenuPanel';
import type { Product } from '../src/types';

test('isProductSellable and getSellableProducts exclude somente_promocao products while preserving menu rules', () => {
  const regular = { id: 'p1', ativo: true, cardapio_id: 'almoco', somente_promocao: false };
  const promoOnly = { id: 'p2', ativo: true, cardapio_id: 'almoco', somente_promocao: true };
  const paused = { id: 'p3', ativo: false, cardapio_id: 'almoco', somente_promocao: false };
  const wrongMenu = { id: 'p4', ativo: true, cardapio_id: 'jantar', somente_promocao: false };
  const legacyNoFlag = { id: 'p5', ativo: true, cardapio_id: null };

  assert.equal(isProductSellable(regular, 'almoco', ['almoco']), true);
  assert.equal(isProductSellable(promoOnly, 'almoco', ['almoco']), false);
  assert.equal(isProductSellable(promoOnly, null, []), false);
  assert.equal(isProductSellable(paused, 'almoco', ['almoco']), false);
  assert.equal(isProductSellable(wrongMenu, 'almoco', ['almoco']), false);
  assert.equal(isProductSellable(legacyNoFlag, null, []), true);

  const sellable = getSellableProducts([regular, promoOnly, paused, wrongMenu], 'almoco', ['almoco']);
  assert.deepEqual(
    sellable.map((item) => item.id),
    ['p1'],
  );
});

test('PDV and Waiter resolve identical effective promotional prices and include modifiers', () => {
  const promoProduct: Product = {
    id: 'burger-1',
    nome: 'Burger Especial',
    categoria: 'Lanches',
    preco: 35,
    preco_promocional: 27.5,
    descricao: 'Com queijo',
    imagem: '',
  };
  const regularProduct: Product = {
    id: 'soda-1',
    nome: 'Refrigerante',
    categoria: 'Bebidas',
    preco: 8,
    preco_promocional: null,
    descricao: '',
    imagem: '',
  };
  const invalidPromoProduct: Product = {
    id: 'pizza-1',
    nome: 'Pizza Grande',
    categoria: 'Pizzas',
    preco: 50,
    preco_promocional: 55,
    descricao: '',
    imagem: '',
  };

  const pdvPromoItem: PdvCartItem = {
    product: promoProduct,
    quantity: 2,
    obs: '',
    client: 'Balcão',
    modifierIds: ['bacon'],
    modifiers: [{ id: 'bacon', nome: 'Bacon extra', preco: 4.5 }],
  };
  const pdvRegularItem: PdvCartItem = {
    product: regularProduct,
    quantity: 1,
    obs: '',
    client: 'Balcão',
  };
  const pdvInvalidPromoItem: PdvCartItem = {
    product: invalidPromoProduct,
    quantity: 1,
    obs: '',
    client: 'Balcão',
  };

  assert.equal(pdvCartItemUnitPrice(pdvPromoItem), 32); // 27.5 + 4.5
  assert.equal(pdvCartItemUnitPrice(pdvRegularItem), 8);
  assert.equal(pdvCartItemUnitPrice(pdvInvalidPromoItem), 50);

  const waiterPromo = resolveWaiterProductPrice(promoProduct);
  assert.equal(waiterPromo.hasDiscount, true);
  assert.equal(waiterPromo.effectivePrice, 27.5);
  assert.equal(waiterPromo.originalPrice, 35);

  const waiterRegular = resolveWaiterProductPrice(regularProduct);
  assert.equal(waiterRegular.hasDiscount, false);
  assert.equal(waiterRegular.effectivePrice, 8);

  const waiterInvalidPromo = resolveWaiterProductPrice(invalidPromoProduct);
  assert.equal(waiterInvalidPromo.hasDiscount, false);
  assert.equal(waiterInvalidPromo.effectivePrice, 50);
});

test('cardapioDigitalConfigClient unifies authenticated cache key, uses 30s TTL, and supports in-place cache updates', async () => {
  invalidateCardapioDigitalConfigCache();
  assert.equal(CARDAPIO_DIGITAL_CONFIG_TTL_MS, 30_000);

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (url: RequestInfo | URL) => {
    requestedUrls.push(String(url));
    return new Response(
      JSON.stringify({ id: 7, slug: 'bistro-central', status_override: 'Automático' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    // Calling with restaurantId (e.g. usePublicMenuSlug) and without restaurantId (settings panels)
    // must hit the exact same URL and share one cache entry when authenticated.
    const [withRestaurantId, withoutRestaurantId] = await Promise.all([
      fetchCardapioDigitalConfig<{ id: number; slug: string; status_override: string }>(
        'https://api.test',
        'Bearer tenant-7',
        { restaurantId: 7 },
      ),
      fetchCardapioDigitalConfig<{ id: number; slug: string; status_override: string }>(
        'https://api.test',
        'Bearer tenant-7',
      ),
    ]);

    assert.equal(requestedUrls.length, 1);
    assert.equal(requestedUrls[0], 'https://api.test/api/cardapio-digital/config?restaurante_id=7');
    assert.equal(withRestaurantId.slug, 'bistro-central');
    assert.equal(withoutRestaurantId.slug, 'bistro-central');

    // Explicit 3-arg in-place update avoids another GET
    updateCardapioDigitalConfigCache('https://api.test', 'Bearer tenant-7', {
      status_override: 'Fechado',
    });
    const afterScopedUpdate = await fetchCardapioDigitalConfig<{
      id: number;
      slug: string;
      status_override: string;
    }>('https://api.test', 'Bearer tenant-7');
    assert.equal(requestedUrls.length, 1);
    assert.equal(afterScopedUpdate.slug, 'bistro-central');
    assert.equal(afterScopedUpdate.status_override, 'Fechado');

    // 1-arg in-place update also refreshes the active scope without another GET
    updateCardapioDigitalConfigCache({ status_override: 'Aberto' });
    const afterSingleArgUpdate = await fetchCardapioDigitalConfig<{
      id: number;
      slug: string;
      status_override: string;
    }>('https://api.test', 'Bearer tenant-7');
    assert.equal(requestedUrls.length, 1);
    assert.equal(afterSingleArgUpdate.status_override, 'Aberto');

    // Invalidation forces next read to hit network
    invalidateCardapioDigitalConfigCache();
    await fetchCardapioDigitalConfig('https://api.test', 'Bearer tenant-7');
    assert.equal(requestedUrls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCardapioDigitalConfigCache();
  }
});

test('useOperationalCatalog coalesces rapid WS/background refreshes within 500ms without dropping manual mutations', async () => {
  assert.equal(CATALOG_REFRESH_COALESCE_WINDOW_MS, 500);

  let fakeNow = 1000;
  const coalescer = createCatalogRefreshCoalescer(500, () => fakeNow);
  let fetchCount = 0;

  let resolveFirst!: (value: boolean) => void;
  const firstRun = coalescer.run('caixa:tok-1', () => {
    fetchCount += 1;
    return new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
  });

  // While first fetch is in flight, WS/background refresh fires -> coalesced into 1 GET
  const concurrentWsRun = coalescer.run(
    'caixa:tok-1',
    async () => {
      fetchCount += 1;
      return true;
    },
    { coalesceOnly: true },
  );
  assert.equal(fetchCount, 1);

  fakeNow = 1120;
  resolveFirst(true);
  await Promise.all([firstRun, concurrentWsRun]);
  assert.equal(fetchCount, 1);

  // Delayed WS/background event 200ms after completion (< 500ms) -> skipped, still 1 GET
  fakeNow = 1320;
  await coalescer.run(
    'caixa:tok-1',
    async () => {
      fetchCount += 1;
      return true;
    },
    { coalesceOnly: true },
  );
  assert.equal(fetchCount, 1);

  // Explicit manual mutation (e.g. POST /produtos/ right after POST /produtos/categorias)
  // within 500ms must NEVER be dropped!
  fakeNow = 1350;
  await coalescer.run('caixa:tok-1', async () => {
    fetchCount += 1;
    return true;
  });
  assert.equal(fetchCount, 2);

  // WS/background refresh after >= 500ms -> executes fresh GET
  fakeNow = 1900;
  await coalescer.run(
    'caixa:tok-1',
    async () => {
      fetchCount += 1;
      return true;
    },
    { coalesceOnly: true },
  );
  assert.equal(fetchCount, 3);

  // Scope switch (different tenant/session) is never suppressed by previous scope
  fakeNow = 1950;
  await coalescer.run(
    'caixa:tok-2',
    async () => {
      fetchCount += 1;
      return true;
    },
    { coalesceOnly: true },
  );
  assert.equal(fetchCount, 4);

  // Failed fetch does not suppress immediate retry
  fakeNow = 2500;
  await coalescer.run(
    'caixa:tok-2',
    async () => {
      fetchCount += 1;
      return false;
    },
    { coalesceOnly: true },
  );
  fakeNow = 2550;
  await coalescer.run(
    'caixa:tok-2',
    async () => {
      fetchCount += 1;
      return true;
    },
    { coalesceOnly: true },
  );
  assert.equal(fetchCount, 6);
});

test('OnlineMenuDeliverySettings uses shared caixaConfigClient and removes micro-typography', () => {
  const source = readFileSync(
    new URL('../src/components/caixa/online-menu/OnlineMenuDeliverySettings.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /fetchCaixaConfiguracoes/);
  assert.match(source, /invalidateCaixaConfiguracoesCache/);
  assert.doesNotMatch(source, /text-\[9px\]|text-\[10px\]/);
});
