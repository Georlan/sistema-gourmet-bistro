import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewTableRange } from '../src/domain/tableRange';

test('eight existing tables expand to thirty without including existing IDs', () => {
  const ids = Array.from({length: 8}, (_, i) => i + 1);
  assert.deepEqual(previewTableRange('9', '30', '4', ids), {
    ids: Array.from({length: 22}, (_, i) => i + 9), preserved: 0, error: '',
  });
  assert.deepEqual(ids, [1,2,3,4,5,6,7,8]);
});
test('overlapping ranges fill only gaps and ignore IDs outside the range', () => {
  assert.deepEqual(previewTableRange('2','6','8',[1,2,4,10]), {ids:[3,5,6],preserved:2,error:''});
  assert.deepEqual(previewTableRange('2','2','4',[2]), {ids:[],preserved:1,error:''});
});
test('invalid ranges and capacities never produce a creation preview', () => {
  for (const [first,last,cap] of [['','30','4'],['0','30','4'],['30','9','4'],['1','301','4'],['1.5','3','4'],['1','3','0'],['1','3','51'],['1','3','2.5']]) {
    const preview = previewTableRange(first,last,cap,[]);
    assert.equal(preview.ids.length,0); assert.ok(preview.error);
  }
  assert.deepEqual(previewTableRange('300','300','50',[]).ids,[300]);
});
