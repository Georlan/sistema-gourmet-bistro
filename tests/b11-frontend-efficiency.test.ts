import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  fetchOnlineOrdersControl,
  invalidateOnlineOrdersControlCache,
} from '../src/components/caixa/online-menu/onlineOrdersControlClient';

const readRepoFile = (relPath: string) =>
  readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');

test('invalidateOnlineOrdersControlCache preserves in-flight deduplication', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let resolveFetch: ((value: Response) => void) | null = null;

  globalThis.fetch = (() => {
    fetchCount += 1;
    return new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
  }) as typeof fetch;

  try {
    invalidateOnlineOrdersControlCache();
    const first = fetchOnlineOrdersControl('https://api.test', 'Bearer tok-b11');
    invalidateOnlineOrdersControlCache();
    const second = fetchOnlineOrdersControl('https://api.test', 'Bearer tok-b11');

    assert.equal(fetchCount, 1);
    assert.strictEqual(first, second);

    resolveFetch?.(
      new Response(JSON.stringify({ paused: false, level: 'normal' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateOnlineOrdersControlCache();
  }
});

test('frontend efficiency guards remain active across realtime, headers, fonts and chunking', () => {
  const realtime = readRepoFile('src/components/caixa/realtime/useCashierRealtime.ts');
  assert.match(realtime, /needsCouriers\s*&&\s*motoboysLoadState\s*===\s*'idle'/);

  const cashierOrders = readRepoFile('src/components/caixa/orders/useCashierOrders.ts');
  assert.match(cashierOrders, /useState<'idle'\s*\|\s*'loading'\s*\|\s*'loaded'\s*\|\s*'error'>\('idle'\)/);

  const drawer = readRepoFile('src/cardapio/components/CardapioOrdersDrawer.tsx');
  assert.match(drawer, /let\s+sawInitialConnected\s*=\s*false/);

  const chat = readRepoFile('src/cardapio/components/CardapioOrderChatPanel.tsx');
  assert.match(chat, /let\s+sawInitialConnected\s*=\s*false/);

  const headers = readRepoFile('public/_headers');
  assert.match(headers, /\/brand\/\*[\s\S]*Cache-Control:\s*public,\s*max-age=86400/);
  assert.match(headers, /\/cardapio\/\*[\s\S]*Cache-Control:\s*no-store/);
  assert.match(headers, /\/acompanhar\/\*[\s\S]*Cache-Control:\s*no-store/);

  const indexCss = readRepoFile('src/index.css');
  assert.doesNotMatch(indexCss, /@import\s+url\(['"]https:\/\/fonts\.googleapis\.com/);
  assert.doesNotMatch(indexCss, /^\.cashier-shell\b/m);

  const appTsx = readRepoFile('src/App.tsx');
  assert.match(appTsx, /operationalWorkspace\.css/);

  const caixaPanel = readRepoFile('src/components/CaixaPanel.tsx');
  assert.match(caixaPanel, /operationalWorkspace\.css/);

  const indexHtml = readRepoFile('index.html');
  assert.match(indexHtml, /rel="preconnect"\s+href="https:\/\/fonts\.googleapis\.com"/);

  const viteCfg = readRepoFile('vite.config.ts');
  assert.match(viteCfg, /vendor-icons/);
  assert.match(viteCfg, /vendor-react/);

  const promoSettings = readRepoFile('src/components/cardapio/PromotionsSettings.tsx');
  assert.match(promoSettings, /prepareImageUpload\(file,\s*'products'\)/);
});
