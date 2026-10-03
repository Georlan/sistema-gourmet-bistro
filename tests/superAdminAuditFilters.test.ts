import assert from 'node:assert/strict';
import test from 'node:test';
import { filterAuditLogs, type AuditFilters } from '../src/super-admin/auditFilters';
import type { SuperAdminAuditLogEntry } from '../src/super-admin/superAdminTypes';

const filters: AuditFilters = { action: 'ALL', tenant: 'ALL', actor: 'ALL', search: '', fromDate: '', toDate: '' };
const logs: SuperAdminAuditLogEntry[] = [
  { id: 'audit-a', restauranteId: '1', restaurantName: 'Pizzaria', actor: 'operador', action: 'UPDATE', reason: 'Corrigir modalidade', createdAt: '2026-10-03T12:00:00', beforeData: { delivery: false }, afterData: { delivery: true } },
  { id: 'audit-b', restauranteId: '2', restaurantName: 'Bistro', actor: 'suporte', action: 'RETRY', reason: 'Reenviar impressão', createdAt: '2026-10-02T23:59:59.999' },
  { id: 'audit-c', restauranteId: '1', restaurantName: 'Pizzaria', actor: 'suporte', action: 'UPDATE', reason: 'Revisão', createdAt: null },
];

test('audit filters combine tenant, actor, action and snapshot search', () => {
  assert.deepEqual(filterAuditLogs(logs, { ...filters, tenant: '1', actor: 'operador', action: 'UPDATE', search: 'DELIVERY' }).map(l => l.id), ['audit-a']);
  assert.deepEqual(filterAuditLogs(logs, { ...filters, tenant: '2', search: 'audit-a' }), []);
  assert.deepEqual(filterAuditLogs(logs, { ...filters, search: '  impressão  ' }).map(l => l.id), ['audit-b']);
});

test('audit dates include full local day and exclude unknown timestamps', () => {
  assert.deepEqual(filterAuditLogs(logs, { ...filters, fromDate: '2026-10-02', toDate: '2026-10-02' }).map(l => l.id), ['audit-b']);
  assert.deepEqual(filterAuditLogs(logs, { ...filters, fromDate: '2026-10-03' }).map(l => l.id), ['audit-a']);
  assert.deepEqual(filterAuditLogs(logs, { ...filters, fromDate: '2026-10-04', toDate: '2026-10-02' }), []);
  assert.equal(filterAuditLogs(logs, filters).length, 3);
});
