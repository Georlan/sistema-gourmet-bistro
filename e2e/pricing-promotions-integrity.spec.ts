import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

const API_ORIGIN = 'http://127.0.0.1:8000';

async function openCartDrawerIfNeeded(page: Page) {
  const cart = page.locator('#cart-drawer-container');
  if (!(await cart.isVisible())) {
    await page.locator('#mobile-nav-cart:visible, #btn-cart-header:visible').first().click();
  }
  await expect(cart).toBeVisible();
  return cart;
}

async function openPdvCartIfNeeded(page: Page) {
  const reviewBtn = page.locator('#pdv-review-btn');
  if (await reviewBtn.isVisible()) {
    await reviewBtn.click();
  }
  await expect(page.locator('#pdv-order-panel')).toBeVisible();
}

async function openPdvProductsIfNeeded(page: Page) {
  const backBtn = page.locator('.cashier-pdv-cart__header-back');
  if (await backBtn.isVisible()) {
    await backBtn.click();
  }
  await expect(page.locator('#pdv-products-panel')).toBeVisible();
}

test('cardapio visitante e autenticado: Quentinha G com preco_promocional 10,00 vs 14,00 e telemetria zero-PII', async ({ page }) => {
  const submittedOrders: Array<Record<string, any>> = [];
  let directPromoPrice = 10;

  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (pathname === '/api/cardapio-digital/public') {
      await route.fulfill({
        json: {
          restaurante: {
            id: 99006,
            nome: 'Quentinha Caseira Fixture',
            subtitulo: 'Marmitaria',
            status_override: 'Forçado Aberto',
            aceitando_pedidos: true,
            delivery_ativo: true,
            retirada_ativa: true,
            pagamento_online_ativo: false,
            formas_pagamento_aceitas: ['Dinheiro', 'Cartão de crédito'],
            destaque_cardapio_produto_id: 'q-g',
          },
          categorias: [
            { id: 'cat-quentinhas', nome: 'Quentinhas' },
            { id: 'cat-bebidas', nome: 'Bebidas' },
          ],
          produtos: [
            {
              id: 'q-g',
              nome: 'Quentinha G',
              descricao: 'Marmita grande completa',
              preco: 14,
              preco_promocional: directPromoPrice,
              destaque: true,
              categoria_id: 'cat-quentinhas',
              grupos_modificadores: [
                {
                  id: 'proteins',
                  nome: 'Proteínas',
                  min_selecoes: 1,
                  max_selecoes: 1,
                  modo_selecao: 'tipos',
                  tipo: 'obrigatorio',
                  opcoes: [{ id: 'frango', nome: 'Frango', preco_adicional: 0, ativo: true }],
                },
                {
                  id: 'extras',
                  nome: 'Adicionais',
                  min_selecoes: 0,
                  max_selecoes: 2,
                  modo_selecao: 'porcoes',
                  tipo: 'opcional',
                  opcoes: [{ id: 'ovo', nome: 'Ovo frito', preco_adicional: 2, ativo: true }],
                },
              ],
            },
            {
              id: 'suco',
              nome: 'Suco Natural',
              descricao: '300 ml',
              preco: 8,
              preco_promocional: 6,
              categoria_id: 'cat-bebidas',
              grupos_modificadores: [],
            },
          ],
          promocoes: [],
        },
      });
      return;
    }
    if (pathname === '/api/cardapio-digital/populares') {
      await route.fulfill({ json: { produtos: ['q-g'] } });
      return;
    }
    if (pathname === '/api/restaurant-features/public/scheduled-orders') {
      await route.fulfill({ json: { enabled: false } });
      return;
    }
    if (pathname === '/cardapio/clientes/reconhecer') {
      await route.fulfill({ json: { encontrado: false } });
      return;
    }
    if (pathname === '/cardapio/clientes/me') {
      await route.fulfill({
        json: {
          id: 'cli-auth-1',
          nome: 'Cliente Autenticado',
          telefone: '85999991111',
          email: 'cliente@fixture.test',
          endereco: 'Rua A, 100',
        },
      });
      return;
    }
    if (pathname === '/cardapio/pedidos' && req.method() === 'POST') {
      submittedOrders.push(req.postDataJSON());
      await route.fulfill({
        status: 201,
        json: { comanda_id: 'cmd-direct-1', numero_pedido: 501, total: 12 },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  // 1. Fluxo visitante
  await page.goto('/cardapio?restaurante_id=99006');

  const hero = page.locator('#koma-art-hero-showcase');
  await expect(hero).toBeVisible();
  await expect(hero.locator('.km-price')).toContainText('10,00');
  await expect(hero.locator('.km-price--strike')).toContainText('14,00');

  const card = page.locator('#product-card-q-g');
  await expect(card.locator('.km-price')).toContainText('10,00');
  await expect(card.locator('.km-price--strike')).toContainText('14,00');

  await card.getByRole('button', { name: /Quentinha G/ }).first().click();
  const modal = page.locator('#product-details-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('De R$ 14,00');
  await expect(modal).toContainText('Por R$ 10,00');

  await modal.getByRole('checkbox', { name: 'Selecionar Frango' }).check();
  await modal.getByRole('button', { name: 'Adicionar uma unidade de Ovo frito' }).click();
  await expect(modal).toContainText('De R$ 16,00');
  await expect(modal).toContainText('Por R$ 12,00');
  await expect(modal.locator('#btn-add-to-cart-action')).toContainText('12,00');
  await modal.locator('#btn-add-to-cart-action').click();

  const cart = await openCartDrawerIfNeeded(page);
  await expect(cart.locator('#cart-item-q-g-frango-ovo-')).toContainText('12,00');
  await expect(cart.locator('#upsell-card-suco')).toContainText('6,00');
  await expect(cart.locator('#upsell-card-suco')).toContainText('8,00');
  await expect(cart).toContainText('Total estimado');
  await expect(cart).toContainText('12,00');

  await cart.locator('#btn-confirm-order').click();
  await cart.getByRole('button', { name: /^Retirada/ }).click();
  await cart.locator('#btn-confirm-order').click();
  await cart.getByRole('button', { name: 'Dinheiro', exact: true }).click();
  await cart.locator('#btn-confirm-order').click();
  await cart.locator('#input-guest-name').fill('Visitante Sensível');
  await cart.locator('#input-guest-phone').fill('85988887777');
  await cart.locator('#btn-confirm-order').click();

  const checkout = page.locator('#checkout-card');
  await expect(checkout).toBeVisible();
  await expect(checkout).toContainText('Quentinha G');
  await expect(checkout).toContainText('12,00');
  await expect(checkout).not.toContainText('16,00');

  await page.locator('#btn-place-order-final').click();
  await expect(checkout).toContainText('Pedido confirmado');
  expect(submittedOrders).toHaveLength(1);

  const analyticsEvents = await page.evaluate(() => (window as any).__KOMA_ANALYTICS_EVENTS__ || []);
  const addedEvent = analyticsEvents.find((ev: any) => ev.event === 'public_cart_item_added');
  expect(addedEvent?.properties).toMatchObject({
    pricing_mode: 'direct_promo',
    regular_price: 14,
    effective_price: 10,
    promotion_id: null,
    total_price: 12,
  });

  const orderEvent = analyticsEvents.find((ev: any) => ev.event === 'public_order_submitted');
  expect(orderEvent?.properties).toMatchObject({
    pricing_mode: 'direct_promo',
    has_direct_promo_item: true,
    promotion_id: null,
    promotion_item_count: 0,
    displayed_subtotal: 12,
    expected_total: 12,
    authoritative_total: 12,
    price_divergence_cents: 0,
  });
  const serializedAnalytics = JSON.stringify(analyticsEvents);
  expect(serializedAnalytics).not.toContain('Visitante Sensível');
  expect(serializedAnalytics).not.toContain('85988887777');

  // 2. Fluxo autenticado + alteração de preco_promocional após adicionar na sacola
  await page.evaluate(() => {
    sessionStorage.setItem(
      'koma_customer_session:99006',
      JSON.stringify({
        token: 'cust-token-e2e',
        profile: {
          id: 'cli-auth-1',
          name: 'Cliente Autenticado',
          phone: '85999991111',
          email: 'cliente@fixture.test',
          address: 'Rua A, 100',
          points: 0,
          cashback: 0,
          phoneVerified: true,
        },
      }),
    );
  });
  await page.goto('/cardapio?restaurante_id=99006');
  await expect(page.locator('#koma-art-hero-showcase .km-price')).toContainText('10,00');
  await page.locator('#product-card-q-g').getByRole('button', { name: /Quentinha G/ }).first().click();
  await modal.getByRole('checkbox', { name: 'Selecionar Frango' }).check();
  await modal.locator('#btn-add-to-cart-action').click();

  const authCart = await openCartDrawerIfNeeded(page);
  await expect(authCart).toContainText('10,00');
  await authCart.locator('#btn-confirm-order').click();
  await authCart.getByRole('button', { name: /^Retirada/ }).click();
  await authCart.locator('#btn-confirm-order').click();
  await authCart.getByRole('button', { name: 'Dinheiro', exact: true }).click();
  await authCart.locator('#btn-confirm-order').click();
  await authCart.locator('#btn-confirm-order').click();

  await expect(checkout).toContainText('10,00');
  // Simula alteração de preço promocional no servidor enquanto o cliente está na revisão
  directPromoPrice = 12;
  await page.locator('#btn-place-order-final').click();
  await expect(checkout).toContainText('O cardápio mudou desde a montagem');
  expect(submittedOrders).toHaveLength(1);
});

test('cardapio: campanha Black Friday 10,00 com adicional pago e expiração/agendamento', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-22T12:00:00Z') });

  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (pathname === '/api/cardapio-digital/public') {
      await route.fulfill({
        json: {
          restaurante: {
            id: 99006,
            nome: 'Quentinha Caseira Fixture',
            status_override: 'Forçado Aberto',
            aceitando_pedidos: true,
            delivery_ativo: true,
            retirada_ativa: true,
            pagamento_online_ativo: false,
            formas_pagamento_aceitas: ['Dinheiro'],
          },
          categorias: [{ id: 'cat-quentinhas', nome: 'Quentinhas' }],
          produtos: [
            {
              id: 'q-g',
              nome: 'Quentinha G',
              preco: 14,
              categoria_id: 'cat-quentinhas',
              grupos_modificadores: [
                {
                  id: 'proteins',
                  nome: 'Proteínas',
                  min_selecoes: 1,
                  max_selecoes: 1,
                  modo_selecao: 'tipos',
                  tipo: 'obrigatorio',
                  opcoes: [{ id: 'frango', nome: 'Frango', preco_adicional: 0, ativo: true }],
                },
                {
                  id: 'extras',
                  nome: 'Adicionais',
                  min_selecoes: 0,
                  max_selecoes: 2,
                  modo_selecao: 'porcoes',
                  tipo: 'opcional',
                  opcoes: [{ id: 'ovo', nome: 'Ovo frito', preco_adicional: 2, ativo: true }],
                },
              ],
            },
          ],
          promocao_composicao_explicita: true,
          promocoes: [
            {
              id: 'promo-bf',
              nome: 'Black Friday Quentinha G',
              descricao: 'Oferta relâmpago',
              preco: 10,
              tipo: 'desconto_item',
              componentes: [['q-g']],
              quantidades: [1],
              inicio_em: '2026-11-22T11:30:00Z',
              fim_em: '2026-11-22T12:02:00Z',
            },
            {
              id: 'promo-expired',
              nome: 'Oferta Expirada',
              preco: 8,
              tipo: 'desconto_item',
              componentes: [['q-g']],
              quantidades: [1],
              fim_em: '2026-11-22T11:59:00Z',
            },
            {
              id: 'promo-scheduled',
              nome: 'Oferta Agendada',
              preco: 9,
              tipo: 'desconto_item',
              componentes: [['q-g']],
              quantidades: [1],
              inicio_em: '2026-11-22T12:05:00Z',
              fim_em: '2026-11-22T13:00:00Z',
            },
          ],
        },
      });
      return;
    }
    if (pathname === '/api/cardapio-digital/populares') {
      await route.fulfill({ json: { produtos: [] } });
      return;
    }
    if (pathname === '/api/restaurant-features/public/scheduled-orders') {
      await route.fulfill({ json: { enabled: false } });
      return;
    }
    if (pathname === '/cardapio/pedidos' && req.method() === 'POST') {
      await route.fulfill({ status: 201, json: { comanda_id: 'cmd-bf', numero_pedido: 502, total: 12 } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto('/cardapio?restaurante_id=99006');
  const promotions = page.locator('#cardapio-promotions-home');
  await expect(promotions).toBeVisible();
  await expect(promotions).toContainText('Black Friday Quentinha G');
  await expect(promotions).not.toContainText('Oferta Expirada');
  await expect(promotions).not.toContainText('Oferta Agendada');

  await promotions.getByRole('button', { name: /Montar promoção Black Friday Quentinha G/ }).click();
  const modal = page.locator('#product-details-modal');
  await modal.getByRole('checkbox', { name: 'Selecionar Frango' }).check();
  await modal.getByRole('button', { name: 'Adicionar uma unidade de Ovo frito' }).click();
  await modal.getByRole('button', { name: 'Revisar promoção' }).click();

  const wizard = page.getByRole('dialog', { name: 'Black Friday Quentinha G' });
  await expect(wizard).toContainText('R$ 12,00');
  await wizard.getByRole('button', { name: 'Adicionar promoção' }).click();

  const cart = await openCartDrawerIfNeeded(page);
  await expect(cart).toContainText('Black Friday Quentinha G');
  await expect(cart).toContainText('12,00');

  const analyticsEvents = await page.evaluate(() => (window as any).__KOMA_ANALYTICS_EVENTS__ || []);
  const campaignAdded = analyticsEvents.find(
    (ev: any) => ev.event === 'public_cart_item_added' && ev.properties?.pricing_mode === 'campaign',
  );
  expect(campaignAdded?.properties).toMatchObject({
    pricing_mode: 'campaign',
    promotion_id: 'promo-bf',
    effective_price: 10,
    total_price: 12,
    parts_count: 1,
  });

  await cart.getByRole('button', { name: 'Fechar sacola' }).click();
  await page.clock.fastForward(125_000);
  await expect(page.locator('#cardapio-promotions-home')).toHaveCount(0);
});

test('PDV: preco_promocional no modal, promocoes repetidas com adicionais, bloqueio de 2 campanhas e remocao atomica', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'balcao');
  });

  let directSalePayload: Record<string, any> | null = null;

  await page.route(`${API_ORIGIN}/produtos/catalogo`, async (route) => {
    await route.fulfill({
      json: {
        categorias: [{ id: 'cat-quentinhas', nome: 'Quentinhas', destino_impressao: 'COZINHA' }],
        produtos: [
          {
            id: 'q-g',
            nome: 'Quentinha G',
            preco: 14,
            preco_promocional: 10,
            categoria_id: 'cat-quentinhas',
            ativo: true,
            grupos_modificadores: [
              {
                id: 'proteins',
                nome: 'Proteínas',
                min_selecoes: 1,
                max_selecoes: 1,
                modo_selecao: 'tipos',
                tipo: 'obrigatorio',
                opcoes: [{ id: 'frango', grupo_id: 'proteins', nome: 'Frango', preco_adicional: 0, ativo: true }],
              },
              {
                id: 'extras',
                nome: 'Adicionais',
                min_selecoes: 0,
                max_selecoes: 2,
                modo_selecao: 'porcoes',
                tipo: 'opcional',
                opcoes: [{ id: 'ovo', grupo_id: 'extras', nome: 'Ovo frito', preco_adicional: 2, ativo: true }],
              },
            ],
          },
          {
            id: 'q-m',
            nome: 'Quentinha M',
            preco: 10,
            categoria_id: 'cat-quentinhas',
            ativo: true,
            grupos_modificadores: [
              {
                id: 'salad',
                nome: 'Salada',
                min_selecoes: 0,
                max_selecoes: 1,
                modo_selecao: 'tipos',
                tipo: 'opcional',
                opcoes: [{ id: 'alface', grupo_id: 'salad', nome: 'Alface', preco_adicional: 0, ativo: true }],
              },
            ],
          },
        ],
      },
    });
  });

  await page.route(`${API_ORIGIN}/api/cardapio-digital/promocoes`, async (route) => {
    await route.fulfill({
      json: {
        promocoes: [
          {
            id: 'promo-bf',
            nome: 'Black Friday G',
            preco: 10,
            tipo: 'desconto_item',
            componentes: [['q-g']],
            quantidades: [1],
            ativo: true,
            status: 'ativa',
          },
          {
            id: 'promo-gm',
            nome: 'Combo G + M',
            preco: 22,
            tipo: 'combo',
            componentes: [['q-g'], ['q-m']],
            quantidades: [1, 1],
            ativo: true,
            status: 'ativa',
          },
        ],
      },
    });
  });

  await page.route(`${API_ORIGIN}/cardapio/modificadores/venda-direta`, async (route) => {
    directSalePayload = route.request().postDataJSON();
    await route.fulfill({
      json: {
        id: 'cmd-pdv-promo',
        numero_pedido: 8801,
        tipo: 'Balcão',
        delivery_status: 'producao',
        itens: [],
      },
    });
  });

  await page.goto('/?view=caixa');

  // 1. Preço direto 10,00 vs 14,00 no card + configurador PDV (header e footer)
  const qgCard = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Quentinha G' });
  await expect(qgCard).toContainText('10,00');
  await expect(qgCard).toContainText('14,00');
  await qgCard.getByRole('button', { name: /Personalizar Quentinha G/ }).click();

  const pdvConfig = page.getByTestId('cashier-pdv-config-dialog');
  await expect(pdvConfig.locator('.cashier-pdv-config__header')).toContainText('10,00');
  await pdvConfig.getByRole('button', { name: /Frango/ }).click();
  await pdvConfig.getByRole('button', { name: 'Adicionar uma unidade de Ovo frito' }).click();
  await expect(pdvConfig.locator('.cashier-pdv-config__footer')).toContainText('12,00');
  await pdvConfig.getByRole('button', { name: /Adicionar ao pedido/ }).click();

  await openPdvCartIfNeeded(page);
  await expect(page.locator('#pdv-order-panel')).toContainText('12,00');
  await page.getByRole('button', { name: 'Remover Quentinha G', exact: true }).click();
  await openPdvProductsIfNeeded(page);

  // 2. Combo G + M (22,00) com adicional pago (+2,00) = 24,00
  const offers = page.getByTestId('pdv-active-offers');
  await offers.locator('.grid > div').filter({ hasText: 'Combo G + M' }).getByRole('button', { name: 'Lançar oferta' }).click();
  const modal = page.locator('#product-details-modal');
  await modal.getByRole('checkbox', { name: 'Selecionar Frango' }).check();
  await modal.getByRole('button', { name: 'Adicionar uma unidade de Ovo frito' }).click();
  await modal.getByRole('button', { name: 'Continuar para Quentinha M' }).click();
  await modal.getByRole('button', { name: 'Revisar promoção' }).click();
  await page.getByRole('dialog', { name: 'Combo G + M' }).getByRole('button', { name: 'Adicionar promoção' }).click();

  await openPdvCartIfNeeded(page);
  const cartPanel = page.locator('#pdv-order-panel');
  await expect(cartPanel).toContainText('Oferta: Combo G + M');
  await expect(cartPanel).not.toContainText('14,00 / un.');
  await expect(cartPanel).toContainText('24,00');

  // 3. Bloqueio de 2 campanhas distintas no PDV
  await openPdvProductsIfNeeded(page);
  await offers.locator('.grid > div').filter({ hasText: 'Black Friday G' }).getByRole('button', { name: 'Lançar oferta' }).click();
  await expect(page.locator('#product-details-modal')).toHaveCount(0);
  await expect(page.getByText(/já possui a oferta/i)).toBeVisible();

  // 4. Repetir a mesma campanha (2a instância = +22,00 -> total 46,00)
  await offers.locator('.grid > div').filter({ hasText: 'Combo G + M' }).getByRole('button', { name: 'Lançar oferta' }).click();
  await modal.getByRole('checkbox', { name: 'Selecionar Frango' }).check();
  await modal.getByRole('button', { name: 'Continuar para Quentinha M' }).click();
  await modal.getByRole('button', { name: 'Revisar promoção' }).click();
  await page.getByRole('dialog', { name: 'Combo G + M' }).getByRole('button', { name: 'Adicionar promoção' }).click();

  await openPdvCartIfNeeded(page);
  await expect(cartPanel.getByTestId('cashier-pdv-cart-line')).toHaveCount(4);
  await expect(cartPanel).toContainText('46,00');

  // 5. Tentar incrementar linha de campanha orienta repetir pelo card da oferta
  await cartPanel.getByRole('button', { name: 'Aumentar quantidade de Quentinha G' }).first().click();
  await expect(page.getByText(/Para adicionar outra unidade.*use "Lançar oferta"/i)).toBeVisible();
  await expect(cartPanel).toContainText('46,00');

  // 6. Remoção atômica de 1 instância remove os 2 itens daquela instância e mantém a outra (24,00)
  await cartPanel.getByRole('button', { name: 'Remover Quentinha G' }).last().click();
  await expect(cartPanel.getByTestId('cashier-pdv-cart-line')).toHaveCount(2);
  await expect(cartPanel).toContainText('24,00');

  // 7. Re-adiciona segunda instância e lança venda no PDV validando payload autoritativo
  await openPdvProductsIfNeeded(page);
  await offers.locator('.grid > div').filter({ hasText: 'Combo G + M' }).getByRole('button', { name: 'Lançar oferta' }).click();
  await modal.getByRole('checkbox', { name: 'Selecionar Frango' }).check();
  await modal.getByRole('button', { name: 'Continuar para Quentinha M' }).click();
  await modal.getByRole('button', { name: 'Revisar promoção' }).click();
  await page.getByRole('dialog', { name: 'Combo G + M' }).getByRole('button', { name: 'Adicionar promoção' }).click();

  await openPdvCartIfNeeded(page);
  await expect(cartPanel).toContainText('46,00');
  await page.locator('#pdv-submit-btn').click();

  await expect.poll(() => directSalePayload).not.toBeNull();
  expect(directSalePayload).toMatchObject({
    promocao_id: 'promo-gm',
    promocao_preco_esperado: 22,
    promocao_item_indices: [0, 1, 2, 3],
  });
  expect(directSalePayload?.itens).toHaveLength(4);
});

test('Garcom: repetir item aplica preco_promocional efetivo + adicionais atuais', async ({ page }) => {
  const draftKey = 'koma_drafts_v4:99001:repeat-waiter';
  await mockCashierBackend(page);
  await page.routeWebSocket(/\/ws\//, (socket) => socket.onMessage(() => {}));
  await page.addInitScript((key) => {
    sessionStorage.setItem('koma_waiter_token', 'repeat-fixture');
    sessionStorage.setItem('koma_waiter_id', 'repeat-waiter');
    sessionStorage.setItem('koma_waiter_name', 'Teste');
    sessionStorage.setItem('koma_user_role', 'garcom');
    sessionStorage.setItem('koma_active_operational_portal', 'garcom');
    sessionStorage.setItem(
      'koma_operator_session_garcom',
      JSON.stringify({
        expiresAt: Date.now() + 86400000,
        token: 'repeat-fixture',
        user: { id: 'repeat-waiter', nome: 'Teste', role: 'garcom', restaurante_id: 99001 },
      }),
    );
    if (localStorage.getItem(key) === null) localStorage.setItem(key, '{}');
  }, draftKey);

  await page.route(`${API_ORIGIN}/produtos/catalogo`, (route) =>
    route.fulfill({
      json: {
        categorias: [{ id: 'cat', nome: 'Quentinhas', destino_impressao: 'COZINHA' }],
        produtos: [
          {
            id: 'q-g',
            nome: 'Quentinha G',
            preco: 14,
            preco_promocional: 10,
            ativo: true,
            categoria_id: 'cat',
            grupos_modificadores: [
              {
                id: 'extras',
                nome: 'Adicionais',
                min_selecoes: 0,
                max_selecoes: 2,
                modo_selecao: 'porcoes',
                tipo: 'opcional',
                opcoes: [{ id: 'ovo', grupo_id: 'extras', nome: 'Ovo frito', preco_adicional: 2, ativo: true }],
              },
            ],
          },
        ],
      },
    }),
  );

  await page.route(`${API_ORIGIN}/comandas/detalhes/todos**`, (route) =>
    route.fulfill({
      json: [
        {
          id: 'repeat-check',
          restaurante_id: 99001,
          mesa_id: 7,
          garcom_id: 'repeat-waiter',
          tipo: 'Consumo no Local',
          numero_pedido: 71,
          fechada: false,
          valor_pago: 0,
          criado_em: new Date().toISOString(),
          status_comanda: null,
          itens: [
            {
              id: 'qg-old',
              produto_id: 'q-g',
              preco_unit: 16,
              status: 'entregue',
              pago: false,
              cliente_nome: 'Consumo Geral',
              modificadores: [{ id: 'ovo', nome: 'Ovo frito', preco: 2 }],
              produto: { id: 'q-g', nome: 'Quentinha G', preco: 14 },
            },
          ],
        },
      ],
    }),
  );

  await page.goto('/?view=garcom');
  await page.locator('#mesa-card-7').click();
  await expect(page.locator('.kw-consumption')).toBeVisible();

  await page.locator('#repeat-item-btn-qg-old').click();
  await expect.poll(async () => {
    const drafts = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}')[7] || [], draftKey);
    return drafts[0]?.preco;
  }).toBe(12);
});
