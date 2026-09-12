import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const realtimeOwner = readFileSync(
  new URL('../src/components/caixa/realtime/useCashierRealtime.ts', import.meta.url),
  'utf8',
);

test('cashier reconciles operational state immediately when the browser resumes', () => {
  assert.match(realtimeOwner, /window\.addEventListener\('focus', reconcileOnResume\)/);
  assert.match(realtimeOwner, /document\.addEventListener\('visibilitychange', reconcileOnResume\)/);
  assert.match(realtimeOwner, /window\.removeEventListener\('focus', reconcileOnResume\)/);
  assert.match(realtimeOwner, /document\.removeEventListener\('visibilitychange', reconcileOnResume\)/);
  assert.match(realtimeOwner, /Promise\.allSettled\(\[fetchTurno\(\), fetchDeliveryOrders\(\)\]\)/);
});

test('resume reconciliation is visibility-aware and does not add a second polling loop', () => {
  const resumeEffectStart = realtimeOwner.indexOf('let lastResumeRefreshAt = 0');
  const fallbackEffectStart = realtimeOwner.indexOf('// Orders/tables fallback belongs to App');
  assert.ok(resumeEffectStart >= 0 && fallbackEffectStart > resumeEffectStart);
  const resumeEffect = realtimeOwner.slice(resumeEffectStart, fallbackEffectStart);

  assert.match(resumeEffect, /if \(document\.hidden\) return;/);
  assert.match(resumeEffect, /now - lastResumeRefreshAt < 750/);
  assert.doesNotMatch(resumeEffect, /setInterval/);
  assert.match(realtimeOwner, /if \(isWsConnected \|\| activeTab !== 'operacao'\) return;/);
  assert.match(realtimeOwner, /setInterval\(refreshIfVisible, 12000\)/);
});
