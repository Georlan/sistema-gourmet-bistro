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
const tenantsTab = readFileSync(
  new URL('../src/super-admin/SuperAdminTenantsTab.tsx', import.meta.url),
  'utf8',
);
const restaurant360 = readFileSync(
  new URL('../src/super-admin/SuperAdminRestaurant360.tsx', import.meta.url),
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

test('Clientes prioriza Novos clientes e a ficha Restaurante 360 sem espalhar ferramentas no menu', () => {
  assert.match(clientsHub, /Novos clientes/);
  assert.match(clientsHub, /Restaurantes/);
  assert.match(clientsHub, /Inscrições/);
  assert.match(clientsHub, /Contratações/);
  assert.match(clientsHub, /<SuperAdminSignupsTab/);
  assert.match(clientsHub, /<SuperAdminContractsTab/);
  assert.match(clientsHub, /<SuperAdminTenantsTab/);
  assert.doesNotMatch(clientsHub, /const restaurantTools/);
  assert.match(tenantsTab, /Abrir 360°/);
  assert.match(tenantsTab, /<SuperAdminRestaurant360/);
  assert.match(restaurant360, /Resumo/);
  assert.match(restaurant360, /Implantação/);
  assert.match(restaurant360, /Plano & benefícios/);
  assert.match(restaurant360, /Equipe/);
  assert.match(restaurant360, /Pagamentos/);
  assert.match(restaurant360, /Operação/);
  assert.match(restaurant360, /Histórico/);
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
