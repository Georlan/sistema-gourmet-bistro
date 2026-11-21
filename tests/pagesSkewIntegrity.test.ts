import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Cloudflare Pages asset route preserves real assets and only converts fallback HTML to 404', () => {
  const functionPath = new URL('../functions/assets/[[catchall]].ts', import.meta.url);
  assert.ok(existsSync(functionPath), 'functions/assets/[[catchall]].ts must exist');

  const content = readFileSync(functionPath, 'utf8');
  assert.match(content, /context\.next\(\)/);
  assert.match(content, /contentType\.includes\(['"]text\/html['"]\)/);
  assert.match(content, /status:\s*404/);
  assert.match(content, /['"]Cache-Control['"]:\s*['"]no-store/);
  assert.match(content, /return response/);
});

test('build metadata is uncached and emitted by Vite', () => {
  const headers = source('../public/_headers');
  assert.match(headers, /\/meta\.json[\s\S]*Cache-Control: no-store, no-cache, must-revalidate, max-age=0/);
  assert.match(headers, /\/build-info\.json[\s\S]*Cache-Control: no-store, no-cache, must-revalidate, max-age=0/);

  const viteConfig = source('../vite.config.ts');
  assert.match(viteConfig, /koma-build-metadata/);
  assert.match(viteConfig, /koma-build-sha/);
  assert.match(viteConfig, /koma-build-time/);
  assert.match(viteConfig, /fileName:\s*['"]meta\.json['"]/);
  assert.match(viteConfig, /VITE_BUILD_TIME/);
});

test('Vite preloading shares one safe recovery policy with both error boundaries', () => {
  const main = source('../src/main.tsx');
  const handler = main.slice(main.indexOf('window.addEventListener("vite:preloadError"'), main.indexOf('// O service worker'));
  assert.match(main, /installChunkRecovery\(\)/);
  assert.match(handler, /tryAutoRecoverChunkSkew/);
  assert.doesNotMatch(handler, /event\.preventDefault\(\)/);
  assert.match(main, /__KOMA_BUILD__/);

  const recovery = source('../src/components/auth/AppRecoveryBoundary.tsx');
  assert.match(recovery, /isChunkLoadError/);
  assert.match(recovery, /tryAutoRecoverChunkSkew/);
  assert.match(recovery, /backgroundColor:\s*['"]#090a0f['"]/);
  assert.match(recovery, /backgroundColor:\s*['"]#08caa3['"]/);

  const feature = source('../src/components/shared/FeatureErrorBoundary.tsx');
  assert.match(feature, /tryAutoRecoverChunkSkew/);
  assert.match(feature, /reloadFreshAppEntry/);
  assert.match(feature, /window\.confirm/);
  assert.doesNotMatch(feature, /window\.location\.reload/);
});

test('production smoke treats missing asset fallback as a hard failure and waits for deployed SHA', () => {
  const smoke = source('../scripts/production-smoke.mjs');
  assert.match(smoke, /waitForFrontendDeployment/);
  assert.match(smoke, /KOMA_EXPECTED_FRONTEND_SHA/);
  assert.match(smoke, /__koma_skew_test_nonexistent__/);
  assert.match(smoke, /fakeRes\.status !== 404/);
  assert.match(smoke, /fakeType\.includes\(['"]text\/html['"]\)/);
  assert.match(smoke, /fakeCache\.includes\(['"]no-store['"]\)/);

  const workflow = source('../.github/workflows/production-smoke.yml');
  assert.match(workflow, /push:[\s\S]*branches:[\s\S]*- main/);
  assert.match(workflow, /KOMA_EXPECTED_FRONTEND_SHA/);
});

test('public menu bundles checkout, promotion wizard, auth, and order tracking drawers statically without post-interaction lazy chunk boundaries', () => {
  const cardapioPage = source('../src/cardapio/CardapioPage.tsx');
  assert.doesNotMatch(cardapioPage, /React\.lazy\(/);
  assert.match(cardapioPage, /import CardapioDigital from ["']\.\/components\/CardapioDigital["']/);
  assert.match(cardapioPage, /import CardapioPromotionWizard from ["']\.\/components\/CardapioPromotionWizard["']/);
  assert.match(cardapioPage, /import CardapioOrdersDrawer from ["']\.\/components\/CardapioOrdersDrawer["']/);
  assert.match(cardapioPage, /import CardapioAuthModal from ["']\.\/components\/CardapioAuthModal["']/);
  assert.match(cardapioPage, /import CardapioBenefitsDrawer from ["']\.\/components\/CardapioBenefitsDrawer["']/);
  assert.match(cardapioPage, /import CardapioStoreInfoDrawer from ["']\.\/components\/CardapioStoreInfoDrawer["']/);
  assert.match(cardapioPage, /import CardapioUserProfileModal from ["']\.\/components\/CardapioUserProfileModal["']/);
});

test('operational views prewarm deferred module chunks shortly after mount and isolate lazy modals behind FeatureErrorBoundary', () => {
  const deferredSection = source('../src/components/caixa/loading/DeferredCashierSection.tsx');
  assert.match(deferredSection, /const warmDelayMs = label === ['"]Novo pedido['"] \? 120 : 900/);
  assert.match(deferredSection, /window\.setTimeout\(warmLoad, warmDelayMs\)/);
  assert.match(deferredSection, /<FeatureErrorBoundary label=\{label\}>/);

  const pdvView = source('../src/components/caixa/pdv/CashierPdvView.tsx');
  assert.match(pdvView, /void loadCardapioPromotionWizard\(\)\.catch\(\(\) => null\)/);
  assert.match(pdvView, /<FeatureErrorBoundary label="Montagem de oferta">/);

  const waiterHistory = source('../src/components/app/WaiterHistoryHost.tsx');
  assert.match(waiterHistory, /void loadWaiterHistoryPanel\(\)\.catch\(\(\) => null\)/);
  assert.match(waiterHistory, /<FeatureErrorBoundary label="Histórico de lançamentos">/);

  const unifiedEntry = source('../src/components/auth/UnifiedOperationalEntry.tsx');
  assert.match(unifiedEntry, /void loadOperationalApp\(\)\.catch\(\(\) => null\)/);

  const app = source('../src/App.tsx');
  assert.match(app, /void loadMemoizedCaixaPanel\(\)\.catch\(\(\) => null\)/);
  assert.match(app, /void loadAttendantQuickOrderPanel\(\)\.catch\(\(\) => null\)/);
});
