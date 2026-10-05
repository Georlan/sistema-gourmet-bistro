import test from 'node:test';
import assert from 'node:assert/strict';
import { reportToday, reportShortcut, validReportPeriod, reportPeriodLabel } from '../src/domain/reportPeriod';

test('reports use Fortaleza civil day at UTC midnight', () => {
  assert.equal(reportToday(new Date('2027-01-01T02:59:59Z')), '2026-12-31');
  assert.equal(reportToday(new Date('2027-01-01T03:00:00Z')), '2027-01-01');
});
test('30 day interval is inclusive and yesterday crosses year', () => {
  assert.deepEqual(reportShortcut(30, new Date('2026-10-05T12:00:00Z')), { inicio: '2026-09-06', fim: '2026-10-05' });
  assert.deepEqual(reportShortcut(1, new Date('2027-01-01T12:00:00Z'), 1), { inicio: '2026-12-31', fim: '2026-12-31' });
});
test('invalid stored dates and reversed ranges are rejected', () => {
  assert.equal(validReportPeriod({ inicio: '2026-02-30', fim: '2026-03-01' }), false);
  assert.equal(validReportPeriod({ inicio: '2026-03-02', fim: '2026-03-01' }), false);
  assert.equal(validReportPeriod({ inicio: '2026-03-01', fim: '2026-03-01' }), true);
  assert.equal(reportPeriodLabel('2026-10-02', '2026-10-04'), '02/10/2026 — 04/10/2026');
});

test('shared report reads survive one consumer cancellation and abort after all leave', async () => {
  const { fetchReportJson } = await import('../src/components/relatorios/useReportRealtimeRefresh');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let networkSignal: AbortSignal | undefined;
  let complete!: (value: Response) => void;
  globalThis.fetch = ((_url, options) => {
    calls++;
    networkSignal = options?.signal as AbortSignal;
    return new Promise<Response>(resolve => { complete = resolve; });
  }) as typeof fetch;
  try {
    const first = new AbortController();
    const second = new AbortController();
    const a = fetchReportJson('/report-shared', {}, first.signal);
    const b = fetchReportJson('/report-shared', {}, second.signal);
    const rejected = assert.rejects(a, { name: 'AbortError' });
    first.abort();
    await rejected;
    assert.equal(calls, 1);
    assert.equal(networkSignal?.aborted, false);
    complete(new Response(JSON.stringify({ total: 20 })));
    assert.deepEqual(await b, { total: 20 });
    const last = new AbortController();
    const c = fetchReportJson('/report-unused', {}, last.signal);
    const cancelled = assert.rejects(c, { name: 'AbortError' });
    last.abort();
    await cancelled;
    assert.equal(networkSignal?.aborted, true);
    complete(new Response('{}'));
  } finally { globalThis.fetch = originalFetch; }
});
