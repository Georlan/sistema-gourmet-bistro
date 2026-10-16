import { expect, test } from '@playwright/test';

test('Pitulinha exclusiva não aparece avulsa, mas é montável no combo G + Pitulinha', async ({ page }) => {
  await page.route('http://127.0.0.1:8000/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/cardapio-digital/public') {
      await route.fulfill({ json: {
        restaurante: {
          id: 6, nome: 'Quentinha Caseira', subtitulo: 'Cardápio',
          status_override: 'Forçado Aberto', aceitando_pedidos: true,
          entrega_ativo: true, delivery_ativo: true,
          pagamento_online_ativo: false, formas_pagamento_aceitas: ['Dinheiro'],
        },
        categorias: [{ id: 'quentinhas', nome: 'Quentinhas' }],
        produtos: [{ id: 'g', nome: 'Quentinha G', preco: 14, categoria_id: 'quentinhas',
          grupos_modificadores: [{ id: 'proteins', nome: 'Proteínas', min_selecoes: 1,
            max_selecoes: 1, modo_selecao: 'tipos', tipo: 'obrigatorio',
            opcoes: [{ id: 'chicken', nome: 'Frango', preco_adicional: 0, ativo: true }] }],
        }],
        produtos_promocionais: [{
          id: 'pitulinha', nome: 'Pitulinha', preco: 3, categoria_id: 'bebidas',
          grupos_modificadores: [{ id: 'flavors', nome: 'Sabor da Pitchulinha', min_selecoes: 1, max_selecoes: 1, tipo: 'obrigatorio', opcoes: ['Pepsi', 'Guaraná', 'Laranja'].map((nome, index) => ({ id: `flavor-${index}`, nome, preco_adicional: 0, ativo: true })) }],
        }],
        promocoes: [{
          id: 'promo-g-pit', nome: 'Quentinha G + Pitulinha', descricao: 'Bebida no combo',
          preco: 16, componentes: [['g'], ['pitulinha']],
        }],
      } });
      return;
    }
    if (path === '/api/cardapio-digital/populares') {
      await route.fulfill({ json: { produtos: [{ produto_id: 'pitulinha', escolhas: 42 }] } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto('/cardapio?restaurante_id=6');
  await expect(page.locator('#product-card-pitulinha')).toHaveCount(0);
  await expect(page.locator('#cardapio-recommendations-home')).not.toContainText('Pitulinha');

  const promotions = page.locator('#cardapio-promotions-home');
  await expect(promotions).toBeVisible();
  await promotions.getByRole('button', { name: /Montar promoção Quentinha G \+ Pitulinha/ }).click();

  const modal = page.locator('#product-details-modal');
  await expect(modal.locator('#modal-product-name')).toHaveText('Quentinha G');
  await modal.getByRole('checkbox', { name: 'Selecionar Frango' }).check();
  await modal.getByRole('button', { name: 'Continuar para Pitulinha' }).click();
  await expect(modal.locator('#modal-product-name')).toHaveText('Pitulinha');
  await modal.getByRole('button', { name: 'Revisar promoção' }).click();
  await expect(modal.getByRole('alert')).toContainText('Confira as escolhas em Sabor da Pitchulinha');
  await expect(page.getByRole('dialog', { name: 'Quentinha G + Pitulinha' })).toHaveCount(0);
  for (const flavor of ['Pepsi', 'Guaraná', 'Laranja']) await expect(modal.getByRole('checkbox', { name: `Selecionar ${flavor}`, exact: true })).toBeVisible();
  await modal.getByRole('checkbox', { name: 'Selecionar Guaraná', exact: true }).check();
  await modal.getByRole('button', { name: 'Revisar promoção' }).click();
  const review = page.getByRole('dialog', { name: 'Quentinha G + Pitulinha' });
  await expect(review).toContainText('R$ 16,00');
  await review.getByRole('button', { name: 'Adicionar promoção' }).click();
  const cart = page.locator('#cart-drawer-container');
  if (!await cart.isVisible()) await page.locator('#btn-cart-header').click();
  await expect(cart).toContainText('Quentinha G + Pitulinha');
  await expect(cart).toContainText('R$ 16,00');
  await expect(cart).toContainText('Guaraná');
});
