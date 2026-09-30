import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(
  new URL('../src/super-admin/SuperAdminPanel.tsx', import.meta.url),
  'utf8',
);
const audit = readFileSync(
  new URL('../src/super-admin/SuperAdminAuditTab.tsx', import.meta.url),
  'utf8',
);
const operations = readFileSync(
  new URL('../src/super-admin/SuperAdminOperationsTab.tsx', import.meta.url),
  'utf8',
);
const api = readFileSync(
  new URL('../src/super-admin/superAdminApi.ts', import.meta.url),
  'utf8',
);
const backend = readFileSync(
  new URL('../backend/app/routes/super_admin.py', import.meta.url),
  'utf8',
);

test('Super Admin identifica ambiente e builds sem inventar estado operacional', () => {
  assert.match(panel, /\/api\/super-admin\/integrations\/health/);
  assert.match(panel, /data\.runtime\?\.environment/);
  assert.match(panel, /ambiente: \{runtimeEnvironment \|\| "não verificado"\}/);
  assert.match(panel, /BE \{runtimeHealth\?\.commit \|\| "não informado"\}/);
});

test('Auditoria usa apenas trilha persistente e oferece filtros a partir das ações reais', () => {
  assert.match(audit, /Array\.from\(new Set\(auditLogs\.map\(log => log\.action\)\)\)/);
  assert.match(audit, /actionOptions\.map/);
  assert.match(audit, /Auditoria indisponível/);
  assert.match(panel, /<SuperAdminAuditTab \/>/);
  assert.doesNotMatch(panel, /<SuperAdminAuditTab logs=/);
});

test('Erros estruturados da API preservam localização e mensagem sem serializar payload de entrada', () => {
  assert.match(api, /function formatErrorDetail/);
  assert.match(api, /record\.loc/);
  assert.match(api, /record\.msg/);
  assert.doesNotMatch(api, /JSON\.stringify\(value\)/);
});

test('Saúde da Evolution diferencia configuração, degradação e disponibilidade real', () => {
  assert.match(backend, /evolution_status =/);
  assert.match(backend, /"available"/);
  assert.match(backend, /"degraded"/);
  assert.match(backend, /"not_configured"/);
  assert.match(operations, /Evolution \/ WhatsApp operacional/);
  assert.match(operations, /Conectado/);
  assert.match(operations, /Degradado/);
  assert.match(operations, /Indisponível/);
});
