import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProductMinStartingPrice, groupCategoryProductsForDisplay, isGroupedProduct } from '../src/cardapio/catalogGrouping';
import type { Product } from '../src/cardapio/CardapioTypes';

const sku = (id: string, name: string, price: number, category: string): Product => ({
  id, name, price, category, description: '', image: '', isAvailable: true,
});
const variant = (product: Product, familyId: string, familyName: string,
  axis: 'tamanho' | 'sabor', label: string): Product => ({
    ...product, familia_id: familyId, familia_nome: familyName,
    familia_eixo: axis, variacao_rotulo: label,
});

test('nomes parecidos sem família persistida nunca agrupam (inclusive no JE)', () => {
  const products = [
    sku('p', 'Batata Frita Pequena (200 g)', 12, 'Batatas Fritas'),
    sku('m', 'Batata Frita Média (300 g)', 15, 'Batatas Fritas'),
    sku('g', 'Batata Frita Grande (400 g)', 18, 'Batatas Fritas'),
    sku('especial', 'Batata Frita Especial (300 g)', 24, 'Batatas Fritas'),
  ];
  for (const restaurantId of ['1', '2', undefined]) {
    const cards = groupCategoryProductsForDisplay('Batatas Fritas', products, restaurantId);
    assert.deepEqual(cards.map(item => item.id), ['p', 'm', 'g', 'especial']);
    assert.ok(cards.every(card => !isGroupedProduct(card)));
  }
});

test('batata nativa agrupa tamanhos e mantém preparações especiais individuais', () => {
  const products = [
    variant(sku('p', 'Batata Frita Pequena (200 g)', 12, 'Batatas Fritas'), 'batata-nativa', 'Batata Frita Tradicional', 'tamanho', 'Pequena · 200 g'),
    variant(sku('m', 'Batata Frita Média (300 g)', 15, 'Batatas Fritas'), 'batata-nativa', 'Batata Frita Tradicional', 'tamanho', 'Média · 300 g'),
    variant(sku('g', 'Batata Frita Grande (400 g)', 18, 'Batatas Fritas'), 'batata-nativa', 'Batata Frita Tradicional', 'tamanho', 'Grande · 400 g'),
    sku('especial', 'Batata Frita Especial (300 g)', 24, 'Batatas Fritas'),
    sku('frango', 'Batata com Filé de Frango', 24, 'Batatas Fritas'),
    sku('sol', 'Carne de Sol com Fritas', 28, 'Batatas Fritas'),
  ];
  const cards = groupCategoryProductsForDisplay('Batatas Fritas', products, '1');
  assert.deepEqual(cards.map(item => item.id), ['family-batata-nativa', 'especial', 'frango', 'sol']);
  assert.ok(isGroupedProduct(cards[0]));
  if (!isGroupedProduct(cards[0])) return;
  assert.equal(cards[0].requiresExplicitVariantSelection, true);
  assert.equal(cards[0].groupDescription, 'Escolha o tamanho:');
  assert.equal(cards[0].minPrice, 12);
  assert.equal(cards[0].hasVariablePrice, true);
  assert.deepEqual(cards[0].variants.map(v => [v.id, v.label, v.price, v.product.id]), [
    ['p', 'Pequena · 200 g', 12, 'p'], ['m', 'Média · 300 g', 15, 'm'],
    ['g', 'Grande · 400 g', 18, 'g'],
  ]);
});

test('preço inicial soma o menor adicional obrigatório e não os opcionais', () => {
  const product: Product = {
    ...sku('burger', 'Burger Gourmet', 30, 'Hambúrgueres'),
    modifierGroups: [
      { id: 'ponto', name: 'Ponto', minSelection: 1, maxSelection: 1,
        type: 'obrigatorio', options: [{id: 'ao-ponto',name: 'Ao ponto',extraPrice: 0,active: true}] },
      { id: 'extras', name: 'Extras', minSelection: 0, maxSelection: 2,
        type: 'opcional', options: [{id: 'bacon',name: 'Bacon',extraPrice: 5,active: true}] },
      { id: 'acomp', name: 'Acompanhamento', minSelection: 1, maxSelection: 1,
        type: 'obrigatorio', options: [
          {id: 'salada',name: 'Salada',extraPrice: 2,active: true},
          {id: 'fritas',name: 'Fritas',extraPrice: 4,active: true},
        ] },
    ],
  };
  assert.equal(calculateProductMinStartingPrice(product), 32);
});

test('família nativa pausada usa menor preço entre SKUs disponíveis', () => {
  const a = variant({...sku('p','Batata P',12,'Batatas Fritas'),isAvailable:false},'batata-nativa','Batata','tamanho','200 g');
  const b = variant(sku('m','Batata M',15,'Batatas Fritas'),'batata-nativa','Batata','tamanho','300 g');
  const cards = groupCategoryProductsForDisplay('Batatas Fritas', [a,b]);
  assert.equal(cards.length,1);
  assert.ok(isGroupedProduct(cards[0]));
  if (!isGroupedProduct(cards[0])) return;
  assert.equal(cards[0].price,15);
  assert.deepEqual(cards[0].variants.map(v=>v.isAvailable),[false,true]);
});

