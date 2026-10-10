import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeIncidents } from '../src/super-admin/incidentSummary';

test('summary groups repeated alerts without mutating evidence or mixing tenants, severity and actions', () => {
  const base = { id: 'a', tenant_id: 8, source: 'impressao', severity: 'medium', title: 'Fila retida', recommended_action: 'Verificar agente', evidence: { job: 'a' } };
  const incidents = [base, { ...base, id: 'b', evidence: { job: 'b' } }, { ...base, tenant_id: 6 }, { ...base, severity: 'high' }, { ...base, recommended_action: 'Reenviar' }];
  const result = summarizeIncidents(incidents);
  assert.equal(result.length, 4);
  assert.equal(result[0].count, 2);
  assert.equal(result[0].incident, base);
  assert.equal(incidents.length, 5);
  assert.equal(incidents[1].evidence.job, 'b');
  assert.deepEqual(summarizeIncidents([]), []);
});
