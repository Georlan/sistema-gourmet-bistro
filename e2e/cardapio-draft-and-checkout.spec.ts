import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

function makeMenuPayload(overrides?: {
  restaurantId?: number;
  burgerPrice?: number;
  baconPrice?: number;
  pixDirect?: boolean;
}) {
  const restaurantId = overrides?.restaurantId ?? 2;
  const burgerPrice = overrides?.burgerPrice ?? 28;
  const baconPrice = overrides?.baconPrice ?? 5;
  const pixDirect = overrides?.pixDirect ?? true;

  return {
    restaurante: {
      id: restaurantId,
      nome: restaurantId === 2 ? 'D8 Burger Teste' : 'Outra Loja Teste',
      slug: restaurantId === 2 ? 'd8-burger-teste' : 'outra-loja-teste',
      logo_url: '',
      banner_url: '',
      subtitulo: 'Hambúrguer artesanal',
      sobre_nos: 'Feito na hora.',
      endereco: 'Rua Central, 50 - Centro',
      google_maps_url: '',
      status_override: 'Forçado Aberto',
      aceitando_pedidos: true,
      delivery_ativo: true,
      retirada_ativa: true,
      pagamento_online_ativo: true,
      pix_proprio: pixDirect,
      formas_pagamento_aceitas: ['Pix', 'Dinheiro', 'Cartão de crédito'],
    },
    categorias: [{ id: 10, nome: 'Burgers' }],
    produtos: [
      {
        id: 101,
        nome: 'Classic Burger',
        descricao: 'Pão brioche, blend 150g e cheddar.',
        preco: burgerPrice,
        imagem_url: '',
        imagens_galeria: [],
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
          {
            id: 'extras',
            nome: 'Extras',
            min_selecoes: 0,
            max_selecoes: 2,
            tipo: 'opcional',
            opcoes: [
              { id: 'bacon', nome: 'Bacon', preco_adicional: baconPrice, ativo: true },
            ],
          },
        ],
      },
    ],
  };
}

