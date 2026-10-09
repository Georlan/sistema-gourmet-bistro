import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotFetch } from '../src/utils/snapshotFetch';
import { createCoalescedRefresh } from '../src/utils/coalescedRefresh';
import { orderUpdateAffects } from '../src/utils/orderUpdate';

test('simultaneous reads share transport but have independently readable bodies; sessions never share', async () => {
  const native = globalThis.fetch;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async () => { calls++; await gate; return Response.json({ value: calls }); };
  try {
    const a = snapshotFetch('https://test.invalid/read', { headers: { Authorization: 'Bearer a' } });
    const b = snapshotFetch('https://test.invalid/read', { headers: { Authorization: 'Bearer a' } });
    const c = snapshotFetch('https://test.invalid/read', { headers: { Authorization: 'Bearer b' } });
    assert.equal(calls, 2);
    release();
    for (const result of await Promise.all([a,b,c])) assert.deepEqual(await result.json(), {value:2});
    await snapshotFetch('https://test.invalid/read', { headers: { Authorization: 'Bearer a' } });
    assert.equal(calls, 3, 'completed reads are never a durable cache');
    await Promise.all([snapshotFetch('https://test.invalid/read', {method:'POST'}),snapshotFetch('https://test.invalid/read',{method:'POST'})]);
    assert.equal(calls, 5, 'mutations must not be coalesced');
  } finally {globalThis.fetch = native;}
});

test('one flight preserves exactly one follow-up for a burst of invalidations', async () => {
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release=resolve;});
  const refresh = createCoalescedRefresh(async () => {reads++; if(reads===1) await gate;});
  const first=refresh();
  for(let i=0;i<100;i++) assert.equal(refresh(), first);
  assert.equal(reads,1);
  release(); await first;
  assert.equal(reads,2);
  await refresh(); assert.equal(reads,3);
});

test('typed salon updates skip unrelated reads; legacy and unknown events retain compatibility', () => {
  const event=new Event('koma_orders_updated');
  Object.defineProperty(event,'detail',{value:{resources:['salon']}});
  assert.equal(orderUpdateAffects(event,'digital'),false);
  assert.equal(orderUpdateAffects(event,'payments'),false);
  assert.equal(orderUpdateAffects(event,'salon'),true);
  assert.equal(orderUpdateAffects(new Event('koma_orders_updated'),'digital'),true);
});


test('a mutation prevents a subsequent read from sharing an older in-flight snapshot', async () => {
  const native = globalThis.fetch;
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'PUT') return Response.json({ saved: true });
    const version = ++reads;
    if (version === 1) await gate;
    return Response.json({ version });
  };
  try {
    const old = snapshotFetch('https://test.invalid/mutation-read');
    await snapshotFetch('https://test.invalid/mutation-read', { method: 'PUT' });
    const fresh = await snapshotFetch('https://test.invalid/mutation-read');
    assert.deepEqual(await fresh.json(), { version: 2 });
    release();
    assert.deepEqual(await (await old).json(), { version: 1 });
  } finally { release(); globalThis.fetch = native; }
});
