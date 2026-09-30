import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Cloudflare Pages asset catchall function exists and returns 404 with no-store', () => {
  const functionPath = new URL('../functions/assets/[[catchall]].ts', import.meta.url);
  assert.ok(existsSync(functionPath), 'functions/assets/[[catchall]].ts must exist');

  const content = readFileSync(functionPath, 'utf8');
  assert.match(content, /export\s+async\s+function\s+onRequest/);
  assert.match(content, /status:\s*404/);
  assert.match(content, /['"]Content-Type['"]:\s*['"]text\/plain/);
  assert.match(content, /['"]Cache-Control['"]:\s*['"]no-store/);
  assert.doesNotMatch(content, /['"]text\/html['"]/);
});

test('public/_headers ensures cache disabling for meta.json and SPA entry routes', () => {
  const headers = source('../public/_headers');
  assert.match(headers, /\/meta\.json[\s\S]*Cache-Control: no-store, no-cache, must-revalidate, max-age=0/);
  assert.match(headers, /\/build-info\.json[\s\S]*Cache-Control: no-store, no-cache, must-revalidate, max-age=0/);
  assert.match(headers, /\/assets\/\*[\s\S]*Cache-Control: public, max-age=31536000, immutable/);
});

test('vite.config.ts exposes build metadata and generates meta.json', () => {
  const viteConfig = source('../vite.config.ts');
  assert.match(viteConfig, /koma-build-metadata/);
  assert.match(viteConfig, /<meta name="koma-build-sha"/);
  assert.match(viteConfig, /<meta name="koma-build-time"/);
  assert.match(viteConfig, /fileName:\s*['"]meta\.json['"]/);
  assert.match(viteConfig, /fileName:\s*['"]build-info\.json['"]/);
  assert.match(viteConfig, /VITE_BUILD_TIME/);
});

test('main.tsx registers vite:preloadError listener for auto-recovery from chunk skew', () => {
  const main = source('../src/main.tsx');
  assert.match(main, /window\.addEventListener\(["']vite:preloadError["']/);
  assert.match(main, /koma_chunk_reload_attempt/);
  assert.match(main, /__koma_refresh/);
  assert.match(main, /__KOMA_BUILD__/);
});

test('AppRecoveryBoundary provides defensive inline styles and auto-recovers chunk errors', () => {
  const recovery = source('../src/components/auth/AppRecoveryBoundary.tsx');
  assert.match(recovery, /isChunkLoadError/);
  assert.match(recovery, /tryAutoRecoverChunkSkew/);
  assert.match(recovery, /AUTO_RELOAD_INTERVAL_MS/);
  assert.match(recovery, /style=\{\{/);
  assert.match(recovery, /backgroundColor:\s*['"]#090a0f['"]/);
  assert.match(recovery, /backgroundColor:\s*['"]#08caa3['"]/);
  assert.match(recovery, /__koma_refresh/);
});

test('production-smoke.mjs extracts and verifies hashed assets integrity', () => {
  const smoke = source('../scripts/production-smoke.mjs');
  assert.match(smoke, /scriptRegex/);
  assert.match(smoke, /linkCssRegex/);
  assert.match(smoke, /__koma_skew_test_nonexistent__/);
  assert.match(smoke, /text\/html/);
});