test.describe('B3.2/B3.3 — retomada segura do rascunho e simplificação do checkout', () => {
  test('recarregar preserva rascunho por restaurante, revalida preços vivos e isola outro restaurante', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let currentBurgerPrice = 28;
    let currentBaconPrice = 5;

    await page.routeWebSocket('**/ws/**', () => {});
    await page.route(`${API_ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/cardapio-digital/public') {
        const rid = Number(url.searchParams.get('restaurante_id') || 2);
        await route.fulfill({
          status: 200,
          json: makeMenuPayload({
            restaurantId: rid,
            burgerPrice: currentBurgerPrice,
            baconPrice: currentBaconPrice,
          }),
        });
        return;
      }
      if (url.pathname === '/api/cardapio-digital/populares') {
        await route.fulfill({ status: 200, json: { produtos: [] } });
        return;
      }
      await route.fulfill({ status: 200, json: {} });
    });

    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
    await page.locator('#product-card-101').click();
    await page.getByRole('checkbox', { name: 'Selecionar Ao ponto' }).check();
    const baconBtn = page.locator('#product-details-modal').getByRole('button', { name: 'Adicionar uma unidade de Bacon', exact: true });
    if (!(await baconBtn.isVisible())) {
      await page.locator('#product-details-modal').getByRole('button', { name: /Extras/i }).click();
    }
    await baconBtn.click();
    await page.locator('#notes-textarea').fill('Sem picles');
    await page.locator('#btn-add-to-cart-action').click();

    // Abrir sacola e escolher Retirada
    await page.locator('#mobile-nav-cart').click();
    const cart = page.locator('#cart-drawer-container');
    await expect(cart).toBeVisible();
    await cart.getByRole('button', { name: 'Receber', exact: true }).click();
    await cart.getByRole('button', { name: /Retirada/i }).first().click();

    // 1. Recarga simples preserva item, opções, observação e modalidade.
    await page.reload();
    await page.locator('#mobile-nav-cart').click();
    await expect(cart).toBeVisible();
    await expect(cart).toContainText('Classic Burger');
    await expect(cart).toContainText('Ao ponto');
    await expect(cart).toContainText('Bacon');
    await expect(cart).toContainText('Sem picles');
    await expect(cart).toContainText('R$ 33,00');
    await cart.getByRole('button', { name: 'Receber', exact: true }).click();
    await expect(cart.getByRole('button', { name: /Retirada/i }).first()).toHaveAttribute('aria-pressed', 'true');

    // 2. Recarga com preço atualizado no servidor nunca confia no preço salvo e avisa o cliente.
    currentBurgerPrice = 32;
    currentBaconPrice = 6;
    await page.reload();
    await page.locator('#mobile-nav-cart').click();
    await expect(cart).toBeVisible();
    await expect(cart.locator('#cart-draft-restore-notice')).toBeVisible();
    await expect(cart).toContainText('R$ 38,00');
    await expect(cart).not.toContainText('R$ 33,00');

    // 3. Outro restaurante não herda o rascunho da loja 2.
    await page.goto('/cardapio?restaurante_id=999&vitrine=artistic-total');
    await page.locator('#mobile-nav-cart').click();
    await expect(cart).toContainText('Sua sacola está vazia');
  });

  test('checkout elimina CTAs duplicados, distingue Pix próprio e Voltar após confirmação não reabre sacola nem reenvia', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let postCount = 0;

    await page.routeWebSocket('**/ws/**', () => {});
    await page.route(`${API_ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/cardapio-digital/public') {
        await route.fulfill({ status: 200, json: makeMenuPayload({ restaurantId: 2, pixDirect: true }) });
        return;
      }
      if (url.pathname === '/api/cardapio-digital/populares') {
        await route.fulfill({ status: 200, json: { produtos: [] } });
        return;
      }
      if (url.pathname === '/cardapio/pedidos' && route.request().method() === 'POST') {
        postCount += 1;
        await route.fulfill({
          status: 201,
          json: {
            comanda_id: 'ord-777',
            numero_pedido: 777,
            total: 28,
            pagamento: {
              status: 'pending',
              cobranca_online: true,
              confirmacao_manual: true,
              qr_code: '00020126330014BR.GOV.BCB.PIX0111123456789015204000053039865802BR5910D8BURGER6009FORTALEZA62070503***6304ABCD',
            },
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

    await page.locator('#mobile-nav-cart').click();
    const cart = page.locator('#cart-drawer-container');
    await expect(cart).toBeVisible();

    // Avançar para Receber pelo único CTA do rodapé
    await cart.locator('#btn-confirm-order').click();
    await cart.getByRole('button', { name: /Retirada/i }).first().click();
    // Não deve existir botão duplicado "Continuar para pagamento" dentro da seção
    await expect(cart.locator('#cart-receive-methods-content').getByRole('button', { name: /Continuar/i })).toHaveCount(0);

    // Avançar para Pagamento -> selecionar Pix (Pix próprio não exige e-mail)
    await cart.locator('#btn-confirm-order').click();
    await cart.getByRole('button', { name: 'Pix', exact: true }).click();
    await expect(cart.locator('#cart-payment-methods-content').getByRole('button', { name: /Continuar/i })).toHaveCount(0);

    // Avançar para Contato
    await cart.locator('#btn-confirm-order').click();
    await expect(cart.locator('#input-customer-email')).toHaveCount(0);
    await cart.locator('#input-guest-phone').fill('85999999999');
    await cart.locator('#input-guest-name').fill('Cliente B3');
    await cart.getByRole('button', { name: 'Revisar pedido', exact: true }).click();

    // Revisão final: Pix próprio deve explicar confirmação manual do restaurante
    const checkout = page.locator('#checkout-card');
    await expect(checkout).toBeVisible();
    await expect(checkout).toContainText('antecipado via Pix');
    await expect(checkout).toContainText('equipe confirma o recebimento');

    // Confirmar pedido
    await page.locator('#btn-place-order-final').click();
    await expect(checkout).toContainText('Pedido #777');
    expect(postCount).toBe(1);

    // Rascunho deve ter sido limpo imediatamente após criação do pedido
    const storedDraft = await page.evaluate(() => sessionStorage.getItem('koma_cart_draft:2'));
    expect(storedDraft).toBeNull();

    // Voltar após confirmação não reabre a sacola nem reenvia o pedido
    await page.goBack();
    await expect(checkout).toHaveCount(0);
    await expect(cart).toBeHidden();
    expect(postCount).toBe(1);

    // Abrir sacola novamente confirma que está vazia
    await page.locator('#mobile-nav-cart').click();
    await expect(cart).toContainText('Sua sacola está vazia');
  });
});
