import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getCashierNavigationItem, getCashierNavigationTarget } from '../src/components/caixa/navigation/cashierNavigation';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Cardápio online exposes canonical operational sections from one navigation tree', () => {
  const online = getCashierNavigationItem('cardapio_digital');
  assert.deepEqual(
    online?.children?.map((child) => child.label),
    ['Perfil', 'Pedidos & horários', 'Marca', 'Entrega & áreas', 'Pagamentos'],
  );
  assert.deepEqual(getCashierNavigationTarget('online_perfil'), { tab: 'cardapio_digital', subTab: 'cardapio_perfil' });
  assert.deepEqual(getCashierNavigationTarget('online_pedidos'), { tab: 'cardapio_digital', subTab: 'cardapio_pedidos' });
  assert.deepEqual(getCashierNavigationTarget('online_marca'), { tab: 'cardapio_digital', subTab: 'cardapio_marca' });
  assert.deepEqual(getCashierNavigationTarget('online_entrega'), { tab: 'cardapio_digital', subTab: 'cardapio_entrega' });
  assert.deepEqual(getCashierNavigationTarget('online_pagamentos'), { tab: 'cardapio_digital', subTab: 'cardapio_pagamentos' });
});

test('CashierOnlineMenu routes channel concerns to their canonical owners', () => {
  const onlineMenu = source('../src/components/caixa/online-menu/CashierOnlineMenu.tsx');
  assert.match(onlineMenu, /OnlineMenuOrdersSettings/);
  assert.match(onlineMenu, /OnlineMenuDeliverySettings/);
  assert.match(onlineMenu, /OnlineMenuPaymentSettings/);
  assert.match(onlineMenu, /cardapio_perfil/);
  assert.match(onlineMenu, /cardapio_pedidos/);
  assert.match(onlineMenu, /cardapio_marca/);
  assert.match(onlineMenu, /cardapio_entrega/);
  assert.match(onlineMenu, /cardapio_pagamentos/);
  assert.match(onlineMenu, /setActiveTab\('impressao_salao'\)/);
  assert.match(onlineMenu, /setActiveSubTab\('integracoes'\)/);
});

test('Pedidos & horários no longer owns payment or delivery configuration', () => {
  const orders = source('../src/components/caixa/online-menu/OnlineMenuOrdersSettings.tsx');
  assert.match(orders, /status_override/);
  assert.match(orders, /horarios_funcionamento/);
  assert.doesNotMatch(orders, /formas_pagamento_aceitas/);
  assert.doesNotMatch(orders, /tabela_taxas_bairros/);
  assert.doesNotMatch(orders, /\/caixa\/configuracoes/);
});

test('Entrega & áreas persists through ConfiguracaoRestaurante instead of profile config', () => {
  const delivery = source('../src/components/caixa/online-menu/OnlineMenuDeliverySettings.tsx');
  assert.match(delivery, /\/caixa\/configuracoes/);
  assert.match(delivery, /delivery_ativo/);
  assert.match(delivery, /pedido_minimo/);
  assert.match(delivery, /frete_gratis_valor/);
  assert.match(delivery, /tabela_taxas_bairros/);
  assert.doesNotMatch(delivery, /\/api\/cardapio-digital\/config/);
});

test('Pagamentos edits channel methods while technical provider management stays in Sistema', () => {
  const payments = source('../src/components/caixa/online-menu/OnlineMenuPaymentSettings.tsx');
  assert.match(payments, /formas_pagamento_aceitas/);
  assert.match(payments, /pagamento_online_ativo/);
  assert.match(payments, /onManageIntegrations/);
  assert.doesNotMatch(payments, /MercadoPagoConnectionCard/);
});

test('CardapioDigitalSettingsPanel remains caller-controlled for profile and brand', () => {
  const panel = source('../src/components/cardapio/CardapioDigitalSettingsPanel.tsx');
  assert.match(panel, /activeSection/);
  assert.match(panel, /onSectionChange/);
  assert.doesNotMatch(panel, /useState<SettingsTab>\('perfil'\)/);
});
