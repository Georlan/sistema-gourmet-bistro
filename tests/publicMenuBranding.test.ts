import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(
  new URL('../src/cardapio/CardapioPage.tsx', import.meta.url),
  'utf8',
);
const v2Source = readFileSync(
  new URL('../src/cardapio/v2/MenuV2Experience.tsx', import.meta.url),
  'utf8',
);

test('public menu keeps the restaurant logo only in the header identity', () => {
  assert.match(v2Source, /src=\{activeBrand\.logo \|\| LOCAL_LOGO_PLACEHOLDER\}/);
  assert.doesNotMatch(pageSource, /src=\{activeBrand\.logo\}/);
});

test('brand hero remains banner-first without duplicated branding overlays', () => {
  const heroStart = v2Source.indexOf('activeBrand.hasCustomBanner && showBanner ? "brand-banner-hero"');
  const heroEnd = v2Source.indexOf('className="km-store-identity"', heroStart);

  assert.ok(heroStart >= 0, 'brand banner hero should exist');
  assert.ok(heroEnd > heroStart, 'brand banner hero should close before store identity');

  const heroSource = v2Source.slice(heroStart, heroEnd);
  assert.match(heroSource, /activeBrand\.bannerImage/);
  assert.doesNotMatch(heroSource, /activeBrand\.logo/);
  assert.doesNotMatch(heroSource, /LOCAL_LOGO_PLACEHOLDER/);
  assert.doesNotMatch(heroSource, /activeBrand\.slogan/);
  assert.doesNotMatch(heroSource, /activeBrand\.address/);
  assert.doesNotMatch(heroSource, /<h1/);
});
