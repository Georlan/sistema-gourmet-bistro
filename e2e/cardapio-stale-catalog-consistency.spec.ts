import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

function makeMenuPayload(overrides?: {
  burgerPrice?: number;
  extraRequiredGroup?: boolean;
}) {
  return {
    restaurante: {
      id: 2,
      nome: 'Bistrô Consistência B3',
      slug: 'bistro-consistencia-b3',
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
      pagamento_online_ativo: false,
      formas_pagamento_aceitas: ['Dinheiro'],
    },
    categorias: [{ id: 10, nome: 'Burgers' }],
    produtos: [
      {
        id: 101,
        nome: 'Classic Burger',
        descricao: 'Pão brioche, blend 150g e cheddar.',
        preco: overrides?.burgerPrice ?? 28,
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
            ],
          },
          ...(overrides?.extraRequiredGroup ? [{
            id: 'molho-novo',
            nome: 'Molho obrigatório',
            min_selecoes: 1,
            max_selecoes: 1,
            tipo: 'obrigatorio',
            opcoes: [
              { id: 'maionese', nome: 'Maionese da casa', preco_adicional: 0, ativo: true },
            ],
          }] : []),
        ],
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

test.describe('B3 — produto alterado após entrar na sacola', () => {
  test('novo grupo obrigatório e alteração de preço bloqueiam envio antes do POST, destacam item na sacola e permitem atualizar e concluir', async ({ page }) => {
    let menuOverrides: { burgerPrice?: number; extraRequiredGroup?: boolean } = {};
    let postOrderCalls = 0;

    await page.routeWebSocket('**/ws/**', () => {});
    await page.route(`${API_ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/cardapio-digital/public') {
        await route.fulfill({ status: 200, json: makeMenuPayload(menuOverrides) });
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
        postOrderCalls += 1;
        await route.fulfill({
          status: 201,
          json: { comanda_id: 'ord-505', numero_pedido: 505, total: 35 },
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

    // O restaurante muda o preço (R$ 28 -> R$ 35) e adiciona grupo obrigatório após o item entrar na sacola.
    menuOverrides = { burgerPrice: 35, extraRequiredGroup: true };
    await page.locator('#btn-place-order-final').click();

    await expect(page.locator('#checkout-submit-error')).toContainText('O cardápio mudou desde a montagem');
    await expect(page.locator('#btn-place-order-final')).toContainText('Revisar sacola');
    expect(postOrderCalls).toBe(0);

    // Ao voltar para a sacola, o item alterado fica destacado e impede avanço cego em loop.
    await page.locator('#btn-place-order-final').click();
    await expect(cart).toBeVisible();
    await cart.getByRole('button', { name: 'Itens', exact: true }).click();
    await expect(cart.locator('[id^="cart-item-drift-"]')).toBeVisible();

    await cart.getByRole('button', { name: 'Contato', exact: true }).click();
    await cart.getByRole('button', { name: 'Revisar pedido', exact: true }).click();
    await expect(cart.locator('#cart-checkout-error')).toContainText('O cardápio mudou desde a montagem');
    await expect(page.locator('#checkout-card')).toHaveCount(0);

    // Editar montagem carrega o produto atualizado (R$ 35 + Molho obrigatório), limpa o alerta e conclui o pedido.
    await cart.getByRole('button', { name: 'Editar montagem de Classic Burger', exact: true }).click();
    const modal = page.locator('#product-details-modal');
    await expect(modal).toBeVisible();
    await modal.getByRole('checkbox', { name: 'Selecionar Maionese da casa' }).check();
    await expect(modal.locator('#btn-add-to-cart-action')).toContainText('35,00');
    await modal.locator('#btn-add-to-cart-action').click();

    await expect(cart.locator('[id^="cart-item-drift-"]')).toHaveCount(0);
    await expect(cart).toContainText('R$ 35,00');
    await cart.getByRole('button', { name: 'Contato', exact: true }).click();
    await cart.getByRole('button', { name: 'Revisar pedido', exact: true }).click();
    await expect(page.locator('#checkout-card')).toBeVisible();
    await page.locator('#btn-place-order-final').click();
    await expect(page.locator('#checkout-card')).toContainText('Pedido #505');
    expect(postOrderCalls).toBe(1);
  });
});
