import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('PagBank informa preparação sem oferecer uma conexão falsa', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.route('**/payments/pagbank/status', route => route.fulfill({ json: {
    provider: 'pagbank', configured: false, connected: false, environment: 'sandbox', status: 'disconnected',
  } }));
  await page.goto('/?view=caixa&pagbank=cancelled');
  await expect(page.getByRole('heading', { name: 'PagBank', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conexão em preparação' })).toBeDisabled();
  await expect(page.getByText('A KÔMA precisa concluir o cadastro da aplicação no PagBank')).toBeVisible();
});

test('PagBank em sandbox comunica teste e rejeita redirecionamento estranho', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.route('**/payments/pagbank/status', route => route.fulfill({ json: {
    provider: 'pagbank', configured: true, connected: false, environment: 'sandbox', status: 'disconnected',
  } }));
  await page.route('**/payments/pagbank/connect', route => route.fulfill({ json: { authorization_url: 'https://attacker.example/oauth2/authorize' } }));
  await page.goto('/?view=caixa&pagbank=cancelled');
  await expect(page.getByText('Ambiente de testes: esta conexão não recebe dinheiro real.')).toBeVisible();
  await page.getByRole('button', { name: 'Conectar PagBank' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'URL de autorização do PagBank inválida.' })).toBeVisible();
  expect(page.url()).not.toContain('attacker.example');
});

test('retorno autorizado conclui uma vez pela sessão KÔMA e limpa o código da URL', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => sessionStorage.setItem('koma_pagbank_oauth_state', 'expected-state'));
  let completions = 0;
  let connected = false;
  await page.route('**/payments/pagbank/complete', async route => {
    completions++;
    expect(route.request().postDataJSON()).toEqual({ code: 'one-use-code', state: 'expected-state' });
    expect(route.request().headers()['authorization']).toBeTruthy();
    connected = true;
    await route.fulfill({ json: { status: 'connected' } });
  });
  await page.route('**/payments/pagbank/status', route => route.fulfill({ json: {
    provider: 'pagbank', configured: true, connected, environment: 'sandbox', status: connected ? 'active' : 'disconnected',
  } }));
  await page.goto('/?view=caixa&pagbank=authorized&code=one-use-code&state=expected-state');
  await expect(page.getByText('PagBank conectado. A conta do restaurante receberá os novos Pix.')).toBeVisible();
  expect(completions).toBe(1);
  expect(page.url()).not.toContain('code=');
  expect(page.url()).not.toContain('state=');
  await expect(page.getByRole('region', { name: 'PagBank', exact: true }).getByRole('button', { name: 'Desconectar', exact: true })).toBeVisible();
});

test('retorno sem estado iniciado no navegador não troca a conta', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  let completions = 0;
  await page.route('**/payments/pagbank/complete', route => { completions++; return route.fulfill({ json: {} }); });
  await page.route('**/payments/pagbank/status', route => route.fulfill({ json: { configured: true, connected: false, environment: 'sandbox' } }));
  await page.goto('/?view=caixa&pagbank=authorized&code=foreign-code&state=foreign-state');
  await expect(page.getByText('Autorização inválida. Inicie a conexão novamente neste navegador.')).toBeVisible();
  expect(completions).toBe(0);
});
