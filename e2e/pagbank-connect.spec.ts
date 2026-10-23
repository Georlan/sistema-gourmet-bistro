import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('retorno em outra aba aceita só o estado iniciado no mesmo navegador', async ({ page, context }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.route('**/payments/pagbank/status', route => route.fulfill({ json: {
    configured: true, connected: false, environment: 'production', status: 'disconnected',
  } }));
  await page.route('**/payments/pagbank/connect', route => route.fulfill({ json: {
    authorization_url: 'https://connect.pagbank.com.br/oauth2/authorize?state=new-tab-state',
  } }));
  await page.route('https://connect.pagbank.com.br/**', route => route.fulfill({ body: 'Banco simulado' }));
  await page.goto('/?view=caixa&pagbank=cancelled');
  await page.getByRole('button', { name: 'Conectar PagBank' }).click();
  await expect(page).toHaveURL(/connect.pagbank.com.br/);
  const returned = await context.newPage();
  await mockCashierBackend(returned);
  await seedCashierSession(returned); // KÔMA login, but no OAuth state in this tab.
  let completions = 0;
  await returned.route('**/payments/pagbank/complete', route => {
    completions++;
    expect(route.request().postDataJSON()).toEqual({ code: 'new-tab-code', state: 'new-tab-state' });
    return route.fulfill({ json: { status: 'connected' } });
  });
  await returned.route('**/payments/pagbank/status', route => route.fulfill({ json: {
    configured: true, connected: completions > 0, environment: 'production', status: completions ? 'active' : 'disconnected',
  } }));
  await returned.goto('/?view=caixa&pagbank=authorized&code=new-tab-code&state=new-tab-state');
  await expect(returned.getByText('PagBank conectado. A conta do restaurante receberá os novos Pix.')).toBeVisible();
  expect(completions).toBe(1);
  expect(await returned.evaluate(() => localStorage.getItem('koma_pagbank_oauth_pending:new-tab-state'))).toBeNull();
  expect(returned.url()).not.toMatch(/[?&](code|state|pagbank)=/);
  await returned.reload();
  // The login fixture resets navigation to orders on every document load.
  await expect(returned.locator('.orders-board')).toBeVisible();
  expect(completions).toBe(1);
  await returned.close();
});

test('PagBank informa preparação sem oferecer uma conexão falsa', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.route('**/payments/pagbank/status', route => route.fulfill({ json: {
    provider: 'pagbank', configured: false, connected: false, environment: 'sandbox', status: 'disconnected',
  } }));
  await page.goto('/?view=caixa&pagbank=cancelled');
  await expect(page.getByRole('heading', { name: 'PagBank', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conexão em preparação' })).toBeDisabled();
  await expect(page.getByText('A conexão estará disponível em breve.')).toBeVisible();
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


test('QA9 Sandbox conclui troca OAuth como evidência sem anunciar recebedor conectado', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => sessionStorage.setItem('koma_pagbank_oauth_state', 'qa9-evidence-state'));
  let completions = 0;
  await page.route('**/payments/pagbank/complete', route => {
    completions++;
    expect(route.request().postDataJSON()).toEqual({ code: 'qa9-once', state: 'qa9-evidence-state' });
    return route.fulfill({ json: { status: 'sandbox_evidence_captured' } });
  });
  await page.route('**/payments/pagbank/status', route => route.fulfill({ json: {
    configured: true, environment: 'sandbox', connected: false, status: 'disconnected',
  } }));
  await page.goto('/?view=caixa&pagbank=authorized&code=qa9-once&state=qa9-evidence-state');
  await expect(page.getByText('OAuth Sandbox validado e evidência registrada. Nenhuma conta foi conectada para receber Pix.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar PagBank' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'PagBank', exact: true }).getByRole('button', { name: 'Desconectar', exact: true })).toHaveCount(0);
  expect(completions).toBe(1);
  expect(page.url()).not.toMatch(/[?&](code|state|pagbank)=/);
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


test('integrações separa Pagamentos e WhatsApp; 404 tem recuperação', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  let unavailable = true;
  await page.route('**/payments/pagbank/status', route => unavailable
    ? route.fulfill({ status: 404, json: { detail: 'Not Found' } })
    : route.fulfill({ json: { configured: true, connected: false, environment: 'production' } }));
  await page.goto('/?view=caixa&pagbank=cancelled');
  await expect(page.getByRole('heading', { name: 'Pagamentos online' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mercado Pago', exact: true })).toBeVisible();
  await expect(page.getByText('A conexão PagBank está temporariamente indisponível. Tente atualizar mais tarde.')).toBeVisible();
  await expect(page.getByText('Not Found', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Chave Pix', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Seu WhatsApp com DDD')).not.toBeVisible();
  await page.getByRole('tab', { name: 'WhatsApp' }).click();
  await expect(page.getByRole('heading', { name: 'Comandas pelo WhatsApp' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Avisos para clientes pelo KÔMA Business' })).toBeVisible();
  await page.getByRole('tab', { name: 'Pagamentos' }).click();
  unavailable = false;
  await page.getByRole('button', { name: 'Atualizar status do PagBank' }).click();
  await expect(page.getByRole('button', { name: 'Conectar PagBank' })).toBeEnabled();
  await expect(page.getByText('A conexão PagBank está temporariamente indisponível. Tente atualizar mais tarde.')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('integracoes.png'), fullPage: true });
});


test('ida ao banco e retorno preservam a sessão e concluem na primeira tentativa', async ({ page, baseURL }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  let connected = false;
  let completions = 0;
  await page.route('**/payments/pagbank/status', route => route.fulfill({ json: {
    configured: true, connected, environment: 'production', status: connected ? 'active' : 'disconnected',
  } }));
  await page.route('**/payments/pagbank/connect', route => route.fulfill({ json: {
    authorization_url: 'https://connect.pagbank.com.br/oauth2/authorize?state=roundtrip-state',
  } }));
  await page.route('https://connect.pagbank.com.br/**', route => route.fulfill({
    status: 302, headers: { location: `${baseURL}/?view=caixa&pagbank=authorized&code=test-code&state=roundtrip-state` }, body: '',
  }));
  await page.route('**/payments/pagbank/complete', route => {
    expect(route.request().headers()['authorization']).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({ code: 'test-code', state: 'roundtrip-state' });
    connected = true; completions++;
    return route.fulfill({ json: { status: 'connected' } });
  });
  await page.goto('/?view=caixa&pagbank=cancelled');
  await page.getByRole('button', { name: 'Conectar PagBank' }).click();
  await expect(page.getByRole('region', { name: 'PagBank', exact: true }).getByText('Conectado', { exact: true })).toBeVisible();
  expect(completions).toBe(1);
  expect(new URL(page.url()).origin).toBe(baseURL);
  await expect(page.getByRole('heading', { name: 'Pagamentos online' })).toBeVisible();
});
