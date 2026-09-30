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

test('Vite chunk preload recovery prevents throw only when a reload is actually scheduled', () => {
  const main = source('../src/main.tsx');
  assert.match(main, /window\.addEventListener\(["']vite:preloadError["']/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /now - lastAttempt > 15000/);
  assert.match(main, /__koma_refresh/);
  assert.match(main, /__KOMA_BUILD__/);
});

test('recovery boundary remains usable without the main stylesheet', () => {
  const recovery = source('../src/components/auth/AppRecoveryBoundary.tsx');
  assert.match(recovery, /isChunkLoadError/);
  assert.match(recovery, /dynamically imported module/);
  assert.doesNotMatch(recovery, /message\.includes\(['"]failed to fetch['"]\)/);
  assert.match(recovery, /tryAutoRecoverChunkSkew/);
  assert.match(recovery, /backgroundColor:\s*['"]#090a0f['"]/);
  assert.match(recovery, /backgroundColor:\s*['"]#08caa3['"]/);
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
