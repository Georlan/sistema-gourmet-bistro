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

const couponChoices = {
  cupons: [
    { codigo: 'CUPOM5', tipo_desconto: 'fixo', valor_desconto: 5, valor_minimo_pedido: 0 },
    { codigo: 'CUPOM10', tipo_desconto: 'fixo', valor_desconto: 10, valor_minimo_pedido: 0 },
  ],
  programa: null,
};

async function prepareCouponCart(page: Page) {
  await page.goto('/cardapio?restaurante_id=2');
  await page.locator('#btn-fast-add-101').click();
  if (!(await page.locator('#cart-drawer-container').isVisible())) {
    await page.locator('#mobile-nav-cart:visible, #btn-cart-header:visible').first().click();
  }
  const cart = page.locator('#cart-drawer-container');
  await cart.getByRole('button', { name: 'Contato', exact: true }).click();
  await cart.locator('#input-guest-phone').fill('85999999999');
  await cart.getByRole('button', { name: 'Cupom', exact: true }).click();
  return cart;
}

async function chooseBenefitCoupon(page: Page, code: string) {
  await page.locator('#mobile-nav-benefits:visible, #btn-benefits-header:visible').first().click();
  const offers = page.locator('#cardapio-benefits-offers');
  await offers.locator('article').filter({ hasText: code }).getByRole('button', { name: 'Usar na sacola' }).click();
  await page.locator('#cart-drawer-container').getByRole('button', { name: 'Cupom', exact: true }).click();
}

test('trocar oferta externa limpa o cupom aplicado sem perder celular ou produtos', async ({ page }) => {
  await mockCardapio(page, couponChoices);
  const validated: string[] = [];
  await page.route('**/cardapio/cupons/validar', async route => {
    const code = route.request().postDataJSON().codigo;
    validated.push(code);
    await route.fulfill({ json: { valido: true, codigo: code, desconto_calculado: code === 'CUPOM5' ? 5 : 10, mensagem: 'Cupom aceito' } });
  });
  const cart = await prepareCouponCart(page);
  await cart.getByRole('button', { name: 'Fechar sacola' }).click();
  await chooseBenefitCoupon(page, 'CUPOM5');
  await cart.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(cart.getByText('CUPOM5', { exact: true })).toBeVisible();
  await expect(cart.getByText(/R\$\s*43,00/, { exact: true })).toBeVisible();
  await cart.getByRole('button', { name: 'Fechar sacola' }).click();
  await chooseBenefitCoupon(page, 'CUPOM10');
  await expect(cart.getByLabel('Código do cupom')).toHaveValue('CUPOM10');
  await expect(cart.getByRole('button', { name: 'Remover cupom' })).toHaveCount(0);
  await expect(cart.getByText(/R\$\s*43,00/, { exact: true })).toHaveCount(0);
  await expect(cart.locator('#input-guest-phone')).toHaveValue('(85) 99999-9999');
  await expect(cart.locator('[id^="cart-item-"]')).toHaveCount(1);
  await cart.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(cart.getByText('CUPOM10', { exact: true })).toBeVisible();
  await expect(cart.getByText(/R\$\s*38,00/, { exact: true })).toBeVisible();
  expect(validated).toEqual(['CUPOM5', 'CUPOM10']);
});

test('resposta atrasada do cupom anterior não aplica desconto após trocar o código', async ({ page }) => {
  await mockCardapio(page, couponChoices);
  let release!: () => void;
  const heldResponse = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/cardapio/cupons/validar', async route => {
    requested = true;
    await heldResponse;
    await route.fulfill({ json: { valido: true, codigo: 'CUPOM5', desconto_calculado: 5, mensagem: 'Cupom aceito' } });
  });
  const cart = await prepareCouponCart(page);
  const code = cart.getByLabel('Código do cupom');
  await code.fill('CUPOM5');
  await cart.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await code.fill('CUPOM10');
  release();
  await expect(cart.getByRole('button', { name: 'Aplicar', exact: true })).toBeEnabled();
  await expect(code).toHaveValue('CUPOM10');
  await expect(cart.getByRole('button', { name: 'Remover cupom' })).toHaveCount(0);
  await expect(cart.getByText(/R\$\s*43,00/, { exact: true })).toHaveCount(0);
});
