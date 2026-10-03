import assert from 'node:assert/strict';
import test from 'node:test';
import { itemCompositionPresentation, itemCompositionSignature } from '../src/domain/orderItemComposition';
import { mapBackendComandaToOperationalOrder } from '../src/components/app/data/operationalOrderMapping';

const modifiers = [
  { id: 'chicken', nome: 'Frango', preco: 0, grupo_id: 'protein', grupo_nome: 'Proteínas' },
  { id: 'rice', nome: 'Arroz à grega', preco: 0, grupo_id: 'side', grupo_nome: 'Guarnições' },
  { id: 'egg', nome: 'Ovo', preco: 2, grupo_id: 'extra', grupo_nome: 'Adicionais pagos' },
  { id: 'egg', nome: 'Ovo', preco: 2, grupo_id: 'extra', grupo_nome: 'Adicionais pagos' },
];

test('marmitaria shows compact groups and repeated portions separately from customer notes', () => {
  assert.deepEqual(itemCompositionPresentation({
    modificadores: modifiers, composicao_agrupada: true,
    observacao: 'Sem salada - Opções: Frango, Arroz à grega, 2x Ovo',
  }), {
    lines: ['PROTEÍNAS: Frango', 'GUARNIÇÕES: Arroz à grega', 'ADICIONAIS PAGOS: 2x Ovo'],
    observation: 'Sem salada',
  });
});

test('historical repeated-name suffix remains readable and missing structured data is preserved', () => {
  assert.equal(itemCompositionPresentation({
    modificadores: modifiers, composicao_agrupada: true,
    observacao: 'Opções: Frango, Arroz à grega, Ovo, Ovo',
  }).observation, '');
  assert.deepEqual(itemCompositionPresentation({ composicao_agrupada: true, observacao: 'Opções: Costela antiga' }), {
    lines: [], observation: 'Opções: Costela antiga',
  });
  assert.deepEqual(itemCompositionPresentation({ composicao_agrupada: true, modificadores: modifiers, observacao: 'Opções: Frango antigo' }), {
    lines: [], observation: 'Opções: Frango antigo',
  });
});

test('general profile preserves existing generated observation layout', () => {
  assert.deepEqual(itemCompositionPresentation({ modificadores: modifiers, observacao: 'Opções: Frango, Arroz à grega, 2x Ovo' }), {
    lines: [], observation: 'Opções: Frango, Arroz à grega, 2x Ovo',
  });
  assert.deepEqual(itemCompositionPresentation({ modificadores: modifiers, observacao: 'Sem cebola' }), {
    lines: ['COMPLEMENTOS: Frango, Arroz à grega, 2x Ovo'], observation: 'Sem cebola',
  });
});

test('composition identity distinguishes choices and repeated units independently of order', () => {
  assert.equal(itemCompositionSignature({ modificadores: modifiers }), itemCompositionSignature({ modificadores: [...modifiers].reverse() }));
  assert.notEqual(itemCompositionSignature({ modificadores: modifiers }), itemCompositionSignature({ modificadores: modifiers.slice(0, -1) }));
  assert.notEqual(itemCompositionSignature({ modificadores: modifiers }), itemCompositionSignature({ modificadores: [{ ...modifiers[0], id: 'beef' }, ...modifiers.slice(1)] }));
});

test('operational mapping preserves group metadata and repetitions for kitchen and cards', () => {
  const order = mapBackendComandaToOperationalOrder({ liveProdutos: [], comanda: {
    id: 'meal', numero_pedido: 24, tipo: 'Retirada', criado_em: '2026-10-03T00:00:00Z',
    itens: [{ id: 'meal-item', produto_id: 'meal-g', produto: { nome: 'Quentinha G' }, preco_unit: 14,
      observacao: 'Sem salada', cliente_nome: 'Cliente', status: 'preparando', modificadores: modifiers, composicao_agrupada: true }],
  } });
  assert.deepEqual(order.itens[0].modificadores, modifiers);
  assert.equal(order.itens[0].composicao_agrupada, true);
  assert.equal(order.itens[0].preco, 14);
});


test('history and live cards use the same groups when persisted choices arrive in a different order', () => {
  assert.equal(itemCompositionPresentation({
    composicao_agrupada: true, modificadores: [...modifiers].reverse(),
    observacao: 'Sem salada - Opções: Frango, Arroz à grega, 2x Ovo',
  }).observation, 'Sem salada');
});
