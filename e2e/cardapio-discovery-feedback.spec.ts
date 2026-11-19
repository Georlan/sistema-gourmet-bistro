import { expect, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

const d8LikeMenuPayload = {
  restaurante: {
    id: 808,
    nome: 'D8 Burger Teste',
    slug: 'd8-burger-teste',
    logo_url: '',
    banner_url: 'http://127.0.0.1:8000/broken-banner.png',
    banner_customizado: true,
    subtitulo: 'Smash burgers artesanais na brasa',
    sobre_nos: 'Feito na hora.',
    endereco: 'Rua Central, 50 - Centro',
    google_maps_url: '',
    status_override: 'Forçado Aberto',
    aceitando_pedidos: true,
    delivery_ativo: true,
    retirada_ativa: true,
    pedido_minimo: 20,
    formas_pagamento_aceitas: ['Pix', 'Dinheiro', 'Cartão de crédito'],
  },
  categorias: [
    { id: 10, nome: 'Destaques' },
    { id: 20, nome: 'Burgers' },
    { id: 30, nome: 'Combos' },
    { id: 40, nome: 'Bebidas' },
  ],
  produtos: [
    {
      id: 101,
      nome: 'D8 Bacon',
      descricao: 'Blend 160g, cheddar duplo e bacon crocante.',
      preco: 29.9,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 10,
      grupos_modificadores: [],
    },
    {
      id: 102,
      nome: 'D8 Salad',
      descricao: 'Blend 150g, alface, tomate e maionese da casa.',
      preco: 26.9,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 20,
      grupos_modificadores: [],
    },
    {
      id: 103,
      nome: 'Combo Duplo',
      descricao: 'Dois smash burgers + batata + refri.',
      preco: 49.9,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 30,
      grupos_modificadores: [],
    },
    {
      id: 104,
      nome: 'Suco de Acerola 500ml',
      descricao: 'Natural da fruta.',
      preco: 9.9,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 40,
      grupos_modificadores: [],
    },
  ],
};

test.describe('B3.1 / B3.4 — descoberta mobile, feedback e acessibilidade', () => {
  test('mobile 390x844: banner quebrado recolhe, compartilhar não estica, CTA do herói fica visível acima do dock e Escape fecha sacola', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.routeWebSocket('**/ws/**', () => {});
    await page.route(`${API_ORIGIN}/**`, async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/api/cardapio-digital/public') {
        await route.fulfill({ status: 200, json: d8LikeMenuPayload });
        return;
      }
      if (pathname === '/api/cardapio-digital/populares') {
        await route.fulfill({ status: 200, json: { produtos: [{ produto_id: '101', escolhas: 15 }] } });
        return;
      }
      if (pathname === '/broken-banner.png') {
        await route.fulfill({ status: 404, body: 'not found' });
        return;
      }
      await route.fulfill({ status: 200, json: {} });
    });

    await page.goto('/cardapio?restaurante_id=808&vitrine=artistic-total');
    await expect(page.locator('#koma-artistic-canopy')).toBeVisible();

    // 1. Banner com imagem quebrada deve recolher para não gerar faixa escura morta.
    await expect(page.locator('#brand-banner-hero')).toHaveCount(0);

    // 2. Botão Compartilhar isolado (sem WhatsApp/Instagram) não deve ocupar a largura inteira.
    const shareBtn = page.locator('#btn-share-mobile');
    await expect(shareBtn).toBeVisible();
    const shareBox = await shareBtn.boundingBox();
    expect(shareBox).not.toBeNull();
    expect(shareBox!.width).toBeLessThanOrEqual(175);

    // 3. CTA do herói (Pedir agora) deve estar visível e clicável acima do dock inferior na carga inicial.
    const heroAction = page.locator('#btn-hero-fast-add-101');
    await expect(heroAction).toBeVisible();
    const isClearOfDock = await heroAction.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return target === el || (target !== null && el.contains(target));
    });
    expect(isClearOfDock).toBe(true);

    // 4. Sem overflow horizontal em 390px e 320px.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });

    // 5. Escape fecha a sacola aberta sem sair da página.
    await page.locator('#mobile-nav-cart').click();
    const cart = page.locator('#cart-drawer-container');
    await expect(cart).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(cart).toBeHidden();
  });
});
