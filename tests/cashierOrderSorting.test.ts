import assert from 'node:assert/strict';
import test from 'node:test';
import { sortNewestFirst } from '../src/components/caixa/orders/cashierOrderSorting';

test('ordena sem alterar a entrada e calcula cada data apenas uma vez', () => {
  const rows = [{ id: 'a', time: 10 }, { id: 'b', time: 50 }, { id: 'c', time: 50 }, { id: 'd', time: 0 }];
  let calls = 0;
  const result = sortNewestFirst(rows, row => { calls++; return row.time; });
  assert.deepEqual(result.map(row => row.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(rows.map(row => row.id), ['a', 'b', 'c', 'd']);
  assert.equal(calls, rows.length);
});
