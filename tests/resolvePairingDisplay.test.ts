import test from 'node:test';
import assert from 'node:assert/strict';
import type { Product } from '../src/cardapio/CardapioTypes';
import { isGroupedProduct } from '../src/cardapio/catalogGrouping';
import { resolveCatalogDisplayProduct, resolvePairingDisplay } from '../src/cardapio/resolvePairingDisplay';

function product(id: string, name: string, category: string, price: number): Product {
  return { id, name, category, price, description: '', image: '', isAvailable: true };
}

test('batatas tradicionais sugeridas abrem o seletor do mesmo card do catálogo', () => {
  const catalog = [
    product('p', 'Batata Frita Pequena (200 g)', 'Batatas Fritas', 12),
    product('m', 'Batata Frita Média (300 g)', 'Batatas Fritas', 15),
    product('g', 'Batata Frita Grande (400 g)', 'Batatas Fritas', 18),
    product('esp', 'Batata Frita Especial (300 g)', 'Batatas Fritas', 24),
  ];
  const result = resolvePairingDisplay(catalog, [catalog[0], catalog[1], catalog[3]], '1', 4);
  assert.deepEqual(result.map(item => item.id), ['family-batata-tradicional', 'esp']);
  assert.ok(isGroupedProduct(result[0]));
  assert.equal(result[0].requiresExplicitVariantSelection, true);
  assert.equal(resolveCatalogDisplayProduct(catalog, catalog[2], '1').id, 'family-batata-tradicional');
  assert.equal(resolveCatalogDisplayProduct(catalog, catalog[3], '1').id, 'esp');
});

test('batata especial mantém somente sua escolha real de bacon ou calabresa', () => {
  const special: Product = {
    ...product('special', 'Batata Frita Especial (300 g)', 'Batatas Fritas', 24),
    modifierGroups: [{
      id: 'acomp', name: 'Escolha o acompanhamento', minSelection: 1, maxSelection: 1,
      type: 'obrigatorio',
      options: [
        { id: 'bacon', name: 'Bacon', extraPrice: 0, active: true },
        { id: 'calabresa', name: 'Calabresa', extraPrice: 0, active: true },
      ],
    }],
  };
  const result = resolvePairingDisplay([special], [special], '1');
  assert.equal(result[0].id, special.id);
  assert.equal(isGroupedProduct(result[0]), false);
  assert.deepEqual(result[0].modifierGroups?.[0].options.map(o => o.name), ['Bacon', 'Calabresa']);
});

test('quando catálogo usa família, sugestão abre o mesmo produto agrupado', () => {
  const catalog = [
    product('suco-manga', 'Suco de Manga', 'Vitaminas e Sucos', 5),
    product('suco-acerola', 'Suco de Acerola', 'Vitaminas e Sucos', 5),
    product('batata-p', 'Batata Frita Pequena (200 g)', 'Batatas Fritas', 12),
  ];
  const result = resolvePairingDisplay(catalog, [catalog[0], catalog[1], catalog[2]], '1', 4);
  assert.equal(result.length, 2);
  assert.ok(isGroupedProduct(result[0]));
  assert.equal(result[0].id, 'family-sucos-300ml');
  assert.equal(result[1].id, 'batata-p');
  assert.equal(isGroupedProduct(result[1]), false);
});

test('pastéis sugeridos e em destaque usam o seletor do tamanho correto', () => {
  const catalog = [
    product('m-sol', 'Pastel Médio de Carne de Sol', 'Pastelões e Pastel Médio', 7),
    product('m-frango', 'Pastel Médio de Frango', 'Pastelões e Pastel Médio', 7),
    product('g-sol', 'Pastelão de Carne de Sol', 'Pastelões e Pastel Médio', 17),
    product('g-frango', 'Pastelão de Frango', 'Pastelões e Pastel Médio', 16),
  ];
  assert.equal(resolveCatalogDisplayProduct(catalog, catalog[0], '1').id, 'family-pastel-medio');
  assert.equal(resolveCatalogDisplayProduct(catalog, catalog[3], '1').id, 'family-pastelao');
  assert.deepEqual(resolvePairingDisplay(catalog, [catalog[0], catalog[2], catalog[3]], '1').map(p => p.id),
    ['family-pastel-medio', 'family-pastelao']);
});

test('sem agrupamento, recomendação de outro restaurante continua individual', () => {
  const catalog = [
    product('a', 'Suco de Manga', 'Vitaminas e Sucos', 5),
    product('b', 'Suco de Acerola', 'Vitaminas e Sucos', 5),
  ];
  assert.deepEqual(resolvePairingDisplay(catalog, catalog, '2').map(p => p.id), ['a', 'b']);
});


test('famílias nativas permanecem um único card nas recomendações sem perder SKU ou preço', () => {
  const a = { ...product('b200', 'Batata Tradicional 200g', 'Batatas Fritas', 12),
    familia_id: 'f-batatas', familia_nome: 'Batata Tradicional', variacao_rotulo: '200 g', familia_eixo: 'tamanho' as const };
  const b = { ...product('b400', 'Batata Tradicional 400g', 'Batatas Fritas', 18),
    familia_id: 'f-batatas', familia_nome: 'Batata Tradicional', variacao_rotulo: '400 g', familia_eixo: 'tamanho' as const };
  const third = product('agua', 'Água mineral', 'Bebidas', 4);
  const items = resolvePairingDisplay([a, b, third], [b, a, third], '6', 3);
  assert.deepEqual(items.map(p => p.id), ['family-f-batatas', 'agua']);
  assert.ok(isGroupedProduct(items[0]));
  if (!isGroupedProduct(items[0])) return;
  assert.equal(items[0].requiresExplicitVariantSelection, true);
  assert.equal(items[0].price, 12);
  assert.equal(items[0].hasVariablePrice, true);
  assert.deepEqual(items[0].variants.map(v => [v.id, v.price, v.label, v.product.id]), [
    ['b200', 12, '200 g', 'b200'],
    ['b400', 18, '400 g', 'b400'],
  ]);
  assert.equal(resolveCatalogDisplayProduct([a, b, third], b, '6').id, items[0].id);
});
