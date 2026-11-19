import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

const burgerMenuPayload = {
  restaurante: {
    id: 2,
    nome: 'D8 Burger Teste',
    slug: 'd8-burger-teste',
    logo_url: '',
    banner_url: '',
    subtitulo: 'Hambúrguer artesanal na brasa',
    sobre_nos: 'Feito na hora.',
    endereco: 'Rua Central, 50 - Centro',
    google_maps_url: '',
    status_override: 'Forçado Aberto',
    aceitando_pedidos: true,
    delivery_ativo: true,
    pagamento_online_ativo: false,
    formas_pagamento_aceitas: ['Dinheiro', 'Pix', 'Cartão de crédito'],
    recomendacoes_sacola_ids: ['201', '202', '301'],
  },
  categorias: [
    { id: 10, nome: 'Burgers' },
    { id: 20, nome: 'Acompanhamentos' },
    { id: 30, nome: 'Bebidas' },
  ],
  produtos: [
    {
      id: 101,
      nome: 'Classic Burger',
      descricao: 'Pão brioche, blend 150g e cheddar.',
      preco: 28,
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
            { id: 'ponto-mal', nome: 'Ao ponto', preco_adicional: 0, ativo: true },
            { id: 'ponto-bem', nome: 'Bem passado', preco_adicional: 0, ativo: true },
          ],
        },
      ],
    },
    {
      id: 201,
      nome: 'Batata Rústica',
      descricao: 'Porção crocante com páprica.',
      preco: 18,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 20,
      grupos_modificadores: [
        {
          id: 'molho',
          nome: 'Escolha o molho',
          min_selecoes: 1,
          max_selecoes: 1,
          tipo: 'obrigatorio',
          opcoes: [
            { id: 'molho-bacon', nome: 'Maionese de bacon', preco_adicional: 3, ativo: true },
            { id: 'molho-ervas', nome: 'Maionese de ervas', preco_adicional: 0, ativo: true },
          ],
        },
      ],
    },
    {
      id: 202,
      nome: 'Refrigerante Lata',
      descricao: '350ml bem gelado.',
      preco: 7,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 30,
      grupos_modificadores: [],
    },
    {
      id: 301,
      nome: 'Milkshake 300ml',
      descricao: 'Batido na hora.',
      preco: 16,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 30,
      familia_id: 'fam-milkshake',
      familia_nome: 'Milkshake Artesanal',
      familia_eixo: 'sabor',
      variacao_nome: 'Chocolate',
      grupos_modificadores: [],
    },
    {
      id: 302,
      nome: 'Milkshake Morango 300ml',
      descricao: 'Batido na hora.',
      preco: 18,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 30,
      familia_id: 'fam-milkshake',
      familia_nome: 'Milkshake Artesanal',
      familia_eixo: 'sabor',
      variacao_nome: 'Morango',
      grupos_modificadores: [],
    },
  ],
};

async function mockCardapio(page: Page) {
  await page.routeWebSocket('**/ws/**', () => {});
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/cardapio-digital/public') {
      await route.fulfill({ status: 200, json: burgerMenuPayload });
      return;
    }
    if (pathname === '/api/cardapio-digital/populares') {
      await route.fulfill({
        status: 200,
        json: { produtos: [{ produto_id: '101', escolhas: 12 }, { produto_id: '201', escolhas: 9 }] },
      });
      return;
    }
    await route.fulfill({ status: 200, json: {} });
  });
}

