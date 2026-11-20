import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

function makeAdversarialMenuPayload() {
  return {
    restaurante: {
      id: 2,
      nome: 'Bistrô B3 Adversarial',
      slug: 'bistro-b3-adversarial',
      logo_url: '',
      banner_url: '',
      subtitulo: 'Cozinha artesanal',
      sobre_nos: 'Feito na hora.',
      endereco: 'Rua Central, 50 - Centro',
      google_maps_url: '',
      status_override: 'Forçado Aberto',
      aceitando_pedidos: true,
      delivery_ativo: true,
      retirada_ativa: true,
      tipos_pedido_ativos: ['delivery', 'retirada', 'consumo_local'],
      taxa_entrega_fixa: 7,
      pedido_minimo: 20,
      frete_gratis_valor: 80,
      tabela_taxas_bairros: [
        { bairro: 'Centro', taxa: 5 },
        { bairro: 'Aldeota', taxa: 9 },
      ],
      pagamento_online_ativo: true,
      pix_proprio: false,
      formas_pagamento_aceitas: ['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito'],
      beneficios: { coupons: true, loyalty: true, cashback: true },
    },
    categorias: [
      { id: 10, nome: 'Burgers' },
      { id: 11, nome: 'Bebidas' },
      { id: 12, nome: 'Pizzas' },
    ],
    produtos: [
      {
        id: 101,
        nome: 'Classic Burger',
        descricao: 'Pão brioche, blend 150g e cheddar.',
        preco: 28,
        ativo: true,
        categoria_id: 10,
        grupos_modificadores: [
          {
            id: 'ponto',
            nome: 'Ponto da carne',
            min_selecoes: 1,
            max_selecoes: 1,
            tipo: 'obrigatorio',
            opcoes: [
              { id: 'ao-ponto', nome: 'Ao ponto', preco_adicional: 0, ativo: true },
              { id: 'bem-passado', nome: 'Bem passado', preco_adicional: 0, ativo: true },
            ],
          },
          {
            id: 'extras',
            nome: 'Extras',
            min_selecoes: 0,
            max_selecoes: 2,
            tipo: 'opcional',
            opcoes: [
              { id: 'bacon', nome: 'Bacon', preco_adicional: 5, ativo: true },
            ],
          },
        ],
      },
      {
        id: 102,
        nome: 'Refrigerante Lata',
        descricao: '350ml bem gelado.',
        preco: 6,
        ativo: true,
        categoria_id: 11,
        grupos_modificadores: [],
      },
      {
        id: 201,
        nome: 'Pizza Calabresa P',
        familia_id: 'fam-calabresa',
        familia_nome: 'Pizza Calabresa',
        familia_descricao: 'Escolha o tamanho',
        familia_eixo: 'tamanho',
        variacao_rotulo: 'Pequena (4 fatias)',
        preco: 35,
        ativo: true,
        categoria_id: 12,
        grupos_modificadores: [],
      },
      {
        id: 202,
        nome: 'Pizza Calabresa G',
        familia_id: 'fam-calabresa',
        familia_nome: 'Pizza Calabresa',
        familia_descricao: 'Escolha o tamanho',
        familia_eixo: 'tamanho',
        variacao_rotulo: 'Grande (8 fatias)',
        preco: 58,
        ativo: true,
        categoria_id: 12,
        grupos_modificadores: [],
      },
    ],
  };
}

async function openCartDrawer(page: Page) {
  const cart = page.locator('#cart-drawer-container');
  if (!(await cart.isVisible())) {
    await page.locator('#mobile-nav-cart:visible, #btn-cart-header:visible, #floating-cart-trigger:visible').first().click();
  }
  await expect(cart).toBeVisible();
  return cart;
}

