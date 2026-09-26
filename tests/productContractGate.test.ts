import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contract = JSON.parse(
  readFileSync(new URL('../product-contract.json', import.meta.url), 'utf-8'),
);
import {
  PLAN_COMPARISON_MATRIX,
  SUBSCRIPTION_PLANS,
  type SubscriptionFeatureId,
  type SubscriptionPlanId,
  subscriptionHasFeature,
} from '../src/config/subscriptionPlans';
import {
  CASHIER_SIDEBAR_GROUPS,
  getCashierSidebarGroupsForPlan,
  normalizeCashierTargetForEntitlements,
} from '../src/components/caixa/navigation/cashierNavigation';
import {
  LANDING_BENEFITS,
  resolveBenefitItemLabel,
} from '../src/landing/sections/Capabilities';
import {
  formatPlanBadge,
  formatPlanScopeText,
  getFeatureAvailability,
} from '../src/landing/landingContractAdapter';

const planIds: SubscriptionPlanId[] = ['pocket', 'pro', 'premium'];
const knownCapabilities = Object.keys(contract.capabilities) as SubscriptionFeatureId[];

test('Product Contract Gate — frontend declara exatamente as capabilities do contrato canônico', () => {
  for (const planId of planIds) {
    const contractPlan = contract.plans[planId];
    assert.ok(contractPlan, `Plano '${planId}' ausente no contrato canônico`);

    const expectedCapabilities = new Set(contractPlan.capabilities);

    for (const cap of knownCapabilities) {
      const hasCapInFrontend = subscriptionHasFeature(planId, cap);
      const shouldHave = expectedCapabilities.has(cap);

      assert.equal(
        hasCapInFrontend,
        shouldHave,
        `Plano '${planId}' divergiu na capability '${cap}': ` +
        `frontend=${hasCapInFrontend}, contrato canônico=${shouldHave}`
      );
    }
  }
});

test('Product Contract Gate — sincroniza preços e splitFeeRate entre SUBSCRIPTION_PLANS e o contrato', () => {
  for (const planId of planIds) {
    const contractPlan = contract.plans[planId];
    const frontendPlan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);

    assert.ok(frontendPlan, `Plano '${planId}' não encontrado em SUBSCRIPTION_PLANS`);
    assert.equal(frontendPlan.price, contractPlan.price, `Preço divergente no plano '${planId}'`);
    assert.equal(frontendPlan.splitFeeRate, contractPlan.split_fee_rate, `Split fee rate divergente no plano '${planId}'`);
  }
});

test('Product Contract Gate — PLAN_COMPARISON_MATRIX reflete fielmente as regras comerciais do contrato', () => {
  for (const rule of contract.commercial_comparison_rules) {
    const row = PLAN_COMPARISON_MATRIX.find((r) => r.feature === rule.feature);
    assert.ok(row, `Feature '${rule.feature}' exigida pelo contrato não foi encontrada em PLAN_COMPARISON_MATRIX`);

    for (const planId of planIds) {
      const actual = row[planId];
      const expected = (rule.expected_by_plan as Record<string, boolean | string>)[planId];
      assert.equal(
        actual,
        expected,
        `PLAN_COMPARISON_MATRIX divergiu para feature '${rule.feature}' no plano '${planId}': ` +
        `declarado=${actual}, contrato=${expected}`
      );
    }
  }
});

test('Product Contract Gate — toda requiredFeature da navegação pertence às capabilities canônicas', () => {
  const knownSet = new Set<string>(knownCapabilities);

  for (const group of CASHIER_SIDEBAR_GROUPS) {
    for (const item of group.items) {
      if (item.requiredFeature) {
        assert.ok(
          knownSet.has(item.requiredFeature),
          `Item '${item.id}' possui requiredFeature desconhecida: '${item.requiredFeature}'`
        );
      }
      if (item.children) {
        for (const child of item.children) {
          if (child.requiredFeature) {
            assert.ok(
              knownSet.has(child.requiredFeature),
              `Child '${child.id}' possui requiredFeature desconhecida: '${child.requiredFeature}'`
            );
          }
        }
      }
    }
  }
});

