import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  getDeepLinkCatalogEntry,
  isValidDeepLinkId,
  listAllowedDeepLinkIds,
  parseDeepLinkGoParam,
  resolveCurrentCashierNavigationId,
  resolveDeepLinkTarget,
  WHATSAPP_SUPPORT_DEEP_LINKS,
} from '../src/components/caixa/navigation/cashierDeepLink';
import {
  isValidDeepLinkSyntax,
  parseDeepLinkGoSyntax,
} from '../src/utils/deepLinkStorage';
import { canonicalOperationalQuery } from '../src/utils/operationalCallbackParams';

const pocketEntitlements = {
  printing: false,
  kds: false,
  waiter_app: true,
  loyalty: false,
  coupons: false,
  courier_app: false,
  inventory: false,
  advanced_reports: false,
} as const;

const premiumEntitlements = {
  printing: true,
  kds: true,
  waiter_app: true,
  loyalty: true,
  coupons: true,
  courier_app: true,
  inventory: true,
  advanced_reports: true,
} as const;

test('deep link whitelist comes from canonical navigation tree and excludes mutating actions', () => {
  const ids = listAllowedDeepLinkIds();
  assert.ok(ids.includes('online_entrega'));
  assert.ok(ids.includes('online_pagamentos'));
  assert.ok(ids.includes('online_pedidos'));
  assert.ok(ids.includes('cardapio_produtos'));
  assert.ok(ids.includes('config_impressao'));
  assert.ok(ids.includes('caixa_turno_atual'));

  // Mutating counter action must never be triggerable via URL.
  assert.equal(isValidDeepLinkId('vendas_novo_pedido'), false);
  assert.equal(parseDeepLinkGoParam('?go=vendas_novo_pedido'), null);
});

test('deep link parser rejects XSS, tokens, arbitrary paths and invalid parameters', () => {
  for (const search of [
    '',
    '?tab=online_entrega',
    '?go=',
    '?go=<script>alert(1)</script>',
    '?go=../../etc/passwd',
    '?go=eyJhbGciOiJIUzI1NiJ9.payload.sig',
    '?go=online_entrega&token=secret',
    '?go=nao_existe',
  ]) {
    const parsed = parseDeepLinkGoParam(search);
    if (search === '?go=online_entrega&token=secret') {
      assert.equal(parsed, 'online_entrega');
    } else {
      assert.equal(parsed, null, `expected null for ${search}`);
    }
  }

  assert.equal(isValidDeepLinkSyntax('online_entrega'), true);
  assert.equal(isValidDeepLinkSyntax('Online-Entrega'), false);
  assert.equal(parseDeepLinkGoSyntax('?go=ONLINE_ENTREGA'), 'online_entrega');
});