test.describe('B3.2 — retorno das sugestões e preservação da origem', () => {
  test('mobile 390px: sugestão configurável e família abertas pela sacola retornam à sacola ao confirmar, fechar por X, Escape e Voltar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCardapio(page);
    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');

    const initialUrl = page.url();

    // 1. Adicionar um produto configurável pelo catálogo -> deve permanecer no catálogo no mobile.
    await page.locator('#product-card-101').click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Selecionar Ao ponto' }).check();
    await page.locator('#btn-add-to-cart-action').click();
    await expect(page.locator('#product-details-modal')).toHaveCount(0);
    await expect(page.locator('#cart-drawer-container')).toBeHidden();

    // 2. Abrir a sacola e preencher modalidade + contato para comprovar preservação de estado.
    await page.locator('#mobile-nav-cart').click();
    const cart = page.locator('#cart-drawer-container');
    await expect(cart).toBeVisible();
    await cart.getByRole('button', { name: 'Receber', exact: true }).click();
    await cart.getByRole('button', { name: /Retirada/i }).first().click();

    // Voltar para aba Itens onde ficam as sugestões.
    await cart.getByRole('button', { name: 'Itens', exact: true }).click();

    // 3. Sugestão simples (Refrigerante Lata) adiciona direto sem fechar a sacola.
    const simpleSuggestionBtn = cart.locator('#btn-upsell-add-202');
    await expect(simpleSuggestionBtn).toBeVisible();
    await simpleSuggestionBtn.click();
    await expect(page.locator('#product-details-modal')).toHaveCount(0);
    await expect(cart).toBeVisible();
    await expect(cart).toContainText('Refrigerante Lata');

    // 4. Sugestão configurável (Batata Rústica): fechar pelo X retorna à sacola.
    const rusticBtn = cart.locator('#btn-upsell-add-201');
    await expect(rusticBtn).toBeVisible();
    await rusticBtn.click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    await expect(page.locator('#modal-product-name')).toHaveText('Batata Rústica');

    await page.locator('#btn-close-modal').click();
    await expect(page.locator('#product-details-modal')).toHaveCount(0);
    await expect(cart).toBeVisible();

    // 5. Mesma sugestão configurável: fechar por Escape retorna à sacola.
    await rusticBtn.click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#product-details-modal')).toHaveCount(0);
    await expect(cart).toBeVisible();

    // 6. Mesma sugestão configurável: usar Voltar do navegador retorna à sacola sem mudar URL.
    await rusticBtn.click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#product-details-modal')).toHaveCount(0);
    await expect(cart).toBeVisible();
    expect(page.url()).toBe(initialUrl);

    // 7. Confirmar a sugestão configurável retorna à sacola com o novo item e preserva os anteriores.
    await rusticBtn.click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Selecionar Maionese de bacon' }).check();
    await page.locator('#notes-textarea').fill('Bem crocante');
    await page.locator('#btn-add-to-cart-action').click();
    await expect(page.locator('#product-details-modal')).toHaveCount(0);
    await expect(cart).toBeVisible();
    await expect(cart).toContainText('Batata Rústica');
    await expect(cart).toContainText('Maionese de bacon');
    await expect(cart).toContainText('Bem crocante');
    await expect(cart).toContainText('Classic Burger');

    // 8. Sugestão de família (Milkshake Artesanal): abrir, escolher sabor e confirmar retorna à sacola.
    const familyBtn = cart.getByRole('button', { name: /Adicionar Milkshake Artesanal/i });
    await expect(familyBtn).toBeVisible();
    await familyBtn.click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    await page.getByRole('button', { name: /Morango/i }).click();
    await page.locator('#btn-add-to-cart-action').click();
    await expect(page.locator('#product-details-modal')).toHaveCount(0);
    await expect(cart).toBeVisible();
    await expect(cart).toContainText('Milkshake Morango 300ml');

    // 9. Verificar que a modalidade Retirada foi preservada na sacola.
    await cart.getByRole('button', { name: 'Receber', exact: true }).click();
    await expect(cart.getByRole('button', { name: /Retirada/i }).first()).toHaveAttribute('aria-pressed', 'true');
    await cart.getByRole('button', { name: 'Itens', exact: true }).click();

    // 10. Editar item na sacola e cancelar por X não altera o item original.
    await cart.getByRole('button', { name: 'Editar montagem de Classic Burger', exact: true }).click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Selecionar Bem passado' }).check();
    await page.locator('#btn-close-modal').click();
    await expect(cart).toBeVisible();
    await expect(cart).toContainText('Ao ponto');
    await expect(cart).not.toContainText('Bem passado');

    // 11. Segundo Voltar fecha a sacola e mantém o usuário no cardápio.
    await page.goBack();
    await expect(cart).toBeHidden();
    expect(page.url()).toBe(initialUrl);
  });

  test('mobile 390px: sacola vazia com sugestão configurável retorna à sacola ao cancelar e ao confirmar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCardapio(page);
    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');

    await page.locator('#mobile-nav-cart').click();
    const cart = page.locator('#cart-drawer-container');
    await expect(cart).toBeVisible();
    await expect(cart).toContainText('Sua sacola está vazia');

    // Abrir sugestão configurável na sacola vazia e cancelar pelo X -> volta à sacola vazia.
    const suggestionBtn = cart.getByRole('button', { name: /Montar|Escolher opção/i }).first();
    await expect(suggestionBtn).toBeVisible();
    await suggestionBtn.click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    await page.locator('#btn-close-modal').click();
    await expect(page.locator('#product-details-modal')).toHaveCount(0);
    await expect(cart).toBeVisible();
    await expect(cart).toContainText('Sua sacola está vazia');

    // Abrir novamente, configurar e confirmar -> volta à sacola já com o item.
    await suggestionBtn.click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    await page.locator('#product-details-modal input[type="checkbox"]').first().check();
    await page.locator('#btn-add-to-cart-action').click();
    await expect(page.locator('#product-details-modal')).toHaveCount(0);
    await expect(cart).toBeVisible();
    await expect(cart).not.toContainText('Sua sacola está vazia');
  });

  test('desktop 1366px: fechar sugestão da sacola por X ou Voltar retorna à sacola', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 820 });
    await mockCardapio(page);
    await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');

    await page.locator('#product-card-101').click();
    await page.getByRole('checkbox', { name: 'Selecionar Ao ponto' }).check();
    await page.locator('#btn-add-to-cart-action').click();

    const cart = page.locator('#cart-drawer-container');
    await expect(cart).toBeVisible();

    const rusticBtn = cart.locator('#btn-upsell-add-201');
    await expect(rusticBtn).toBeVisible();
    await rusticBtn.click();
    await expect(page.locator('#product-details-modal')).toBeVisible();

    // Fechar pelo X deve devolver à sacola no desktop também.
    await page.locator('#btn-close-modal').click();
    await expect(page.locator('#product-details-modal')).toHaveCount(0);
    await expect(cart).toBeVisible();

    // Fechar pelo Voltar deve devolver à sacola no desktop também.
    await rusticBtn.click();
    await expect(page.locator('#product-details-modal')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#product-details-modal')).toHaveCount(0);
    await expect(cart).toBeVisible();
  });
});
