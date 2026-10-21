import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildCardapioOrderItems } from '../src/cardapio/orderItems';
import type { Product } from '../src/cardapio/CardapioTypes';
import type { CartItem } from '../src/cardapio/components/CardapioCartDrawer';

const product = (id: string, price: number): Product => ({
  id, name: id, price, description: '', image: '', category: 'Quentinhas',
});

test('pacote é apresentado como um só na sacola e serializado como dois produtos canônicos', () => {
  const g = product('g', 14), m = product('m', 10);
  const promo = product('promotion:gm', 22);
  const bundle: CartItem = {
    id: 'promotion:gm', product: promo, quantity: 1,
    selectedOptions: {}, notes: '', promotionId: 'gm',
    promotionParts: [
      { product: g, quantity: 1, notes: 'G sem cebola',
        selectedOptions: { proteinas: [{ id: 'carne', name: 'Carne', extraPrice: 0 }] } },
      { product: m, quantity: 1, notes: 'M com salada',
        selectedOptions: { saladas: [{ id: 'salada', name: 'Salada', extraPrice: 0 }] } },
    ],
  };
  const items = buildCardapioOrderItems([bundle], 'Cliente QA');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => i.produto_id), ['g', 'm']);
  assert.deepEqual(items.map(i => i.quantidade), [1, 1]);
  assert.match(items[0].observacao, /G sem cebola/);
  assert.match(items[1].observacao, /M com salada/);
  assert.deepEqual(items.map(i => i.modificador_ids), [['carne'], ['salada']]);
  assert.ok(items.every(i => !i.produto_id.startsWith('promotion:')));
});

test('mais escolhidos têm prioridade sem remover a vitrine promocional', () => {
  const source = readFileSync(new URL('../src/cardapio/components/CardapioOrderConditions.tsx', import.meta.url), 'utf8');
  assert.ok(source.indexOf('<PopularProductsPreview') < source.indexOf('<CardapioPromotions'));
  const page = readFileSync(new URL('../src/cardapio/CardapioPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /<CardapioPromotionWizard/);
  assert.match(page, /promotionParts: parts/);
  const checkout = readFileSync(new URL('../src/cardapio/components/CardapioDigital.tsx', import.meta.url), 'utf8');
  assert.match(checkout, /promocao_id:/);
});
