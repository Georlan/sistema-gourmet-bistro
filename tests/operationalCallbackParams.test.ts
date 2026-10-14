import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalOperationalQuery } from '../src/utils/operationalCallbackParams';

test('PagBank authorized callback survives canonical-host cleanup for one-time exchange', () => {
  const actual = new URLSearchParams(canonicalOperationalQuery(
    '?view=caixa&pagbank=authorized&code=one-use-code&state=signed-state&tracking=discard'
  ));
  assert.equal(actual.get('pagbank'), 'authorized');
  assert.equal(actual.get('code'), 'one-use-code');
  assert.equal(actual.get('state'), 'signed-state');
  assert.equal(actual.has('view'), false);
  assert.equal(actual.has('tracking'), false);
});

test('PagBank cancellation retains only result and state for UI cleanup', () => {
  const actual = new URLSearchParams(canonicalOperationalQuery(
    '?view=caixa&pagbank=cancelled&state=signed-state&code=never-keep-this'
  ));
  assert.deepEqual([...actual.entries()], [['pagbank', 'cancelled'], ['state', 'signed-state']]);
});

test('incomplete or oversized callbacks are discarded at canonical entry', () => {
  for (const query of [
    '?pagbank=authorized&state=valid-but-no-code',
    '?pagbank=authorized&code=orphaned-code',
    '?pagbank=authorized&code=one-use-code&state=' + 'x'.repeat(129),
    '?pagbank=authorized&code=' + 'x'.repeat(513) + '&state=some-state',
    '?pagbank=cancelled',
    '?pagbank=unknown&code=abc&state=def',
  ]) assert.equal(canonicalOperationalQuery(query), '');
});

test('print-agent pairing is preserved but unknown operational parameters are stripped', () => {
  const actual = new URLSearchParams(canonicalOperationalQuery(
    '?view=caixa&pair_print_agent=legitimate-nonce&agent_port=17654&junk=remove'
  ));
  assert.deepEqual([...actual.entries()], [
    ['pair_print_agent', 'legitimate-nonce'], ['agent_port', '17654'],
  ]);
  assert.equal(canonicalOperationalQuery('?pair_print_agent=abc&agent_port=4444'), '');
});

test('concurrent print-agent and PagBank callback flows are preserved independently', () => {
  const actual = new URLSearchParams(canonicalOperationalQuery(
    '?pair_print_agent=nonce&agent_port=17664&pagbank=authorized&code=code&state=state'
  ));
  assert.equal(actual.get('pair_print_agent'), 'nonce');
  assert.equal(actual.get('agent_port'), '17664');
  assert.equal(actual.get('pagbank'), 'authorized');
  assert.equal(actual.get('code'), 'code');
  assert.equal(actual.get('state'), 'state');
});
