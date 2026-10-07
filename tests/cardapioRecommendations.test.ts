import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('recomendações usam somente produtos e disponibilidade do catálogo atual', () => {
  const recommendations = source('../src/cardapio/components/CardapioRecommendations.tsx');
  assert.match(recommendations, /brand\.products/);
  assert.match(recommendations, /product\.isAvailable !== false/);
  assert.match(recommendations, /product\.category/);
  assert.doesNotMatch(recommendations, /fetch\(|localStorage|sessionStorage|historico|history/i);
});

test('recomendações priorizam produto principal, combo e acompanhamento antes de bebidas/sobremesas', () => {
  const recommendations = source('../src/cardapio/components/CardapioRecommendations.tsx');
  assert.match(recommendations, /MAIN_CATEGORY_MATCHER/);
  assert.match(recommendations, /COMBO_MATCHER/);
  assert.match(recommendations, /UPSELL_MATCHER/);
  assert.match(recommendations, /BEBIDA_MATCHER/);
  assert.match(recommendations, /SOBREMESA_MATCHER/);
  assert.match(recommendations, /destaque/);
  assert.match(recommendations, /combo/);
  assert.match(recommendations, /upsell/);
  assert.match(recommendations, /if \(recommendations\.length === 0\) return null/);
});

test('home reutiliza cards canônicos e preços correntes do catálogo', () => {
  const recommendations = source('../src/cardapio/components/CardapioRecommendations.tsx');
  const conditions = source('../src/cardapio/components/CardapioOrderConditions.tsx');
  assert.match(recommendations, /product-card-\$\{product\.id\}/);
  assert.match(recommendations, /product\.price/);
  assert.match(recommendations, /cardapio-product-card__details-hitbox/);
  assert.match(conditions, /<CardapioRecommendations brand=\{brand\} \/>/);
});

test('buildCatalogRecommendations prioriza burger, combo e batata antes de bebidas e sobremesas', async () => {
  const { buildCatalogRecommendations } = await import('../src/cardapio/components/CardapioRecommendations.js');
  const d8Products = [
    { id: '1', name: 'Suco de Acerola', description: '', image: '', price: 10, category: 'BEBIDAS', isAvailable: true },
    { id: '2', name: 'Refrigerante Cola', description: '', image: '', price: 8, category: 'BEBIDAS', isAvailable: true },
    { id: '3', name: 'D8 Clássico', description: '', image: '', price: 34, category: 'BURGERS', isAvailable: true },
    { id: '4', name: 'Combo Clássico', description: '', image: '', price: 46, category: 'COMBOS', isAvailable: true },
    { id: '5', name: 'Batata Frita Rústica', description: '', image: '', price: 18, category: 'PORÇÕES', isAvailable: true },
    { id: '6', name: 'Brownie D8', description: '', image: '', price: 16, category: 'SOBREMESAS', isAvailable: true },
  ];

  const recs = buildCatalogRecommendations(d8Products);
  assert.equal(recs.length, 3);
  assert.equal(recs[0].kind, 'destaque');
  assert.equal(recs[0].product.name, 'D8 Clássico');
  assert.equal(recs[1].kind, 'combo');
  assert.equal(recs[1].product.name, 'Combo Clássico');
  assert.equal(recs[2].kind, 'upsell');
  assert.equal(recs[2].product.name, 'Batata Frita Rústica');
});

test('buildCatalogRecommendations recorre a bebida e sobremesa se não houver comidas suficientes', async () => {
  const { buildCatalogRecommendations } = await import('../src/cardapio/components/CardapioRecommendations.js');
  const drinksAndDessertsOnly = [
    { id: '1', name: 'Suco de Acerola', description: '', image: '', price: 10, category: 'BEBIDAS', isAvailable: true },
    { id: '2', name: 'Brownie D8', description: '', image: '', price: 16, category: 'SOBREMESAS', isAvailable: true },
  ];

  const recs = buildCatalogRecommendations(drinksAndDessertsOnly);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].kind, 'bebida');
  assert.equal(recs[1].kind, 'sobremesa');
});

