import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const source = (file: string) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const bytes = (file: string) => readFileSync(new URL('../' + file, import.meta.url));

test('approved device frames use compact WebP with originals preserved for visual audits', () => {
  const cases = [
    ['koma-notebook-graphite-shell-v2', 'src/landing/product/LaptopFrame.tsx'],
    ['koma-tablet-graphite-shell-v2', 'src/landing/product/TabletFrame.tsx'],
    ['koma-phone-graphite-shell-v2', 'src/landing/sections/HowItWorks.tsx'],
  ] as const;
  for (const [name, consumer] of cases) {
    const original = bytes('src/assets/' + name + '.png');
    const optimized = bytes('src/assets/' + name + '.webp');
    assert.equal(original.toString('ascii', 1, 4), 'PNG', name);
    assert.equal(optimized.toString('ascii', 0, 4), 'RIFF', name);
    assert.equal(optimized.toString('ascii', 8, 12), 'WEBP', name);
    assert.ok(optimized.length < original.length / 4,
      name + ': optimized asset should save at least 75% of download size');
    assert.match(source(consumer), new RegExp(name + '\\.webp'));
    assert.doesNotMatch(source(consumer), new RegExp(name + '\\.png'));
  }
});

test('public entry is separate from operational CSS and retains the real product demo styles', () => {
  const vite = source('vite.config.ts');
  const prerender = source('scripts/prerenderLanding.ts');
  const entry = source('src/landing/publicMain.tsx');
  const baseCss = source('src/landing/public-base.css');
  assert.match(vite, /publicMarketing: path\.resolve\(__dirname, 'src\/landing\/publicMain\.tsx'\)/);
  assert.match(prerender, /collectCss\('src\/landing\/publicMain\.tsx'\)/);
  assert.match(prerender, /operationalCss/);
  assert.match(prerender, /shell\.replace\(operationalScript, publicScript\)/);
  assert.match(entry, /initAnalytics\(\)/);
  assert.match(entry, /<AnalyticsProvider><LandingPage \/><\/AnalyticsProvider>/);
  assert.match(baseCss, /komaFoundation\.css/);
  assert.match(baseCss, /kdsWorkspace\.css/);
  assert.match(baseCss, /waiterOperational\.css/);
  assert.match(source('src/main.tsx'), /import "\.\/index\.css";/,
    'operational shell must keep its original full styles');
});