test('Product Contract Gate — bloqueia e redireciona rotas protegidas fail-closed via normalizeCashierTargetForEntitlements', () => {
  // 1. Pocket (apenas waiter_app)
  const pocketEntitlements = { waiter_app: true };

  const estoqueAttempt = normalizeCashierTargetForEntitlements(
    { tab: 'estoque', subTab: 'insumos' },
    pocketEntitlements,
  );
  assert.deepEqual(estoqueAttempt, { tab: 'operacao', subTab: 'pedidos' });

  const relatoriosAttempt = normalizeCashierTargetForEntitlements(
    { tab: 'relatorios', subTab: 'visao_geral' },
    pocketEntitlements,
  );
  assert.deepEqual(relatoriosAttempt, { tab: 'operacao', subTab: 'pedidos' });

  const kdsAttempt = normalizeCashierTargetForEntitlements(
    { tab: 'operacao', subTab: 'kds' },
    pocketEntitlements,
  );
  assert.deepEqual(kdsAttempt, { tab: 'operacao', subTab: 'preparo' });

  const impressaoAttempt = normalizeCashierTargetForEntitlements(
    { tab: 'impressao_salao', subTab: 'impressao' },
    pocketEntitlements,
  );
  assert.deepEqual(impressaoAttempt, { tab: 'impressao_salao', subTab: 'aparencia' });

  const fidelidadeAttempt = normalizeCashierTargetForEntitlements(
    { tab: 'clientes', subTab: 'fidelidade' },
    pocketEntitlements,
  );
  assert.deepEqual(fidelidadeAttempt, { tab: 'clientes', subTab: 'clientes' });

  // 2. Pro (tem estoque, relatórios, kds, printing, waiter_app; sem fidelidade e cupons)
  const proEntitlements = {
    inventory: true,
    advanced_reports: true,
    kds: true,
    printing: true,
    waiter_app: true,
  };

  assert.deepEqual(
    normalizeCashierTargetForEntitlements({ tab: 'estoque', subTab: 'insumos' }, proEntitlements),
    { tab: 'estoque', subTab: 'insumos' }
  );

  assert.deepEqual(
    normalizeCashierTargetForEntitlements({ tab: 'relatorios', subTab: 'visao_geral' }, proEntitlements),
    { tab: 'relatorios', subTab: 'visao_geral' }
  );

  assert.deepEqual(
    normalizeCashierTargetForEntitlements({ tab: 'clientes', subTab: 'fidelidade' }, proEntitlements),
    { tab: 'clientes', subTab: 'clientes' }
  );

  // 3. Premium (todas capabilities)
  const premiumEntitlements = {
    inventory: true,
    advanced_reports: true,
    kds: true,
    printing: true,
    waiter_app: true,
    loyalty: true,
    coupons: true,
    courier_app: true,
  };

  assert.deepEqual(
    normalizeCashierTargetForEntitlements({ tab: 'clientes', subTab: 'fidelidade' }, premiumEntitlements),
    { tab: 'clientes', subTab: 'fidelidade' }
  );

  assert.deepEqual(
    normalizeCashierTargetForEntitlements({ tab: 'clientes', subTab: 'cupons' }, premiumEntitlements),
    { tab: 'clientes', subTab: 'cupons' }
  );
});

test('Product Contract Gate — filtra a árvore de navegação da sidebar de acordo com as capabilities do plano', () => {
  // Pocket: sem estoque e sem relatórios
  const pocketGroups = getCashierSidebarGroupsForPlan('pocket', { waiter_app: true });
  const pocketItemIds = pocketGroups.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(pocketItemIds.includes('estoque'), false);
  assert.equal(pocketItemIds.includes('relatorios'), false);

  // Pro: com estoque e relatórios
  const proGroups = getCashierSidebarGroupsForPlan('pro', {
    inventory: true,
    advanced_reports: true,
    kds: true,
    printing: true,
    waiter_app: true,
  });
  const proItemIds = proGroups.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(proItemIds.includes('estoque'), true);
  assert.equal(proItemIds.includes('relatorios'), true);
});

