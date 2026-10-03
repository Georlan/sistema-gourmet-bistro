import assert from 'node:assert/strict';
import test from 'node:test';
import { createVisibleRefresh, smartPosFallbackInterval } from '../src/utils/visibleRefresh';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('hidden tabs do no work and paired resume events cause one fresh read', async () => {
  let visible = false;
  let calls = 0;
  let time = 1000;
  const refresh = createVisibleRefresh(async () => { calls++; }, () => visible, () => time);
  refresh.tick();
  refresh.invalidate();
  refresh.resume();
  await flush();
  assert.equal(calls, 0);
  visible = true;
  refresh.resume();
  refresh.resume();
  await flush();
  assert.equal(calls, 1);
  time += 1000;
  refresh.resume();
  await flush();
  assert.equal(calls, 2);
  refresh.stop();
  refresh.tick();
  refresh.invalidate();
  await flush();
  assert.equal(calls, 2);
});

test('slow reads coalesce invalidations, retain a trailing update and ignore timer backlog', async () => {
  let calls = 0;
  const releases: (() => void)[] = [];
  const refresh = createVisibleRefresh(() => {
    calls++;
    return new Promise<void>(resolve => releases.push(resolve));
  }, () => true);
  refresh.invalidate();
  refresh.tick();
  refresh.tick();
  assert.equal(calls, 1);
  refresh.invalidate();
  refresh.invalidate();
  releases.shift()!();
  await flush();
  assert.equal(calls, 2);
  releases.shift()!();
  await flush();
  assert.equal(calls, 2);
});

test('cleanup cancels queued work and a failed read can recover', async () => {
  let release!: () => void;
  let calls = 0;
  const refresh = createVisibleRefresh(() => {
    calls++;
    return new Promise<void>(resolve => { release = resolve; });
  }, () => true);
  refresh.invalidate();
  refresh.invalidate();
  refresh.stop();
  release();
  await flush();
  assert.equal(calls, 1);
  const recovery = createVisibleRefresh(async () => {
    calls++;
    if (calls === 2) throw new Error('offline');
  }, () => true);
  recovery.tick();
  await flush();
  recovery.tick();
  await flush();
  assert.equal(calls, 3);
});

test('SmartPOS retains fast disconnected recovery and reduces healthy idle polling by 90%', () => {
  assert.equal(smartPosFallbackInterval(false), 30_000);
  assert.equal(smartPosFallbackInterval(true), 300_000);
  assert.equal(3_600_000 / smartPosFallbackInterval(true), 12);
});