test('deep link authorization enforces role, plan entitlements and onboarding boundaries fail-closed', () => {
  // Allowed for admin/gerente/caixa
  for (const role of ['admin', 'gerente', 'caixa']) {
    const res = resolveDeepLinkTarget('online_entrega', { role, entitlements: pocketEntitlements });
    assert.equal(res.allowed, true);
    if (res.allowed) {
      assert.deepEqual(res.target, { tab: 'cardapio_digital', subTab: 'cardapio_entrega' });
      assert.equal(res.requiresSetupMode, false);
    }
  }

  // Denied for non-management staff roles
  for (const role of ['garcom', 'atendente', 'cozinha', 'motoboy', '', null]) {
    const res = resolveDeepLinkTarget('online_entrega', { role, entitlements: premiumEntitlements });
    assert.deepEqual(res, { allowed: false, reason: 'role' });
  }

  // Contract documents & onboarding tab restricted to admin/gerente
  assert.deepEqual(
    resolveDeepLinkTarget('assinatura_contrato_documentos', { role: 'caixa', entitlements: premiumEntitlements }),
    { allowed: false, reason: 'role' },
  );
  assert.equal(
    resolveDeepLinkTarget('assinatura_contrato_documentos', { role: 'gerente', entitlements: premiumEntitlements }).allowed,
    true,
  );
  assert.deepEqual(
    resolveDeepLinkTarget('config_implantacao', { role: 'caixa', entitlements: premiumEntitlements }),
    { allowed: false, reason: 'role' },
  );

  // Entitlement gating: Pocket cannot open printing, inventory, reports or benefits
  for (const gated of ['config_impressao', 'estoque_ingredientes', 'relatorios_visao_geral', 'clientes_beneficios']) {
    assert.deepEqual(
      resolveDeepLinkTarget(gated, { role: 'admin', entitlements: pocketEntitlements }),
      { allowed: false, reason: 'entitlement' },
    );
    assert.deepEqual(
      resolveDeepLinkTarget(gated, { role: 'admin', entitlements: undefined }),
      { allowed: false, reason: 'entitlement' },
    );
    assert.equal(
      resolveDeepLinkTarget(gated, { role: 'admin', entitlements: premiumEntitlements }).allowed,
      true,
    );
  }

  // Cozinha adapts smoothly between kds and preparo
  const pocketKitchen = resolveDeepLinkTarget('vendas_cozinha', { role: 'admin', entitlements: pocketEntitlements });
  assert.equal(pocketKitchen.allowed, true);
  if (pocketKitchen.allowed) {
    assert.deepEqual(pocketKitchen.target, { tab: 'operacao', subTab: 'preparo' });
  }

  // Pending onboarding allows setup targets (with setupMode) and blocks operational targets
  const setupDelivery = resolveDeepLinkTarget('online_entrega', {
    role: 'admin',
    entitlements: pocketEntitlements,
    isOnboardingPending: true,
  });
  assert.equal(setupDelivery.allowed, true);
  if (setupDelivery.allowed) {
    assert.equal(setupDelivery.requiresSetupMode, true);
  }

  for (const blockedDuringSetup of ['vendas_pedidos', 'caixa_turno_atual', 'relatorios_visao_geral', 'online_bloqueios']) {
    assert.deepEqual(
      resolveDeepLinkTarget(blockedDuringSetup, {
        role: 'admin',
        entitlements: premiumEntitlements,
        isOnboardingPending: true,
      }),
      { allowed: false, reason: 'onboarding_blocked' },
    );
  }
});

test('resolveCurrentCashierNavigationId reverses canonical tab/subTab pairs deterministically', () => {
  assert.equal(resolveCurrentCashierNavigationId('cardapio_digital', 'cardapio_entrega'), 'online_entrega');
  assert.equal(resolveCurrentCashierNavigationId('cardapio_digital', 'cardapio_pagamentos'), 'online_pagamentos');
  assert.equal(resolveCurrentCashierNavigationId('cardapio_digital', 'cardapio_bloqueios'), 'online_pedidos');
  assert.equal(resolveCurrentCashierNavigationId('impressao_salao', 'impressao'), 'config_impressao');
  assert.equal(resolveCurrentCashierNavigationId('operacao', 'preparo'), 'vendas_cozinha');
  assert.equal(resolveCurrentCashierNavigationId('financeiro', 'turno_atual'), 'caixa_turno_atual');
});

test('WhatsApp support quick link catalog uses only valid deep link IDs', () => {
  assert.ok(WHATSAPP_SUPPORT_DEEP_LINKS.length >= 10);
  for (const entry of WHATSAPP_SUPPORT_DEEP_LINKS) {
    assert.equal(isValidDeepLinkId(entry.id), true, `${entry.id} must be valid`);
    assert.equal(entry.path, `/?go=${entry.id}`);
    assert.ok(getDeepLinkCatalogEntry(entry.id));
  }
});

test('canonicalOperationalQuery preserves valid go param without dropping PagBank or print pairing callbacks', () => {
  const actual = new URLSearchParams(canonicalOperationalQuery('?view=caixa&go=online_entrega&junk=1'));
  assert.equal(actual.get('go'), 'online_entrega');
  assert.equal(actual.has('view'), false);
  assert.equal(actual.has('junk'), false);

  const combined = new URLSearchParams(canonicalOperationalQuery(
    '?pair_print_agent=nonce&agent_port=17654&pagbank=authorized&code=abc&state=xyz&go=config_integracoes',
  ));
  assert.equal(combined.get('go'), 'config_integracoes');
  assert.equal(combined.get('pagbank'), 'authorized');
  assert.equal(combined.get('pair_print_agent'), 'nonce');
});

test('unit switching and logout clear pending deep link state to prevent cross-store leakage', () => {
  const switchSource = readFileSync(new URL('../src/utils/storeSwitch.ts', import.meta.url), 'utf8');
  const authSource = readFileSync(new URL('../src/utils/authSession.ts', import.meta.url), 'utf8');
  assert.ok(switchSource.includes('PENDING_DEEP_LINK_KEY'));
  assert.ok(authSource.includes('PENDING_DEEP_LINK_KEY'));
});
