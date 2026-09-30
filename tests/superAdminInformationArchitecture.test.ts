import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(
  new URL('../src/super-admin/SuperAdminPanel.tsx', import.meta.url),
  'utf8',
);
const clientsHub = readFileSync(
  new URL('../src/super-admin/SuperAdminClientsHub.tsx', import.meta.url),
  'utf8',
);
const platformHub = readFileSync(
  new URL('../src/super-admin/SuperAdminPlatformHub.tsx', import.meta.url),
  'utf8',
);

test('Super Admin reduz a navegação principal para quatro contextos operacionais', () => {
  assert.match(panel, /label: "Início"/);
  assert.match(panel, /label: "Clientes"/);
  assert.match(panel, /label: "Incidentes"/);
  assert.match(panel, /label: "Plataforma"/);

  assert.doesNotMatch(panel, /label: "Inscrições"/);
  assert.doesNotMatch(panel, /label: "Contratações"/);
  assert.doesNotMatch(panel, /label: "Períodos grátis"/);
  assert.doesNotMatch(panel, /label: "Pagamentos online"/);
  assert.doesNotMatch(panel, /label: "Planos e cobrança"/);
  assert.doesNotMatch(panel, /label: "Operações e manutenção"/);
});

test('Clientes concentra aquisição e ferramentas globais de restaurantes sem remover capacidades', () => {
  assert.match(clientsHub, /Novos clientes/);
  assert.match(clientsHub, /Restaurantes/);
  assert.match(clientsHub, /Inscrições/);
  assert.match(clientsHub, /Contratações/);
  assert.match(clientsHub, /Períodos grátis/);
  assert.match(clientsHub, /Equipe e acessos/);
  assert.match(clientsHub, /Pagamentos/);
  assert.match(clientsHub, /Planos/);
  assert.match(clientsHub, /<SuperAdminSignupsTab/);
  assert.match(clientsHub, /<SuperAdminContractsTab/);
  assert.match(clientsHub, /<SuperAdminTenantsTab/);
});

test('Plataforma reúne saúde, integrações e auditoria preservando fontes reais', () => {
  assert.match(platformHub, /Saúde/);
  assert.match(platformHub, /Integrações/);
  assert.match(platformHub, /Auditoria/);
  assert.match(platformHub, /<SuperAdminOperationsTab/);
  assert.match(platformHub, /<SuperAdminSettingsTab/);
  assert.match(platformHub, /<SuperAdminAuditTab/);
});

test('Rodapé deixa de fixar versão estática do produto', () => {
  assert.match(panel, /runtimeHealth\?\.version \|\| "versão não informada"/);
  assert.doesNotMatch(panel, />v3\.5</);
});
