import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdleReconciliation } from '../src/components/caixa/realtime/idleReconciliation';

const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
function simulation(connected = true) {
  let now = 0, nextId = 0, calls = 0, concurrent = 0, peak = 0, visible = true;
  let hold: (() => Promise<void>) | undefined;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const controller = createIdleReconciliation({
    connected, visible: () => visible,
    refresh: async () => { calls++; concurrent++; peak = Math.max(peak, concurrent); try { await hold?.(); } finally { concurrent--; } },
    setTimer: (callback, delay) => { const id = ++nextId; timers.set(id, { due: now + delay, callback }); return id; },
    clearTimer: id => { timers.delete(id); },
  });
  return {
    controller, calls: () => calls, peak: () => peak, timers,
    visible: (value: boolean) => { visible = value; }, hold: (fn?: () => Promise<void>) => { hold = fn; },
    async advance(ms: number) {
      await flush(); const until = now + ms;
      while (true) {
        const entry = [...timers].sort((a,b) => a[1].due - b[1].due)[0];
        if (!entry || entry[1].due > until) break;
        now = entry[1].due; timers.delete(entry[0]); entry[1].callback(); await flush();
      }
      now = until; await flush();
    },
  };
}

test('healthy idle hour uses 13 reads vs 121, offline preserves 30-second recovery', async () => {
  const healthy = simulation(); await healthy.advance(3_600_000); assert.equal(healthy.calls(), 13);
  const offline = simulation(false); await offline.advance(3_600_000); assert.equal(offline.calls(), 121);
  healthy.controller.dispose(); offline.controller.dispose();
});
test('1000 events coalesce; invalidations in flight retain exactly one follow-up', async () => {
  const s = simulation(); await flush();
  for (let i=0;i<1000;i++) s.controller.invalidate();
  await s.advance(249); assert.equal(s.calls(), 1);
  let release!: () => void; s.hold(() => new Promise<void>(resolve => { release = resolve; }));
  await s.advance(1); assert.equal(s.calls(), 2);
  for (let i=0;i<1000;i++) s.controller.invalidate();
  await s.advance(30_000); assert.equal(s.calls(), 2);
  s.hold(); release(); await flush(); await s.advance(250);
  assert.equal(s.calls(), 3); assert.equal(s.peak(), 1); s.controller.dispose();
});
test('hidden tabs do no reads and visibility/focus coalesce on resume', async () => {
  const s = simulation(); await flush(); s.visible(false);
  for(let i=0;i<100;i++) s.controller.invalidate();
  await s.advance(600_000); assert.equal(s.calls(),1);
  s.visible(true); s.controller.resume(); s.controller.resume(); await s.advance(250);
  assert.equal(s.calls(),2); s.controller.dispose();
});
test('disconnect/reconnect retimes recovery without overlap or losing invalidation', async () => {
  const s = simulation(); await flush(); s.controller.setConnected(false); await s.advance(250);
  assert.equal(s.calls(),2); await s.advance(30_000); assert.equal(s.calls(),3);
  s.controller.setConnected(true); await s.advance(250); assert.equal(s.calls(),4);
  await s.advance(30_000); assert.equal(s.calls(),4); await s.advance(270_000); assert.equal(s.calls(),5);
  s.controller.dispose(); assert.equal(s.timers.size,0);
});
test('failure retries and disposal during request never resurrects timers', async () => {
  const s = simulation(false); await flush(); s.hold(async () => { throw Error('offline'); });
  await s.advance(60_000); assert.equal(s.calls(),3);
  let release!: () => void; s.hold(() => new Promise<void>(resolve => { release=resolve; }));
  await s.advance(30_000); s.controller.invalidate(); s.controller.dispose(); release(); await flush();
  assert.equal(s.timers.size,0); await s.advance(600_000); assert.equal(s.calls(),4);
});
