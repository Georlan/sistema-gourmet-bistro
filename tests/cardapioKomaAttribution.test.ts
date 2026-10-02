import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildKomaAttributionUrl } from '../src/cardapio/komaAttribution';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('attribution links point to the public KÔMA landing page with referral UTM data', () => {
  const footer = new URL(buildKomaAttributionUrl('menu_footer', 42));
  assert.equal(footer.origin, 'https://komafood.com.br');
  assert.equal(footer.pathname, '/');
  assert.equal(footer.searchParams.get('utm_source'), 'cardapio_digital');
  assert.equal(footer.searchParams.get('utm_medium'), 'powered_by');
  assert.equal(footer.searchParams.get('utm_campaign'), 'restaurant_referral');
  assert.equal(footer.searchParams.get('utm_content'), 'menu_footer');
  assert.equal(footer.searchParams.get('utm_term'), 'restaurant_42');

  const storeInfo = new URL(buildKomaAttributionUrl('store_info', 'quentinha-caseira'));
  assert.equal(storeInfo.searchParams.get('utm_content'), 'store_info');
  assert.equal(storeInfo.searchParams.get('utm_term'), 'restaurant_quentinha-caseira');
});

test('public menu footer exposes a subtle KÔMA lead entry without replacing restaurant ownership', () => {
  const page = source('../src/cardapio/CardapioPage.tsx');
  assert.match(page, /id="koma-powered-by-footer"/);
  assert.match(page, /buildKomaAttributionUrl\("menu_footer", activeBrand\.id\)/);
  assert.match(page, /Cardápio digital por <strong[^>]*>KÔMA<\/strong>/);
  assert.match(page, /target="_blank"/);
  assert.match(page, /Preços e disponibilidade atualizados pelo restaurante\./);
});

test('store information drawer reuses the same KÔMA attribution funnel', () => {
  const drawer = source('../src/cardapio/components/CardapioStoreInfoDrawer.tsx');
  assert.match(drawer, /id="store-info-koma-attribution"/);
  assert.match(drawer, /buildKomaAttributionUrl\("store_info", brand\.id\)/);
  assert.match(drawer, /Cardápio digital por <strong[^>]*>KÔMA<\/strong>/);
  assert.match(drawer, /rel="noopener noreferrer"/);
});
