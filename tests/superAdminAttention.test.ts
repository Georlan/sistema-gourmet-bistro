import assert from 'node:assert/strict';
import test from 'node:test';
import { compareAttention, matchesAttention, type OperationalAttention } from '../src/super-admin/operationalAttention';
const attention = (priority: OperationalAttention['priority'], sources: string[] = [], unavailable: string[] = []): OperationalAttention => ({ tenant_id: '1', priority, blockers: [], release_state: null, incident_count: sources.length, incident_sources: sources, primary_incident: null, unavailable_sources: unavailable });
test('attention orders explicit categories and keeps unverified ahead of no attention', () => {
  const values = [attention('no_attention'), attention('blocked'), attention('critical'), undefined, attention('incident')].map(value => ({ value }));
  assert.deepEqual(values.sort((a, b) => compareAttention(a.value, b.value)).map(({ value }) => value?.priority), ['critical', 'incident', 'blocked', undefined, 'no_attention']);
});
test('source filters reflect detected incidents rather than disconnected optional capability', () => {
  assert.equal(matchesAttention(attention('incident', ['impressao']), 'impressao'), true);
  assert.equal(matchesAttention(attention('no_attention'), 'mercado_pago'), false);
  assert.equal(matchesAttention(undefined, 'unverified'), true);
  assert.equal(matchesAttention(attention('critical', ['outbox'], ['onboarding']), 'unverified'), true);
});
