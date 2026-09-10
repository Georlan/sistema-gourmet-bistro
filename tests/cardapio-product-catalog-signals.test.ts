import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getProductCatalogSignalLabel, isCampaignCategory } from '../src/cardapio/cardapioMerchandising';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('classificador promocional deriva apenas sinais explícitos da categoria do catálogo', () => {
  assert.equal(getProductCatalogSignalLabel('Ofertas do dia'), 'Oferta');
  assert.equal(getProductCatalogSignalLabel('Promoção'), 'Promoção');
  assert.equal(getProductCatalogSignalLabel('Campanha de inverno'), 'Campanha');
  assert.equal(getProductCatalogSignalLabel('Especiais'), 'Especial');
  assert.equal(getProductCatalogSignalLabel('Destaques'), 'Destaque');
  assert.equal(getProductCatalogSignalLabel('Hambúrgueres'), null);
  assert.equal(getProductCatalogSignalLabel(undefined), null);
});

test('home e cards compartilham o mesmo classificador de campanha', () => {
  for (const category of ['Destaques', 'Ofertas', 'Promoção', 'Campanha', 'Especial']) {
    assert.equal(isCampaignCategory(category), true);
  }
  assert.equal(isCampaignCategory('Bebidas'), false);

  const highlights = source('../src/cardapio/components/CardapioHighlights.tsx');
  const card = source('../src/cardapio/components/CardapioProductCard.tsx');
  assert.match(highlights, /isCampaignCategory\(product\.category\)/);
  assert.match(card, /getProductCatalogSignalLabel\(product\.category\)/);
});

test('indicador no produto não inventa desconto nem segunda fonte comercial', () => {
  const card = source('../src/cardapio/components/CardapioProductCard.tsx');
  const merchandising = source('../src/cardapio/cardapioMerchandising.ts');

  assert.match(card, /\{catalogSignal\}/);
  assert.match(card, /Sinal publicado na categoria do catálogo/);
  assert.doesNotMatch(card, /fetch\(|localStorage|sessionStorage|pre[cç]o antigo|desconto|cashback|pontos/i);
  assert.doesNotMatch(merchandising, /price|pre[cç]o|percent|%|fetch\(|storage/i);
});
