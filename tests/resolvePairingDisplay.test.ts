import test from 'node:test';
import assert from 'node:assert/strict';
import type { Product } from '../src/cardapio/CardapioTypes';
import { isGroupedProduct } from '../src/cardapio/catalogGrouping';
import { resolveCatalogDisplayProduct, resolvePairingDisplay } from '../src/cardapio/resolvePairingDisplay';

function product(id: string, name: string, category: string, price: number): Product {
  return { id, name, category, price, description: '', image: '', isAvailable: true };
}
function family(p: Product, id: string, name: string, axis: 'tamanho' | 'sabor', label: string): Product {
  return {...p, familia_id: id, familia_nome: name, familia_eixo: axis, variacao_rotulo: label};
}

test('batatas tradicionais sugeridas abrem o mesmo seletor da família persistida no catálogo', () => {
  const catalog = [
    family(product('p', 'Batata Frita Pequena (200 g)', 'Batatas Fritas', 12), 'f-batata', 'Batata Frita Tradicional', 'tamanho', 'Pequena · 200 g'),
    family(product('m', 'Batata Frita Média (300 g)', 'Batatas Fritas', 15), 'f-batata', 'Batata Frita Tradicional', 'tamanho', 'Média · 300 g'),
    family(product('g', 'Batata Frita Grande (400 g)', 'Batatas Fritas', 18), 'f-batata', 'Batata Frita Tradicional', 'tamanho', 'Grande · 400 g'),
    product('esp', 'Batata Frita Especial (300 g)', 'Batatas Fritas', 24),
  ];
  const result = resolvePairingDisplay(catalog, [catalog[0], catalog[1], catalog[3]], '1', 4);
  assert.deepEqual(result.map(item => item.id), ['family-f-batata', 'esp']);
  assert.ok(isGroupedProduct(result[0]));
  assert.equal(result[0].requiresExplicitVariantSelection, true);
  assert.equal(resolveCatalogDisplayProduct(catalog, catalog[2], '1').id, 'family-f-batata');
  assert.equal(resolveCatalogDisplayProduct(catalog, catalog[3], '1').id, 'esp');
});

test('batata especial preserva sua escolha real de bacon ou calabresa', () => {
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

test('sugestão de sucos usa card nativo sem duplicar suas variantes', () => {
  const catalog = [
    family(product('suco-manga', 'Suco de Manga', 'Vitaminas e Sucos', 5), 'f-sucos', 'Sucos Naturais (300 ml)', 'sabor', 'Manga'),
    family(product('suco-acerola', 'Suco de Acerola', 'Vitaminas e Sucos', 5), 'f-sucos', 'Sucos Naturais (300 ml)', 'sabor', 'Acerola'),
    product('batata-p', 'Batata Frita Pequena (200 g)', 'Batatas Fritas', 12),
  ];
  const result = resolvePairingDisplay(catalog, [catalog[0], catalog[1], catalog[2]], '1', 4);
  assert.deepEqual(result.map(p => p.id), ['family-f-sucos', 'batata-p']);
  assert.ok(isGroupedProduct(result[0]));
  assert.equal(isGroupedProduct(result[1]), false);
});

test('pastéis sugeridos e em destaque usam seus IDs de família e SKU reais', () => {
  const catalog = [
    family(product('m-sol', 'Pastel Médio de Carne de Sol', 'Pastelões e Pastel Médio', 7), 'f-medio', 'Pastel Médio', 'sabor', 'Carne de Sol'),
    family(product('m-frango', 'Pastel Médio de Frango', 'Pastelões e Pastel Médio', 7), 'f-medio', 'Pastel Médio', 'sabor', 'Frango'),
    family(product('g-sol', 'Pastelão de Carne de Sol', 'Pastelões e Pastel Médio', 17), 'f-pastelao', 'Pastelão', 'sabor', 'Carne de Sol'),
    family(product('g-frango', 'Pastelão de Frango', 'Pastelões e Pastel Médio', 16), 'f-pastelao', 'Pastelão', 'sabor', 'Frango'),
  ];
  assert.equal(resolveCatalogDisplayProduct(catalog, catalog[0], '1').id, 'family-f-medio');
  assert.equal(resolveCatalogDisplayProduct(catalog, catalog[3], '1').id, 'family-f-pastelao');
  assert.deepEqual(resolvePairingDisplay(catalog, [catalog[0], catalog[2], catalog[3]], '1').map(p => p.id),
    ['family-f-medio', 'family-f-pastelao']);
});

test('nomes semelhantes sem associação continuam produtos separados em qualquer tenant', () => {
  const catalog = [
    product('a', 'Suco de Manga', 'Vitaminas e Sucos', 5),
    product('b', 'Suco de Acerola', 'Vitaminas e Sucos', 5),
  ];
  for(const id of ['1','2']) {
    assert.deepEqual(resolvePairingDisplay(catalog, catalog, id).map(p => p.id), ['a', 'b']);
  }
});

test('famílias nativas permanecem um único card sem perder SKU ou preço', () => {
  const a = family(product('b200', 'Batata Tradicional 200g', 'Batatas Fritas', 12), 'f-batatas', 'Batata Tradicional', 'tamanho', '200 g');
  const b = family(product('b400', 'Batata Tradicional 400g', 'Batatas Fritas', 18), 'f-batatas', 'Batata Tradicional', 'tamanho', '400 g');
  const third = product('agua', 'Água mineral', 'Bebidas', 4);
  const items = resolvePairingDisplay([a, b, third], [b, a, third], '6', 3);
  assert.deepEqual(items.map(p => p.id), ['family-f-batatas', 'agua']);
  assert.ok(isGroupedProduct(items[0]));
  if (!isGroupedProduct(items[0])) return;
  assert.equal(items[0].requiresExplicitVariantSelection, true);
  assert.equal(items[0].price, 12);
  assert.equal(items[0].hasVariablePrice, true);
  assert.deepEqual(items[0].variants.map(v => [v.id, v.price, v.label, v.product.id]), [
    ['b200', 12, '200 g', 'b200'], ['b400', 18, '400 g', 'b400'],
  ]);
  assert.equal(resolveCatalogDisplayProduct([a, b, third], b, '6').id, items[0].id);
});