test('pastel médio e pastelão permanecem famílias distintas com preços exatos por sabor', () => {
  const flavors: Array<[string,number,number]> = [
    ['Carne de Sol',7,17],['Mistão',7,16],['Carne Moída',7,16],
    ['Pizza',7,16],['Frango',7,16],['Três Queijos',7,16],
  ];
  const products = flavors.flatMap(([label,medium,large],i) => [
    variant(sku(`m-${i}`,`Pastel Médio ${label}`,medium,'Pastelões'),'pastel-medio','Pastel Médio','sabor',label),
    variant(sku(`g-${i}`,`Pastelão ${label}`,large,'Pastelões'),'pastelao','Pastelão','sabor',label),
  ]);
  const cards=groupCategoryProductsForDisplay('Pastelões',products,'1');
  assert.deepEqual(cards.map(x=>x.id),['family-pastel-medio','family-pastelao']);
  assert.ok(cards.every(isGroupedProduct));
  const [medium,large] = cards;
  if (!isGroupedProduct(medium)||!isGroupedProduct(large)) return;
  assert.equal(medium.groupDescription,'Escolha o sabor:');
  assert.equal(large.groupDescription,'Escolha o sabor:');
  assert.deepEqual(medium.variants.map(v=>v.price),[7,7,7,7,7,7]);
  assert.deepEqual(large.variants.map(v=>v.price),[17,16,16,16,16,16]);
  assert.deepEqual(large.variants.map(v=>v.label),flavors.map(x=>x[0]));
  assert.equal(large.minPrice,16);
});

test('sucos e vitaminas agrupam apenas por famílias persistidas, não por nome', () => {
  const base = [
    variant(sku('suco1','suco de manga',5,'Vitaminas e Sucos'),'sucos','Sucos Naturais (300 ml)','sabor','Manga'),
    variant(sku('suco2','suco de acerola',5,'Vitaminas e Sucos'),'sucos','Sucos Naturais (300 ml)','sabor','Acerola'),
    variant(sku('vit1','vitamina de abacaxi',6,'Vitaminas e Sucos'),'vitaminas','Vitaminas Especiais (300 ml)','sabor','Abacaxi'),
    variant(sku('vit2','vitamina de manga',6,'Vitaminas e Sucos'),'vitaminas','Vitaminas Especiais (300 ml)','sabor','Manga'),
  ];
  assert.deepEqual(groupCategoryProductsForDisplay('Vitaminas e Sucos',base,'1').map(p=>p.id),
    ['family-sucos','family-vitaminas']);
  assert.deepEqual(groupCategoryProductsForDisplay('Vitaminas e Sucos',base.map(x=>({...x,familia_id:undefined,familia_nome:undefined,variacao_rotulo:undefined})),'1').map(p=>p.id),
    ['suco1','suco2','vit1','vit2']);
});

test('refrigerantes compartilham card somente com vínculo explícito', () => {
  const products=[
    variant(sku('g','Refrigerante Guaraná',9,'Refrigerantes'),'refri','Refrigerante 1L','sabor','Guaraná'),
    variant(sku('p','Refrigerante Pepsi',9,'Refrigerantes'),'refri','Refrigerante 1L','sabor','Pepsi'),
    variant(sku('s','Refrigerante Sukita',9,'Refrigerantes'),'refri','Refrigerante 1L','sabor','Sukita'),
  ];
  const cards=groupCategoryProductsForDisplay('Refrigerantes',products,'1');
  assert.deepEqual(cards.map(x=>x.id),['family-refri']);
  assert.ok(isGroupedProduct(cards[0]));
  if (!isGroupedProduct(cards[0])) return;
  assert.deepEqual(cards[0].variants.map(v=>v.label),['Guaraná','Pepsi','Sukita']);
});

test('família nativa funciona fora do JE, mantém SKU real e ordem comercial', () => {
  const products=[
    sku('agua','Água',4,'Bebidas'),
    variant(sku('sol','Pastel Médio Carne de Sol',7,'Pastéis'),'f-pastel','Pastel Médio','sabor','Carne de Sol'),
    variant(sku('queijo','Pastel Médio Queijo',8,'Pastéis'),'f-pastel','Pastel Médio','sabor','Queijo'),
    sku('outro','Pastel de Frango',9,'Pastéis'),
  ];
  const cards=groupCategoryProductsForDisplay('Pastéis',products,'999');
  assert.deepEqual(cards.map(x=>x.id),['agua','family-f-pastel','outro']);
  assert.ok(isGroupedProduct(cards[1]));
  if (!isGroupedProduct(cards[1])) return;
  assert.equal(cards[1].requiresExplicitVariantSelection,true);
  assert.deepEqual(cards[1].variants.map(v=>[v.product.id,v.price]),[['sol',7],['queijo',8]]);
});
