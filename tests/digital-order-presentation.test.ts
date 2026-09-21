import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDigitalOrderAssociation,
  getDigitalOrderSourceLabel,
  getDigitalOrderVisualKind,
} from '../src/components/caixa/orders/digitalOrderPresentation';

test('retirada do garçom preserva a mesa de origem como referência operacional', () => {
  const order = {
    origemOperacional: 'garcom' as const,
    modalidade: 'retirada' as const,
    mesaId: 6,
    garcomNome: 'Garçom Demo',
  };

  assert.equal(getDigitalOrderVisualKind(order), 'waiter');
  assert.equal(getDigitalOrderSourceLabel(order), 'Garçom');
  assert.equal(getDigitalOrderAssociation(order), 'Mesa 06 · Garçom Demo');
});

test('associação à mesa só aparece em retirada, sem contaminar delivery', () => {
  assert.equal(getDigitalOrderAssociation({ modalidade: 'delivery', mesaId: 6, garcomNome: 'Ana' }), null);
  assert.equal(getDigitalOrderAssociation({ modalidade: 'retirada', mesaId: null, garcomNome: 'Ana' }), null);
});

test('cada canal operacional recebe identidade visual estável', () => {
  assert.equal(getDigitalOrderVisualKind({ origemOperacional: 'cardapio' }), 'online');
  assert.equal(getDigitalOrderVisualKind({ origemOperacional: 'caixa' }), 'cashier');
  assert.equal(getDigitalOrderVisualKind({ origemOperacional: 'smartpos' }), 'smartpos');
  assert.equal(getDigitalOrderVisualKind({ origemOperacional: 'desconhecida' }), 'unknown');
});
