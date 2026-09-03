import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(
  new URL('../src/super-admin/SuperAdminPanel.tsx', import.meta.url),
  'utf8',
);
const incidentTab = readFileSync(
  new URL('../src/super-admin/SuperAdminIncidentCenterTab.tsx', import.meta.url),
  'utf8',
);

test('Super Admin integra Central de Incidentes na navegação principal', () => {
  assert.match(panel, /SuperAdminIncidentCenterTab/);
  assert.match(panel, /id: "incidents" as TabId, label: "Central de incidentes"/);
  assert.match(panel, /activeTab === "incidents"/);
});

test('Central de Incidentes consulta endpoints canônicos de diagnóstico', () => {
  assert.match(incidentTab, /\/api\/super-admin\/incidents\?/);
  assert.match(incidentTab, /\/api\/super-admin\/incidents\/summary/);
  assert.match(incidentTab, /\/api\/super-admin\/incidents\/action/);
});

test('Central exibe cartões KPI de severidade e filtros operacionais', () => {
  assert.match(incidentTab, /Críticos/);
  assert.match(incidentTab, /Altos/);
  assert.match(incidentTab, /Médios/);
  assert.match(incidentTab, /Baixos \/ Info/);
  assert.match(incidentTab, /Total Ativos/);
  assert.match(incidentTab, /Todas as Origens/);
  assert.match(incidentTab, /Todas as Severidades/);
  assert.match(incidentTab, /Todos os Restaurantes/);
});

test('Central exibe estado vazio honesto sem inventar falsa saúde', () => {
  assert.match(incidentTab, /Nenhum incidente detectado nas fontes monitoradas/);
  assert.match(incidentTab, /Nenhum erro ativo foi encontrado na fila do Outbox/);
});

test('Ações corretivas exigem motivo obrigatório para auditoria', () => {
  assert.match(incidentTab, /actionReason\.trim\(\)\.length < 3/);
  assert.match(incidentTab, /O motivo da ação corretiva é obrigatório/);
  assert.match(incidentTab, /Obrigatório para a trilha de auditoria append-only/);
  assert.match(incidentTab, /Confirmar e Executar/);
});

test('Central de Incidentes não manipula nem expõe credenciais confidenciais', () => {
  assert.doesNotMatch(incidentTab, /senha_hash|client_secret|refresh_token|token_convite/i);
});
