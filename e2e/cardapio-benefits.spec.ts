import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

const publicMenuPayload = {
  restaurante: {
    id: 2,
    nome: 'Pizzeria Bella Italia',
    slug: 'bella-italia',
    logo_url: '',
    banner_url: '',
    subtitulo: 'Pizza artesanal no forno a lenha',
    sobre_nos: 'Pizzas artesanais preparadas na hora.',
    endereco: 'Av. Principal, 100 - Centro',
    google_maps_url: '',
    status_override: 'Forçado Aberto',
    delivery_ativo: true,
    pagamento_online_ativo: false,
    formas_pagamento_aceitas: ['Dinheiro'],
  },
  categorias: [{ id: 10, nome: 'Pizzas' }],
  produtos: [
    {
      id: 101,
      nome: 'Pizza Margherita',
      descricao: 'Muçarela e manjericão.',
      preco: 48,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 10,
      grupos_modificadores: [],
    },
  ],
};

async function mockCardapio(page: Page, benefits: any | (() => any), enabled = true) {
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());

    if (pathname === '/api/cardapio-digital/public') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...publicMenuPayload, restaurante: {
          ...publicMenuPayload.restaurante, aceitando_pedidos: true,
          beneficios: { coupons: enabled, loyalty: enabled, cashback: enabled },
        } }),
      });
      return;
    }

    if (pathname === '/api/cardapio-digital/populares') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ produtos: [] }),
      });
      return;
    }

    if (pathname === '/cardapio/cupons/beneficios') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(typeof benefits === 'function' ? benefits() : benefits),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

test('Benefícios refletem configuração alterada no Caixa ao reabrir o painel', async ({ page }) => {
  let conversion = 2;
  await mockCardapio(page, () => ({
    cupons: [],
    programa: { ativo: true, tipo_recompensa: 'CASHBACK', taxa_conversao: conversion, valor_ponto_em_dinheiro: 0 },
  }));
  await openBenefits(page);
  await page.getByRole('button', { name: 'Créditos' }).click();
  await expect(page.locator('#cardapio-benefits-credit')).toContainText('2%');
  await page.getByRole('button', { name: 'Fechar benefícios' }).click();

  conversion = 4;
  await page.locator((page.viewportSize()?.width || 0) <= 640 ? '#mobile-nav-benefits' : '#btn-benefits-header').click();
  await page.getByRole('button', { name: 'Créditos' }).click();
  await expect(page.locator('#cardapio-benefits-credit')).toContainText('4%');
});

async function openBenefits(page: Page) {
  await page.goto('/cardapio?restaurante_id=2');
  await page.locator((page.viewportSize()?.width || 0) <= 640 ? '#mobile-nav-benefits' : '#btn-benefits-header').click();
  await expect(page.locator('#cardapio-benefits-drawer')).toBeVisible();
}

test('Cardápio expõe oferta e regra de cashback sem vazar a matemática interna do restaurante', async ({ page }) => {
  await mockCardapio(page, {
    cupons: [
      {
        codigo: 'VOLTA5',
        tipo_desconto: 'fixo',
        valor_desconto: 5,
        valor_minimo_pedido: 50,
        valido_ate: null,
        apenas_primeira_compra: false,
      },
    ],
    programa: {
      ativo: true,
      tipo_recompensa: 'CASHBACK',
      taxa_conversao: 4.25,
      valor_ponto_em_dinheiro: 0,
    },
  });

  await openBenefits(page);

  const drawer = page.locator('#cardapio-benefits-drawer');
  await expect(page.locator('#cardapio-benefits-offers')).toContainText('VOLTA5');
  await expect(page.locator('#cardapio-benefits-offers')).toContainText(/R\$\s*5,00 de economia/);
  await expect(page.locator('#cardapio-benefits-offers')).toContainText(/R\$\s*50,00/);

  await drawer.getByRole('button', { name: 'Créditos' }).click();
  await expect(page.locator('#cardapio-benefits-credit')).toContainText('4,25%');

  await drawer.getByRole('button', { name: 'Pontos' }).click();
  await expect(page.locator('#cardapio-benefits-points')).toContainText('Seus pontos anteriores permanecem');

  await expect(drawer).not.toContainText('Split KÔMA');
  await expect(drawer).not.toContainText('Teto calculado');
  await expect(drawer).not.toContainText('Margem estimada');
});

test('Cardápio explica a regra de pontos configurada pelo restaurante', async ({ page }) => {
  await mockCardapio(page, {
    cupons: [],
    programa: {
      ativo: true,
      tipo_recompensa: 'PONTOS',
      taxa_conversao: 1,
      valor_ponto_em_dinheiro: 0.05,
    },
  });

  await openBenefits(page);

  const drawer = page.locator('#cardapio-benefits-drawer');
  await drawer.getByRole('button', { name: 'Pontos' }).click();
  const points = page.locator('#cardapio-benefits-points');
  await expect(points).toContainText(/Cada R\$ 1 elegível gera 1 ponto\(s\)/);
  await expect(points).toContainText(/R\$\s*0,05/);

  await drawer.getByRole('button', { name: 'Créditos' }).click();
  await expect(page.locator('#cardapio-benefits-credit')).toContainText('não está acumulando');
});


test('sem benefícios habilitados não mostra acesso nem cupom na sacola', async ({ page }) => {
  let benefitRequests = 0;
  await mockCardapio(page, { cupons: [], programa: null }, false);
  page.on('request', request => { if (request.url().includes('/cupons/')) benefitRequests++; });
  await page.goto('/cardapio?restaurante_id=2');
  await expect(page.locator('#btn-benefits-header, #mobile-nav-benefits')).toHaveCount(0);
  await page.locator('.cardapio-product-card__details-hitbox').first().click();
  await page.locator('#product-details-modal').getByRole('button', { name: /Adicionar/ }).click();
  if (!(await page.locator('#cart-drawer-container').isVisible())) {
    await page.locator('#mobile-nav-cart:visible, #btn-cart-header:visible').first().click();
  }
  await expect(page.locator('#cart-drawer-container')).toBeVisible();
  await expect(page.locator('#cart-discounts')).toHaveCount(0);
  await expect(page.getByLabel('Código do cupom')).toHaveCount(0);
  expect(benefitRequests).toBe(0);
});
