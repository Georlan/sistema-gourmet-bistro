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

test('guest contact is tab-scoped without a remember checkbox and never crosses restaurants', async ({ context, page }) => {
  await mockMenu(context);
  const cart = await openContact(page);
  await expect(cart.getByRole('checkbox', { name: /Lembrar meu nome/ })).toHaveCount(0);
  await cart.locator('#input-guest-name').fill('Ana Teste');
  await cart.locator('#input-guest-phone').fill('85999991111');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_guest_checkout:2'))).not.toBeNull();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('koma_remembered_contact:2'))).toBeNull();
  await page.close();
  const next = await context.newPage();
  const returning = await openContact(next, 2, true);
  await expect(returning.locator('#input-guest-phone')).toHaveValue('');
  await expect(returning.locator('#input-guest-name')).toHaveValue('');
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
  await expect(page.getByRole('button', { name: /Acompanhar pedido/ })).toBeVisible();
  await page.getByRole('button', { name: 'Criar conta com meus dados', exact: true }).click();
  await expect(page.locator('#customer-register-name')).toHaveValue('Ana Teste');
  await page.screenshot({ path: `/tmp/koma-account-register-${testInfo.project.name}.png` });
  await expect(page.locator('#customer-register-phone')).toHaveValue('(85) 99999-1111');
  await expect(page.getByRole('checkbox', { name: /Lembrar meu nome/ })).toHaveCount(0);
  await page.locator('#customer-register-email').fill('ana@example.com');
  await page.locator('#customer-register-password').fill('SenhaSegura123');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByText('Confira seu e-mail', { exact: true })).toBeVisible();
  expect(registration).toMatchObject({ restaurante_id: 2, nome: 'Ana Teste', telefone: '85999991111', email: 'ana@example.com' });
  expect(orders).toBe(1);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_guest_checkout:2'))).not.toBeNull();
});


test('verified browser account restores across tabs, isolates tenants, and signs out in every tab', async ({ context, page }) => {
  await mockMenu(context);
  const restoredProfile = {
    id: 'cliente-ana', nome: 'Ana Teste', telefone: '85999991111',
    email: 'ana@example.test', endereco: '', saldo_pontos: 3,
    saldo_cashback: 0, telefone_verificado: true, email_verificado: true,
  };
  let restoredCalls = 0;
  let logoutCalls = 0;
  await context.route('http://127.0.0.1:8000/cardapio/clientes/sessao?**', route => {
    const id = new URL(route.request().url()).searchParams.get('restaurante_id');
    restoredCalls++;
    return id === '2'
      ? route.fulfill({ status: 200, json: { access_token: 'customer-session-test', cliente: restoredProfile } })
      : route.fulfill({ status: 204 });
  });
  await context.route('http://127.0.0.1:8000/cardapio/clientes/sessao/sair?**', route => {
    expect(route.request().headers()['x-koma-session-action']).toBe('logout');
    logoutCalls++;
    return route.fulfill({ status: 204 });
  });

  await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
  await expect(page.locator('#btn-user-profile:visible, #mobile-nav-account:visible').first()).toHaveAttribute('aria-label', 'Ana Teste');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_customer_session:2'))).not.toBeNull();
  await expect(page.evaluate(() => localStorage.getItem('koma_customer_session:2'))).resolves.toBeNull();

  const secondTab = await context.newPage();
  await secondTab.goto('/c/loja-2?vitrine=artistic-total');
  await expect(secondTab.locator('#btn-user-profile:visible, #mobile-nav-account:visible').first()).toHaveAttribute('aria-label', 'Ana Teste');
  await expect.poll(() => restoredCalls).toBeGreaterThanOrEqual(2);

  const other = await context.newPage();
  await other.goto('/cardapio?restaurante_id=999&vitrine=artistic-total');
  await expect(other.locator('#btn-login-trigger:visible, #mobile-nav-account:visible').first()).toBeVisible();
  await expect(other.locator('#btn-login-trigger:visible, #mobile-nav-account:visible').first()).toHaveAttribute('aria-label', 'Minha conta');
  await expect(other.evaluate(() => sessionStorage.getItem('koma_customer_session:999'))).resolves.toBeNull();

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#btn-user-profile:visible, #mobile-nav-account:visible').first().click();
  await page.locator('#user-profile-overlay').getByRole('button', { name: /Sair/ }).click();
  await expect(page.locator('#btn-login-trigger:visible, #mobile-nav-account:visible').first()).toHaveAttribute('aria-label', 'Minha conta');
  await expect(secondTab.locator('#btn-login-trigger:visible, #mobile-nav-account:visible').first()).toHaveAttribute('aria-label', 'Minha conta');
  await expect.poll(() => logoutCalls).toBe(1);

  const beforeNextTab = restoredCalls;
  const nextTab = await context.newPage();
  await nextTab.goto('/c/loja-2?vitrine=artistic-total');
  await expect(nextTab.locator('#btn-login-trigger:visible, #mobile-nav-account:visible').first()).toHaveAttribute('aria-label', 'Minha conta');
  await expect.poll(() => nextTab.evaluate(() => localStorage.getItem('koma_customer_signed_out:2'))).toBe('1');
  expect(restoredCalls).toBe(beforeNextTab);
});
