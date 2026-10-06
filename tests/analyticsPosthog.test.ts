import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  captureAnalyticsException,
  identifyOperator,
  initAnalytics,
  isAnalyticsActive,
  resetAnalytics,
  setRestaurantGroup,
  trackAnalyticsEvent,
} from '../src/analytics';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('analytics abstraction initializes safely as no-op when VITE_POSTHOG_PROJECT_TOKEN is absent', async () => {
  const active = await initAnalytics();
  assert.equal(active, false);
  assert.equal(isAnalyticsActive(), false);

  // Calling tracking and identification without token must not throw
  assert.doesNotThrow(() => {
    trackAnalyticsEvent('public_menu_viewed', {
      restaurant_id: 1,
      restaurant_name: 'Bistro Demo',
      categories_count: 3,
      products_count: 10,
      store_status: 'open',
    });
    identifyOperator({ id: 42, role: 'caixa', restaurante_id: 1 });
    setRestaurantGroup(1, { restaurant_id: 1, name: 'Bistro Demo' });
    resetAnalytics();
    captureAnalyticsException(new Error('Simulated test error'));
  });
});

test('analytics abstraction sanitizes and strips all PII fields strictly', () => {
  const globalTarget: any = typeof globalThis !== 'undefined' ? globalThis : window;
  globalTarget.__KOMA_ANALYTICS_EVENTS__ = [];

  // Attempt to pass PII fields (defense-in-depth)
  const payloadWithPii: any = {
    restaurant_id: 1,
    product_id: 'prod-123',
    product_name: 'Suco de Laranja',
    category: 'Bebidas',
    price: 12.5,
    quantity: 2,
    total_price: 25.0,
    options_count: 0,
    // Sensitive PII that must be stripped:
    nome: 'João da Silva',
    customer_name: 'João da Silva',
    telefone: '11999998888',
    phone: '11999998888',
    email: 'joao@example.com',
    cpf: '12345678900',
    endereco: 'Rua das Flores 123',
    token: 'jwt-secret-token',
    password: 'secretpassword',
  };

  trackAnalyticsEvent('public_cart_item_added', payloadWithPii);

  const debugEvents: any[] = globalTarget.__KOMA_ANALYTICS_EVENTS__ || [];
  const recorded = debugEvents.find((e) => e.event === 'public_cart_item_added');

  assert.ok(recorded, 'Evento registrado no buffer de debug');
  assert.equal(recorded.properties.restaurant_id, 1);
  assert.equal(recorded.properties.product_name, 'Suco de Laranja');
  assert.equal(recorded.properties.price, 12.5);

  // Verify all PII fields were stripped
  assert.equal(recorded.properties.nome, undefined);
  assert.equal(recorded.properties.customer_name, undefined);
  assert.equal(recorded.properties.telefone, undefined);
  assert.equal(recorded.properties.phone, undefined);
  assert.equal(recorded.properties.email, undefined);
  assert.equal(recorded.properties.cpf, undefined);
  assert.equal(recorded.properties.endereco, undefined);
  assert.equal(recorded.properties.token, undefined);
  assert.equal(recorded.properties.password, undefined);
});

test('multi-tenant operator identification groups by restaurant without mixing tenants', () => {
  const globalTarget: any = typeof globalThis !== 'undefined' ? globalThis : window;
  globalTarget.__KOMA_ANALYTICS_EVENTS__ = [];

  identifyOperator({
    id: 101,
    role: 'gerente',
    cargo: 'Gerente Geral',
    restaurante_id: 5,
  }, { restaurantName: 'Restaurante Central' });

  const debugEvents: any[] = globalTarget.__KOMA_ANALYTICS_EVENTS__ || [];
  const identifyEvent = debugEvents.find((e) => e.event === '$identify');
  const groupEvent = debugEvents.find((e) => e.event === '$group');

  assert.ok(identifyEvent, 'Operador identificado');
  assert.equal(identifyEvent.properties.distinctId, 'operator_101');
  assert.equal(identifyEvent.properties.role, 'gerente');
  assert.equal(identifyEvent.properties.restaurante_id, 5);

  assert.ok(groupEvent, 'Agrupado pelo tenant do restaurante');
  assert.equal(groupEvent.properties.group_type, 'restaurant');
  assert.equal(groupEvent.properties.group_key, '5');
  assert.equal(groupEvent.properties.restaurant_id, 5);
  assert.equal(groupEvent.properties.restaurant_name, 'Restaurante Central');

  // Ao trocar de operador/tenant ou deslogar, resetAnalytics deve limpar a identidade
  resetAnalytics();
  const resetEvent = debugEvents.find((e) => e.event === '$reset');
  assert.ok(resetEvent, 'Contexto reiniciado após logout');
});