test('Product Contract Gate — endpoint_rules é um catálogo executável abrangendo as capabilities essenciais', () => {
  const rules = contract.endpoint_rules;
  assert.ok(Array.isArray(rules) && rules.length >= 5, 'endpoint_rules deve ser uma lista com pelo menos 5 regras');

  const requiredCapabilities = ['inventory', 'advanced_reports', 'courier_app', 'coupons', 'printing'];
  const coveredCapabilities = new Set(rules.map((r: { capability: string }) => r.capability));

  for (const cap of requiredCapabilities) {
    assert.ok(
      coveredCapabilities.has(cap),
      `endpoint_rules está faltando cobertura para a capability '${cap}'`
    );
  }

  for (const rule of rules) {
    assert.ok(rule.endpoint && rule.endpoint.startsWith('/'), `Endpoint inválido na regra: ${JSON.stringify(rule)}`);
    assert.ok(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(rule.method), `Método inválido na regra: ${JSON.stringify(rule)}`);
    assert.ok(rule.capability in contract.capabilities, `Capability não canônica na regra: ${rule.capability}`);
  }
});

test('Product Contract Gate — landing deriva disponibilidade de capabilities estruturadas do contrato', () => {
  // Valida que os dados estruturados consumidos pela landing refletem estritamente o contrato canônico
  // Sem fazer regex sobre frases literais
  const featureItems = LANDING_BENEFITS.flatMap((b: any) => b.items.filter((i: any) => i.feature));
  assert.ok(featureItems.length >= 6, 'Deve haver ao menos 6 itens vinculados a capabilities na landing');

  for (const item of featureItems) {
    const availability = getFeatureAvailability(item.feature);
    const expectedPocket = contract.plans.pocket.capabilities.includes(item.feature);
    const expectedPro = contract.plans.pro.capabilities.includes(item.feature);
    const expectedPremium = contract.plans.premium.capabilities.includes(item.feature);

    assert.equal(availability.pocket, expectedPocket, `Disponibilidade Pocket incorreta para '${item.feature}'`);
    assert.equal(availability.pro, expectedPro, `Disponibilidade Pro incorreta para '${item.feature}'`);
    assert.equal(availability.premium, expectedPremium, `Disponibilidade Premium incorreta para '${item.feature}'`);

    const label = resolveBenefitItemLabel(item);
    const expectedBadge = formatPlanBadge(availability);
    assert.ok(label.endsWith(expectedBadge), `Badge incorreto para item '${item.text}': obtido '${label}', esperado sufixo '${expectedBadge}'`);
  }

  // 2. Valida regras de negócio de alto nível comunicadas nas seções
  // - Estoque e relatórios disponíveis apenas a partir do Pro
  const invAvail = getFeatureAvailability('inventory');
  assert.equal(invAvail.pocket, false);
  assert.equal(invAvail.pro, true);
  assert.equal(invAvail.premium, true);
  assert.equal(formatPlanScopeText(invAvail), 'Pro e Premium');

  // - Cupons, fidelidade e courier_app exclusivos do Premium
  for (const premOnly of ['loyalty', 'coupons', 'courier_app'] as const) {
    const avail = getFeatureAvailability(premOnly);
    assert.equal(avail.pocket, false);
    assert.equal(avail.pro, false);
    assert.equal(avail.premium, true);
    assert.equal(formatPlanScopeText(avail), 'Premium');
  }

  // - Impressão e KDS a partir do Pro
  const printAvail = getFeatureAvailability('printing');
  assert.equal(printAvail.pocket, false);
  assert.equal(printAvail.pro, true);
  assert.equal(printAvail.premium, true);
  assert.equal(formatPlanScopeText(printAvail), 'Pro e Premium');
});