test.describe('B3 — retomada de contato, fluxo sequencial de cupom e resiliência de checkout', () => {
  test('recarregar durante checkout preserva contato do visitante, modalidade e rascunho sem apagar sessionStorage', async ({ page }) => {
    await page.routeWebSocket('**/ws/**', () => {});
    await page.route(`${API_ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/cardapio-digital/public') {
        await route.fulfill({ status: 200, json: makeAdversarialMenuPayload() });
        return;
      }
      if (url.pathname === '/api/cardapio-digital/populares') {
        await route.fulfill({ status: 200, json: { produtos: [] } });
        return;
      }
      if (url.pathname === '/cardapio/clientes/reconhecer') {
        await route.fulfill({ status: 200, json: { encontrado: false } });
        return;
      }
      await route.fulfill({ status: 200, json: {} });
    });

    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
    await page.locator('#product-card-101').click();
    await page.getByRole('checkbox', { name: 'Selecionar Ao ponto' }).check();
    await page.locator('#btn-add-to-cart-action').click();

    const cart = await openCartDrawer(page);
    await cart.getByRole('button', { name: 'Receber', exact: true }).click();
    await cart.getByRole('button', { name: /Retirada/i }).first().click();
    await cart.getByRole('button', { name: 'Pagamento', exact: true }).click();
    await cart.getByRole('button', { name: 'Pix', exact: true }).click();
    await cart.getByRole('button', { name: 'Contato', exact: true }).click();
    await cart.locator('#input-guest-phone').fill('85999887766');
    await cart.locator('#input-guest-name').fill('Maria Clara');
    await cart.locator('#input-customer-email').fill('maria@teste.com');

    await expect.poll(async () => page.evaluate(() => sessionStorage.getItem('koma_guest_checkout:2'))).toContain('Maria Clara');

    await page.reload();
    const cartAfterReload = await openCartDrawer(page);
    await cartAfterReload.getByRole('button', { name: 'Receber', exact: true }).click();
    await expect(cartAfterReload.getByRole('button', { name: /Retirada/i }).first()).toHaveAttribute('aria-pressed', 'true');

    await cartAfterReload.getByRole('button', { name: 'Contato', exact: true }).click();
    await expect(cartAfterReload.locator('#input-guest-phone')).toHaveValue('(85) 99988-7766');
    await expect(cartAfterReload.locator('#input-guest-name')).toHaveValue('Maria Clara');
    await expect(cartAfterReload.locator('#input-customer-email')).toHaveValue('maria@teste.com');
  });

  test('visitante que aplica cupom antes do contato recebe atalho para aplicar após preencher celular e vê detalhe de erro HTTP 422', async ({ page }) => {
    let couponCalls = 0;
    await page.routeWebSocket('**/ws/**', () => {});
    await page.route(`${API_ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/cardapio-digital/public') {
        await route.fulfill({ status: 200, json: makeAdversarialMenuPayload() });
        return;
      }
      if (url.pathname === '/api/cardapio-digital/populares') {
        await route.fulfill({ status: 200, json: { produtos: [] } });
        return;
      }
      if (url.pathname === '/cardapio/clientes/reconhecer') {
        await route.fulfill({ status: 200, json: { encontrado: false } });
        return;
      }
      if (url.pathname === '/cardapio/cupons/validar') {
        couponCalls += 1;
        const body = route.request().postDataJSON();
        if (body.codigo === 'EXPIRADO') {
          await route.fulfill({ status: 422, json: { detail: 'Cupom expirado em 01/11.' } });
          return;
        }
        await route.fulfill({
          status: 200,
          json: { valido: true, codigo: 'PROMO10', desconto_calculado: 10, mensagem: 'Desconto de R$ 10 aplicado!' },
        });
        return;
      }
      await route.fulfill({ status: 200, json: {} });
    });

    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
    await page.locator('#product-card-101').click();
    await page.getByRole('checkbox', { name: 'Selecionar Ao ponto' }).check();
    await page.locator('#btn-add-to-cart-action').click();

    const cart = await openCartDrawer(page);
    await cart.locator('#btn-confirm-order').click(); // -> Receber
    await cart.getByRole('button', { name: /Retirada/i }).first().click();
    await cart.locator('#btn-confirm-order').click(); // -> Descontos

    // Tenta aplicar cupom antes de informar celular em Contato
    await cart.getByLabel('Código do cupom').fill('PROMO10');
    await cart.getByRole('button', { name: 'Aplicar', exact: true }).click();

    // Redireciona para Contato, mas preserva o cupom pendente com ação explícita
    const pendingBanner = cart.locator('#pending-coupon-phone-banner');
    await expect(pendingBanner).toBeVisible();
    await expect(pendingBanner).toContainText('PROMO10');
    await expect(cart.locator('#btn-apply-pending-coupon')).toBeDisabled();

    await cart.locator('#input-guest-phone').fill('85999887766');
    await expect(cart.locator('#btn-apply-pending-coupon')).toBeEnabled();
    await cart.locator('#btn-apply-pending-coupon').click();

    await expect(pendingBanner).toHaveCount(0);
    await expect(cart).toContainText('Cupom (PROMO10)');
    await expect(cart).toContainText(/R\$\s*18,00/);

    // Remove e testa erro HTTP 422 com detail específico do backend
    await cart.getByRole('button', { name: 'Cupom', exact: true }).click();
    await cart.getByRole('button', { name: 'Remover cupom' }).click();
    await cart.getByLabel('Código do cupom').fill('EXPIRADO');
    await cart.getByRole('button', { name: 'Aplicar', exact: true }).click();
    await expect(cart.locator('#cart-discounts-content')).toContainText('Cupom expirado em 01/11.');
    expect(couponCalls).toBe(2);
  });

  test('10 cliques rápidos em confirmar enviam 1 único pedido e falha de rede reaproveita a mesma chave de idempotência', async ({ page }) => {
    let postAttempts = 0;
    const idempotencyKeys: string[] = [];

    await page.routeWebSocket('**/ws/**', () => {});
    await page.route(`${API_ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/cardapio-digital/public') {
        await route.fulfill({ status: 200, json: makeAdversarialMenuPayload() });
        return;
      }
      if (url.pathname === '/api/cardapio-digital/populares') {
        await route.fulfill({ status: 200, json: { produtos: [] } });
        return;
      }
      if (url.pathname === '/cardapio/clientes/reconhecer') {
        await route.fulfill({ status: 200, json: { encontrado: false } });
        return;
      }
      if (url.pathname === '/cardapio/pedidos' && route.request().method() === 'POST') {
        postAttempts += 1;
        idempotencyKeys.push(route.request().headers()['x-idempotency-key'] || '');
        if (postAttempts === 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          await route.abort('failed');
          return;
        }
        await route.fulfill({
          status: 201,
          json: {
            comanda_id: 'ord-999',
            numero_pedido: 999,
            total: 28,
          },
        });
        return;
      }
      await route.fulfill({ status: 200, json: {} });
    });

    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
    await page.locator('#product-card-101').click();
    await page.getByRole('checkbox', { name: 'Selecionar Ao ponto' }).check();
    await page.locator('#btn-add-to-cart-action').click();

    const cart = await openCartDrawer(page);
    await cart.getByRole('button', { name: 'Receber', exact: true }).click();
    await cart.getByRole('button', { name: /Retirada/i }).first().click();
    await cart.getByRole('button', { name: 'Pagamento', exact: true }).click();
    await cart.getByRole('button', { name: 'Dinheiro', exact: true }).click();
    await cart.getByRole('button', { name: 'Contato', exact: true }).click();
    await cart.locator('#input-guest-phone').fill('85999887766');
    await cart.locator('#input-guest-name').fill('Maria Clara');
    await cart.getByRole('button', { name: 'Revisar pedido', exact: true }).click();

    await expect(page.locator('#checkout-card')).toBeVisible();

    // Dispara 10 cliques rápidos no mesmo tick para validar bloqueio contra double-submit
    await page.evaluate(() => {
      const btn = document.getElementById('btn-place-order-final');
      for (let i = 0; i < 10; i += 1) btn?.click();
    });

    await expect(page.locator('#checkout-submit-error')).toBeVisible();
    expect(postAttempts).toBe(1);

    // Recuperação após falha de rede reutiliza exatamente a mesma X-Idempotency-Key
    await page.locator('#btn-place-order-final').click();
    await expect(page.locator('#checkout-card')).toContainText('Pedido #999');
    expect(postAttempts).toBe(2);
    expect(idempotencyKeys[0]).toBeTruthy();
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  });

  test('fluxo completo com variação de tamanho e troco não causa overflow em 320px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-360', 'Matriz explícita de 320px executada uma vez');
    await page.setViewportSize({ width: 320, height: 640 });

    await page.routeWebSocket('**/ws/**', () => {});
    await page.route(`${API_ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/cardapio-digital/public') {
        await route.fulfill({ status: 200, json: makeAdversarialMenuPayload() });
        return;
      }
      if (url.pathname === '/api/cardapio-digital/populares') {
        await route.fulfill({ status: 200, json: { produtos: [] } });
        return;
      }
      if (url.pathname === '/cardapio/clientes/reconhecer') {
        await route.fulfill({ status: 200, json: { encontrado: false } });
        return;
      }
      await route.fulfill({ status: 200, json: {} });
    });

    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
    await page.locator('#product-card-family-fam-calabresa').click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('#variant-btn-202').click();
    await page.locator('#btn-add-to-cart-action').click();

    const cart = await openCartDrawer(page);
    for (const step of ['Itens', 'Receber', 'Cupom', 'Pagamento', 'Contato']) {
      await cart.getByRole('button', { name: step, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await cart.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
  });
});