test('public funnel touchpoints are instrumented across cardapio components', () => {
  const cardapioPage = source('../src/cardapio/CardapioPage.tsx');
  const productModal = source('../src/cardapio/components/CardapioProductModal.tsx');
  const cartDrawer = source('../src/cardapio/components/CardapioCartDrawer.tsx');
  const digitalOrder = source('../src/cardapio/components/CardapioDigital.tsx');

  // 1. Visualização do cardápio (public_menu_viewed)
  assert.match(cardapioPage, /trackAnalyticsEvent\(['"]public_menu_viewed['"]/);
  assert.match(cardapioPage, /if \(!background\) \{[\s\S]*trackAnalyticsEvent\(['"]public_menu_viewed['"]/);

  // 2. Visualização do produto (public_product_viewed)
  assert.match(productModal, /trackAnalyticsEvent\(['"]public_product_viewed['"]/);
  assert.match(cardapioPage, /<CardapioProductModal[\s\S]*restaurantId=\{activeBrand\.id\}/);

  // 3. Adição ao carrinho (public_cart_item_added)
  assert.match(cardapioPage, /trackAnalyticsEvent\(['"]public_cart_item_added['"]/);
  assert.match(cardapioPage, /options_count: optionsCount/);

  // 4. Início de checkout (public_checkout_initiated)
  assert.match(cardapioPage, /trackAnalyticsEvent\(['"]public_checkout_initiated['"]/);
  const checkoutCallMatch = cardapioPage.match(/trackAnalyticsEvent\(['"]public_checkout_initiated['"],\s*\{([\s\S]*?)\}\);/);
  assert.ok(checkoutCallMatch, 'Chamada de public_checkout_initiated encontrada');
  const checkoutPayload = checkoutCallMatch[1];
  assert.match(checkoutPayload, /delivery_method:/);
  assert.match(checkoutPayload, /cart_total:/);
  assert.doesNotMatch(checkoutPayload, /customerName/);
  assert.doesNotMatch(checkoutPayload, /customerPhone/);
  assert.doesNotMatch(checkoutPayload, /customerEmail/);
  assert.doesNotMatch(checkoutPayload, /address/);

  // 5. Envio do pedido (public_order_submitted)
  assert.match(digitalOrder, /trackAnalyticsEvent\(['"]public_order_submitted['"]/);
  const orderCallMatch = digitalOrder.match(/trackAnalyticsEvent\(['"]public_order_submitted['"],\s*\{([\s\S]*?)\}\);/);
  assert.ok(orderCallMatch, 'Chamada de public_order_submitted encontrada');
  const orderPayload = orderCallMatch[1];
  assert.match(orderPayload, /comanda_id:/);
  assert.match(orderPayload, /numero_pedido:/);
  assert.doesNotMatch(orderPayload, /cliente_nome/);
  assert.doesNotMatch(orderPayload, /cliente_telefone/);
  assert.doesNotMatch(orderPayload, /endereco_entrega/);
  assert.doesNotMatch(orderPayload, /normalizedName/);
  assert.doesNotMatch(orderPayload, /normalizedPhone/);
  assert.doesNotMatch(orderPayload, /normalizedAddress/);
});

test('react initialization and error tracking are configured cleanly in main and recovery boundary', () => {
  const main = source('../src/main.tsx');
  const recovery = source('../src/components/auth/AppRecoveryBoundary.tsx');
  const posthogConfig = source('../src/analytics/posthog.ts');

  // Session replay disabled
  assert.match(posthogConfig, /disable_session_recording:\s*true/);
  assert.match(posthogConfig, /autocapture:\s*false/);

  // React initialization in main.tsx
  assert.match(main, /initAnalytics\(\)/);
  assert.match(main, /<AnalyticsProvider>/);

  // Error tracking in AppRecoveryBoundary
  assert.match(recovery, /captureAnalyticsException\(error,\s*\{\s*source:\s*['"]AppRecoveryBoundary['"]\s*\}\)/);
});
