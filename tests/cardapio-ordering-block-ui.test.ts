import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORDERING_BLOCK_CONFLICT_DETAIL,
  isOrderingBlockConflict,
} from '../src/cardapio/orderingBlockUi';

test('reconhece somente o 409 autoritativo de bloqueio', () => {
  assert.equal(isOrderingBlockConflict(409, ORDERING_BLOCK_CONFLICT_DETAIL), true);
});

test('tolera espaços externos sem ampliar o contrato', () => {
  assert.equal(isOrderingBlockConflict(409, `  ${ORDERING_BLOCK_CONFLICT_DETAIL}  `), true);
});

test('não confunde outros conflitos 409 com bloqueio de cliente', () => {
  assert.equal(
    isOrderingBlockConflict(409, 'A chave idempotente já foi usada com outro conteúdo de pedido.'),
    false,
  );
});

test('não trata o mesmo texto em outro status HTTP como bloqueio', () => {
  assert.equal(isOrderingBlockConflict(500, ORDERING_BLOCK_CONFLICT_DETAIL), false);
});
