import assert from 'node:assert/strict';
import test from 'node:test';
import { formatOrderingBlockDate, normalizeOrderingBlock } from '../src/cardapio/orderingBlock';

test('ordering block only accepts an active block with an explicit reason', () => {
  assert.equal(normalizeOrderingBlock(null), null);
  assert.equal(normalizeOrderingBlock({ active: false, reason: 'spam' }), null);
  assert.equal(normalizeOrderingBlock({ active: true, reason: '   ' }), null);

  assert.deepEqual(
    normalizeOrderingBlock({
      active: true,
      reason: 'Spam confirmado pela operação',
      created_at: '2026-09-09T19:10:00-03:00',
      expires_at: '2026-09-10T19:10:00-03:00',
    }),
    {
      active: true,
      reason: 'Spam confirmado pela operação',
      created_at: '2026-09-09T19:10:00-03:00',
      expires_at: '2026-09-10T19:10:00-03:00',
    },
  );
});

test('ordering block dates fail closed for malformed values', () => {
  assert.equal(formatOrderingBlockDate(undefined), '');
  assert.equal(formatOrderingBlockDate('not-a-date'), '');
  assert.ok(formatOrderingBlockDate('2026-09-09T22:10:00Z').length > 0);
});
