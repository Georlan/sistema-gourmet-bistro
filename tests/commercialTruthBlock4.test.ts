import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PLAN_COMPARISON_MATRIX,
  getSubscriptionPlan,
} from '../src/config/subscriptionPlans';
import {
  LANDING_BENEFITS,
  resolveBenefitItemLabel,
} from '../src/landing/sections/Capabilities';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('catálogo de planos reflete a verdade comercial canônica', () => {
  const pocket = getSubscriptionPlan('pocket');
  const pro = getSubscriptionPlan('pro');
  const premium = getSubscriptionPlan('premium');

  assert.equal(pocket.price, 39);
  assert.equal(pocket.splitFeeRate, 0.0179);
  assert.equal(pro.price, 129);
  assert.equal(pro.splitFeeRate, 0.005);
  assert.equal(premium.price, 249);
  assert.equal(premium.splitFeeRate, 0.002);
});

test('matriz de comparação não promete DRE ou relatórios avançados no Pocket', () => {
  const dreRow = PLAN_COMPARISON_MATRIX.find(
    (row) => row.feature === 'Relatórios Financeiros e DRE de Vendas',
  );
  assert.ok(dreRow, 'Linha de DRE deve existir na matriz comparativa');
  assert.equal(dreRow.pocket, false, 'Pocket não possui DRE de Vendas nem relatórios financeiros avançados');
  assert.equal(dreRow.pro, true, 'Pro possui relatórios financeiros e DRE');
  assert.equal(dreRow.premium, true, 'Premium possui relatórios financeiros e DRE');
});

test('matriz de comparação restringe App do Entregador exclusivamente ao Premium', () => {
  const courierRow = PLAN_COMPARISON_MATRIX.find(
    (row) => row.feature === 'App do Entregador',
  );
  assert.ok(courierRow, 'Linha do App do Entregador deve existir');
  assert.equal(courierRow.pocket, false);
  assert.equal(courierRow.pro, false);
  assert.equal(courierRow.premium, true);
});

test('landing Capabilities não agrupa Equipe com Impressão nem restringe Equipe a Pro/Premium', () => {
  const capabilities = source('src/landing/sections/Capabilities.tsx');

  assert.doesNotMatch(capabilities, /EQUIPE E IMPRESSÃO — PRO E PREMIUM/);
  assert.doesNotMatch(capabilities, /Equipe com permissões e impressão automática entram no Pro e Premium/);

  const labels = LANDING_BENEFITS.flatMap((b) => b.items.map(resolveBenefitItemLabel));
  assert.ok(labels.includes('EQUIPE E DELIVERY — TODOS OS PLANOS'));
  assert.ok(labels.includes('IMPRESSÃO E KDS — PRO E PREMIUM'));
  assert.ok(labels.includes('APP DO ENTREGADOR — PREMIUM'));
});

test('landing Ecosystem afirma equipe na base e não como recurso que varia conforme plano', () => {
  const ecosystem = source('src/landing/sections/Ecosystem.tsx');

  assert.doesNotMatch(
    ecosystem,
    /Recursos avançados de cozinha, equipe e automação variam conforme o plano/,
  );
  assert.match(
    ecosystem,
    /gestão de equipe na base/,
  );
});

test('.env.example não divulga Pocket R$ 0 nem domínios legados pages.dev', () => {
  const envExample = source('.env.example');

  assert.doesNotMatch(envExample, /Pocket R\$ 0/);
  assert.doesNotMatch(envExample, /sistema-gourmet-bistro\.pages\.dev/);
  assert.match(envExample, /komafood\.com\.br/);
  assert.match(envExample, /Pocket R\$ 39, Pro R\$ 129, Premium R\$ 249/);
});

test('contratação V2 distingue explicitamente condição histórica R$0 de contratação atual R$39', () => {
  const v2 = source('src/legal/PlanContractPageV2.tsx');

  // Na contratação nova, hoje é R$ 0 pelo trial de 7 dias
  assert.match(v2, /Cobrança hoje: R\$ 0 \(período de 7 dias grátis\)/);
  assert.match(v2, /Cobrança de hoje: R\$ 0 \(7 dias grátis\)/);

  // Condição histórica de R$ 0 explicitamente rotulada como contrato anterior
  assert.match(v2, /Condição Contratual Histórica/);
  assert.match(v2, /Contrato anterior mantido: o Pocket deste contrato possui condição histórica de mensalidade fixa de R\$ 0/);
  assert.match(v2, /Condição histórica do contrato anterior/);

  // Não afirma que a contratação atual do Pocket tem mensalidade fixa de R$ 0
  assert.doesNotMatch(v2, /O Pocket desta contratação tem mensalidade fixa de R\$ 0/);
});

test('checkout V1 antigo foi removido e não é referenciado em runtime', () => {
  const v1Exists = existsSync(new URL('../src/legal/PlanContractPage.tsx', import.meta.url));
  assert.equal(v1Exists, false, 'src/legal/PlanContractPage.tsx deve ter sido removido');

  const main = source('src/main.tsx');
  assert.match(main, /PlanContractPageV2/);
  assert.doesNotMatch(main, /import\(['"][^'"]*PlanContractPage['"]\)/);
});
