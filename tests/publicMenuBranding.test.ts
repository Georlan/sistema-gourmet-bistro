import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(
  new URL('../src/cardapio/CardapioPage.tsx', import.meta.url),
  'utf8',
);
const headerSource = readFileSync(
  new URL('../src/cardapio/components/CardapioHeader.tsx', import.meta.url),
  'utf8',
);

test('public menu keeps the restaurant logo only in the header', () => {
  assert.match(headerSource, /src=\{activeBrand\.logo\}/);
  assert.doesNotMatch(pageSource, /src=\{activeBrand\.logo\}/);
});

test('brand hero remains banner-first without duplicated branding overlays', () => {
  const heroStart = pageSource.indexOf('id="brand-banner-hero"');
  const heroEnd = pageSource.indexOf('<CardapioConditionsSummary', heroStart);

  assert.ok(heroStart >= 0, 'brand banner hero should exist');
  assert.ok(heroEnd > heroStart, 'brand banner hero should close before order conditions');

  const heroSource = pageSource.slice(heroStart, heroEnd);
  assert.match(heroSource, /activeBrand\.bannerImage/);
  assert.doesNotMatch(heroSource, /activeBrand\.logo/);
  assert.doesNotMatch(heroSource, /LOCAL_LOGO_PLACEHOLDER/);
  assert.doesNotMatch(heroSource, /activeBrand\.slogan/);
  assert.doesNotMatch(heroSource, /activeBrand\.address/);
  assert.doesNotMatch(heroSource, /<h1/);
});
