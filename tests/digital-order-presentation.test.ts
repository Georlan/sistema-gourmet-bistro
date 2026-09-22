import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDigitalOrderAssociation,
  getDigitalOrderTableBlockLabel,
  getTableAssociationOptionLabel,
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
  assert.equal(getDigitalOrderTableBlockLabel(order), 'M6');
});

test('associação à mesa só aparece em retirada, sem contaminar delivery', () => {
  assert.equal(getDigitalOrderAssociation({ modalidade: 'delivery', mesaId: 6, garcomNome: 'Ana' }), null);
  assert.equal(getDigitalOrderAssociation({ modalidade: 'retirada', mesaId: null, garcomNome: 'Ana' }), null);
  assert.equal(getDigitalOrderTableBlockLabel({ modalidade: 'delivery', mesaId: 6 }), null);
  assert.equal(getDigitalOrderTableBlockLabel({ modalidade: 'dine_in', mesaId: 12 }), 'M12');
});

test('seletor de associação distingue mesa ocupada sem repetir o nome padrão', () => {
  assert.equal(
    getTableAssociationOptionLabel({ id: 12, nome: 'Mesa 12', isOccupied: true }),
    '● Mesa 12 · EM ATENDIMENTO',
  );
  assert.equal(
    getTableAssociationOptionLabel({ id: 8, nome: 'Varanda', isOccupied: false }),
    '○ Mesa 8 · Varanda · livre',
  );
});

test('cada canal operacional recebe identidade visual estável', () => {
  assert.equal(getDigitalOrderVisualKind({ origemOperacional: 'cardapio' }), 'online');
  assert.equal(getDigitalOrderVisualKind({ origemOperacional: 'caixa' }), 'cashier');
  assert.equal(getDigitalOrderVisualKind({ origemOperacional: 'smartpos' }), 'smartpos');
  assert.equal(getDigitalOrderVisualKind({ origemOperacional: 'desconhecida' }), 'unknown');
});
