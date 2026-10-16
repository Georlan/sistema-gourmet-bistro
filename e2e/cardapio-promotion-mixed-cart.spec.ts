import { expect, test } from '@playwright/test';

test('combo e quentinha avulsa enviam composição separada no checkout', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T15:00:00Z') });
  await page.route('http://127.0.0.1:8000/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/cardapio/pedidos' && route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      expect(payload.promocao_item_indices).toEqual([0, 1]);
      expect(payload.itens.map((item: { produto_id: string }) => item.produto_id)).toEqual(['g', 'm', 'm']);
      await route.fulfill({ status: 201, json: { comanda_id: 'fixture-mixed', numero_pedido: 318, total: 32 } });
      return;
    }
    if (path === '/api/cardapio-digital/public') {
      await route.fulfill({ json: {
        restaurante: {
          id: 6, nome: 'Quentinha Caseira', subtitulo: 'Cardápio', status_override: 'Forçado Aberto',
          aceitando_pedidos: true, entrega_ativo: true, delivery_ativo: true, retirada_ativa: true,
          pagamento_online_ativo: false, formas_pagamento_aceitas: ['Dinheiro'],
        },
        categorias: [{ id: 'quentinhas', nome: 'Quentinhas' }],
        produtos: [
          { id: 'g', nome: 'Quentinha G', preco: 14, categoria_id: 'quentinhas',
            grupos_modificadores: [{ id: 'proteins', nome: 'Proteínas', min_selecoes: 1,
              max_selecoes: 1, modo_selecao: 'tipos', tipo: 'obrigatorio',
              opcoes: [{ id: 'chicken', nome: 'Frango', preco_adicional: 0, ativo: true }] }] },
          { id: 'm', nome: 'Quentinha M', preco: 10, categoria_id: 'quentinhas',
            grupos_modificadores: [{ id: 'salad', nome: 'Saladas', min_selecoes: 1,
              max_selecoes: 1, modo_selecao: 'tipos', tipo: 'obrigatorio',
              opcoes: [{ id: 'lettuce', nome: 'Alface', preco_adicional: 0, ativo: true }] }] },
        ],
        promocoes: [{
          id: 'promo-gm', nome: 'Quentinha G + Quentinha M', descricao: 'Duas quentinhas',
          preco: 22, componentes: [['g'], ['m']], fim_em: '2026-10-16T15:01:00Z',
        }],
      } });
      return;
    }
    if (path === '/api/cardapio-digital/populares') {
      await route.fulfill({ json: { produtos: [] } }); return;
    }
    await route.fulfill({ json: {} });
  });
  await page.goto('/cardapio?restaurante_id=6');
  const promotions = page.locator('#cardapio-promotions-home');
  await expect(promotions).toBeVisible();
  await promotions.getByRole('button', { name: /Montar promoção Quentinha G \+ Quentinha M/ }).click();
  const modal = page.locator('#product-details-modal');
  await expect(modal.locator('#modal-product-name')).toHaveText('Quentinha G');
  await modal.getByRole('checkbox', { name: 'Selecionar Frango' }).check();
  await modal.getByRole('button', { name: 'Continuar para Quentinha M' }).click();
  await expect(modal.locator('#modal-product-name')).toHaveText('Quentinha M');
  await modal.getByRole('checkbox', { name: 'Selecionar Alface' }).check();
  await modal.getByRole('button', { name: 'Revisar promoção' }).click();
  await expect(page.getByRole('heading', { name: 'Quentinha G + Quentinha M' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Quentinha G + Quentinha M' })).toContainText('R$ 22,00');
  await page.getByRole('button', { name: 'Adicionar promoção' }).click();
  const cart = page.locator('#cart-drawer-container');
  if (!await cart.isVisible()) await page.locator('#btn-cart-header').click();
  await expect(cart).toContainText('Quentinha G + Quentinha M');
  await expect(cart).toContainText('R$ 22,00');
  await cart.getByRole('button', { name: 'Fechar sacola' }).click();
  await page.getByRole('button', { name: 'Quentinha M, R$ 10,00, ver detalhes', exact: true }).click();
  await modal.getByRole('checkbox', { name: 'Selecionar Alface' }).check();
  await modal.getByRole('button', { name: /Adicionar/ }).click();
  if (!await cart.isVisible()) await page.locator('#mobile-nav-cart:visible, #btn-cart-header:visible').first().click();
  await expect(cart).toContainText('R$ 32,00');
  await cart.locator('#btn-confirm-order').click();
  await cart.getByRole('button', { name: /^Retirada/ }).click();
  await cart.locator('#btn-confirm-order').click();
  await cart.getByRole('button', { name: 'Dinheiro', exact: true }).click();
  await cart.locator('#btn-confirm-order').click();
  await cart.locator('#input-guest-name').fill('Fixture local');
  await cart.locator('#input-guest-phone').fill('85999999999');
  await cart.locator('#btn-confirm-order').click();
  await page.locator('#btn-place-order-final').click();
  await expect(page.locator('#checkout-card')).toContainText('Pedido recebido');
});
