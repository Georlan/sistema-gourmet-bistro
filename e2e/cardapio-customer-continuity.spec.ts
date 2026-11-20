import { test, expect, BrowserContext, Page } from '@playwright/test';

async function mockMenu(context: BrowserContext) {
  await context.route('http://127.0.0.1:8000/**', async route => {
    const url = new URL(route.request().url());
    const id = Number(url.searchParams.get('restaurante_id') || 2);
    if (url.pathname === '/api/cardapio-digital/public') {
      return route.fulfill({ json: {
        restaurante: { id, nome: `Loja ${id}`, slug: `loja-${id}`, status_override: 'Forçado Aberto', aceitando_pedidos: true,
          delivery_ativo: true, retirada_ativa: true, pagamento_online_ativo: false, formas_pagamento_aceitas: ['Dinheiro'] },
        categorias: [{ id: 10, nome: 'Lanches' }],
        produtos: [{ id: 101, nome: 'Burger', preco: 28, categoria_id: 10, grupos_modificadores: [] }],
      } });
    }
    if (url.pathname === '/api/cardapio-digital/populares') return route.fulfill({ json: { produtos: [] } });
    if (url.pathname === '/cardapio/clientes/reconhecer') return route.fulfill({ json: { found: false } });
    if (url.pathname === '/cardapio/pedidos' && route.request().method() === 'POST') {
      return route.fulfill({ status: 201, json: { comanda_id: 'ord-888', numero_pedido: 888, total: 28 } });
    }
    if (url.pathname === '/cardapio/clientes/cadastro/solicitar') return route.fulfill({ status: 202, json: {} });
    return route.fulfill({ json: {} });
  });
}

async function openContact(page: Page, id = 2, useSlug = false) {
  await page.goto(useSlug ? `/c/loja-${id}?vitrine=artistic-total` : `/cardapio?restaurante_id=${id}&vitrine=artistic-total`);
  await page.locator('#product-card-101').click();
  await page.locator('#btn-add-to-cart-action').click();
  const cart = page.locator('#cart-drawer-container');
  if ((page.viewportSize()?.width || 0) < 1024) await page.locator('#mobile-nav-cart:visible, #btn-cart-header:visible').first().click();
  await expect(cart).toBeVisible();
  await cart.locator('#btn-confirm-order').click();
  await cart.getByRole('button', { name: /Retirada/i }).first().click();
  await cart.locator('#btn-confirm-order').click();
  await cart.locator('#btn-confirm-order').click();
  await expect(cart.locator('#input-guest-phone')).toBeVisible();
  return cart;
}

test('opt-in remembers contact after closing a tab, can be removed and never crosses restaurants', async ({ context, page }) => {
  await mockMenu(context);
  const cart = await openContact(page);
  const checkbox = cart.getByRole('checkbox', { name: /Lembrar meu nome/ });
  await expect(checkbox).not.toBeChecked();
  await cart.locator('#input-guest-name').fill('Ana Teste');
  await cart.locator('#input-guest-phone').fill('85999991111');
  await checkbox.check();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('koma_remembered_contact:2'))).not.toBeNull();
  await page.close();
  const next = await context.newPage();
  const returning = await openContact(next, 2, true);
  await expect(returning.locator('#input-guest-phone')).toHaveValue('(85) 99999-1111');
  await expect(returning.locator('#input-guest-name')).toHaveValue('Ana Teste');
  await expect(returning.getByRole('checkbox', { name: /Lembrar meu nome/ })).toBeChecked();
  await returning.getByRole('checkbox', { name: /Lembrar meu nome/ }).uncheck();
  await expect.poll(() => next.evaluate(() => localStorage.getItem('koma_remembered_contact:2'))).toBeNull();
  const other = await openContact(next, 999);
  await expect(other.locator('#input-guest-phone')).toHaveValue('');
});

test('post-purchase account invitation preserves the order and pre-fills registration', async ({ context, page }, testInfo) => {
  await mockMenu(context);
  let orders = 0;
  let registration: Record<string, unknown> | null = null;
  page.on('request', request => {
    if (request.url().endsWith('/cardapio/pedidos') && request.method() === 'POST') orders++;
    if (request.url().endsWith('/cadastro/solicitar')) registration = request.postDataJSON();
  });
  const cart = await openContact(page);
  await cart.locator('#input-guest-name').fill('Ana Teste');
  await cart.locator('#input-guest-phone').fill('85999991111');
  await cart.getByRole('button', { name: 'Revisar pedido', exact: true }).click();
  await page.locator('#btn-place-order-final').click();
  await expect(page.locator('#checkout-card')).toContainText('Pedido #888');
  await page.screenshot({ path: `/tmp/koma-account-success-${testInfo.project.name}.png` });
  await expect(page.getByRole('button', { name: 'Acompanhar pedido', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Criar conta com meus dados', exact: true }).click();
  await expect(page.locator('#customer-register-name')).toHaveValue('Ana Teste');
  await page.screenshot({ path: `/tmp/koma-account-register-${testInfo.project.name}.png` });
  await expect(page.locator('#customer-register-phone')).toHaveValue('(85) 99999-1111');
  await page.getByRole('checkbox', { name: /Lembrar meu nome/ }).check();
  await page.locator('#customer-register-email').fill('ana@example.com');
  await page.locator('#customer-register-password').fill('SenhaSegura123');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByText('Confira seu e-mail', { exact: true })).toBeVisible();
  expect(registration).toMatchObject({ restaurante_id: 2, nome: 'Ana Teste', telefone: '85999991111', email: 'ana@example.com' });
  expect(orders).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('koma_remembered_contact:2'))).not.toBeNull();
});
