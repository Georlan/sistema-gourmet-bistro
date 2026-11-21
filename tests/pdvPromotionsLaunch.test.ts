import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractPdvPromotionOrderFields,
  filterActivePdvPromotions,
  isSingleItemSimpleDiscountPromotion,
  type PdvPromotion,
} from '../src/components/caixa/pdv/pdvPromotions';
import type { Product } from '../src/types';

test('extractPdvPromotionOrderFields returns undefined when no promotion items exist', () => {
  const result = extractPdvPromotionOrderFields([
    { quantity: 2 },
    { quantity: 1 },
  ]);
  assert.deepEqual(result, {
    promocao_id: undefined,
    promocao_item_indices: undefined,
  });
});

test('extractPdvPromotionOrderFields computes 0-based flattened indices for promotion items', () => {
  const result = extractPdvPromotionOrderFields([
    { quantity: 2 }, // indices 0, 1
    { quantity: 1, promotionId: 'promo-1' }, // index 2
    { quantity: 3, promotionId: 'promo-1' }, // indices 3, 4, 5
    { quantity: 1 }, // index 6
  ]);
  assert.deepEqual(result, {
    promocao_id: 'promo-1',
    promocao_item_indices: [2, 3, 4, 5],
  });
});

test('filterActivePdvPromotions keeps active status or active schedule window', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const promos: PdvPromotion[] = [
    { id: '1', nome: 'Ativa', preco: 20, componentes: [['p1']], ativo: true, status: 'ativa' },
    { id: '2', nome: 'Pausada', preco: 20, componentes: [['p1']], ativo: false, status: 'pausada' },
    { id: '3', nome: 'Janela valida', preco: 20, componentes: [['p1']], ativo: true, inicio_em: '2026-11-21T10:00:00Z', fim_em: '2026-11-21T14:00:00Z' },
    { id: '4', nome: 'Expirada', preco: 20, componentes: [['p1']], ativo: true, inicio_em: '2026-11-21T08:00:00Z', fim_em: '2026-11-21T11:00:00Z' },
  ];
  const active = filterActivePdvPromotions(promos, now);
  assert.deepEqual(active.map((p) => p.id), ['1', '3']);
});

test('isSingleItemSimpleDiscountPromotion detects 1-item simple discount vs combo or required modifiers', () => {
  const simpleProduct: Product = {
    id: 'p1',
    nome: 'Refrigerante Lata',
    categoria: 'Bebidas',
    descricao: '',
    preco: 8,
    ativo: true,
  };
  const comboPromo: PdvPromotion = {
    id: 'promo-combo',
    nome: 'Combo',
    preco: 30,
    tipo: 'combo',
    componentes: [['p1'], ['p1']],
    ativo: true,
  };
  const simplePromo: PdvPromotion = {
    id: 'promo-simple',
    nome: 'Refri Promo',
    preco: 5,
    tipo: 'desconto_item',
    componentes: [['p1']],
    quantidades: [1],
    ativo: true,
  };

  assert.equal(isSingleItemSimpleDiscountPromotion(comboPromo, [simpleProduct]), null);
  assert.equal(isSingleItemSimpleDiscountPromotion(simplePromo, [simpleProduct])?.id, 'p1');
});
