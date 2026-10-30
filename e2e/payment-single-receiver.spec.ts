import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

type Provider = 'pagbank' | 'mercado_pago';
const endpoint = (provider: Provider) => provider === 'pagbank' ? 'pagbank' : 'mercado-pago';
const bankName = (provider: Provider) => provider === 'pagbank' ? 'PagBank' : 'Mercado Pago';
const status = (provider: Provider, receiver: Provider | null) => ({
  configured: true, environment: 'production', connected: provider === receiver,
  status: provider === receiver ? 'active' : 'disconnected',
  receiver_provider: receiver, connection_blocked: Boolean(receiver && receiver !== provider),
});

async function setup(page: Page) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
}

test('nenhum banco inicia conexão antes de conhecer o estado dos dois recebedores', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/payments/pagbank/status', route => route.fulfill({ json: status('pagbank', null) }));
  await page.route('**/payments/mercado-pago/status', async route => {
    await waiting;
    await route.fulfill({ json: status('mercado_pago', null) });
  });
  await page.goto('/?view=caixa&pagbank=cancelled');
  await expect(page.getByRole('button', { name: 'Conectar PagBank', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Conectar Mercado Pago', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('button', { name: 'Conectar PagBank', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Conectar Mercado Pago', exact: true })).toBeEnabled();
});

for (const current of ['pagbank', 'mercado_pago'] as const) {
  test(`${current}: reconexão é permitida, outro banco só libera depois da desconexão`, async ({ page }) => {
    await setup(page);
    let receiver: Provider | null = current;
    let disconnectAllowed = false;
    let connectCalls = 0;
    const other: Provider = current === 'pagbank' ? 'mercado_pago' : 'pagbank';
    for (const provider of ['pagbank', 'mercado_pago'] as const) {
      await page.route(`**/payments/${endpoint(provider)}/status`, route => route.fulfill({ json: status(provider, receiver) }));
      await page.route(`**/payments/${endpoint(provider)}/connect`, route => {
        connectCalls++;
        return route.fulfill({ status: 409, json: { detail: 'Recebedor concorrente bloqueado.' } });
      });
    }
    await page.route(`**/payments/${endpoint(current)}/disconnect`, route => {
      if (!disconnectAllowed) return route.fulfill({ status: 409, json: { detail: 'Resolva os Pix pendentes antes de desconectar.' } });
      receiver = null;
      return route.fulfill({ json: { status: 'disconnected' } });
    });
    await page.goto('/?view=caixa&pagbank=cancelled');
    const active = page.getByRole('region', { name: bankName(current), exact: true });
    const otherConnect = page.getByRole('button', { name: `Conectar ${bankName(other)}`, exact: true });
    await expect(active.getByRole('button', { name: 'Reconectar', exact: true })).toBeEnabled();
    await expect(otherConnect).toBeDisabled();
    await active.getByRole('button', { name: 'Desconectar', exact: true }).click();
    await expect(active.getByRole('status')).toContainText('Resolva os Pix pendentes');
    await expect(otherConnect).toBeDisabled();
    expect(connectCalls).toBe(0);
    disconnectAllowed = true;
    await active.getByRole('button', { name: 'Desconectar', exact: true }).click();
    await expect(active.getByRole('button', { name: `Conectar ${bankName(current)}`, exact: true })).toBeEnabled();
    await expect(otherConnect).toBeEnabled();
  });
}

test('falha de status remove anúncio de conexão e bloqueia novas conexões até recuperar', async ({ page }) => {
  await setup(page);
  let fail = false;
  await page.route('**/payments/pagbank/status', route => route.fulfill({ json: status('pagbank', 'mercado_pago') }));
  await page.route('**/payments/mercado-pago/status', route => fail
    ? route.fulfill({ status: 503, json: { detail: 'Consulta temporariamente indisponível.' } })
    : route.fulfill({ json: status('mercado_pago', 'mercado_pago') }));
  await page.goto('/?view=caixa&pagbank=cancelled');
  const mp = page.getByRole('region', { name: 'Mercado Pago', exact: true });
  await expect(mp.getByText('Conectado', { exact: true })).toBeVisible();
  fail = true;
  await mp.getByRole('button', { name: 'Atualizar status do Mercado Pago' }).click();
  await expect(mp.getByRole('status')).toContainText('Consulta temporariamente indisponível.');
  await expect(mp.getByText('Conectado', { exact: true })).toHaveCount(0);
  await expect(mp.getByRole('button', { name: 'Conectar Mercado Pago', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Conectar PagBank', exact: true })).toBeDisabled();
  fail = false;
  await mp.getByRole('button', { name: 'Atualizar status do Mercado Pago' }).click();
  await expect(mp.getByRole('button', { name: 'Reconectar', exact: true })).toBeEnabled();
});

test('uma autorização em andamento bloqueia o início simultâneo pelo outro banco', async ({ page }) => {
  await setup(page);
  for (const provider of ['pagbank', 'mercado_pago'] as const) {
    await page.route(`**/payments/${endpoint(provider)}/status`, route => route.fulfill({ json: status(provider, null) }));
  }
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/payments/pagbank/connect', async route => {
    await waiting;
    await route.fulfill({ status: 503, json: { detail: 'Banco indisponível.' } });
  });
  await page.goto('/?view=caixa&pagbank=cancelled');
  await page.getByRole('button', { name: 'Conectar PagBank', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Conectar Mercado Pago', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('status').filter({ hasText: 'Banco indisponível.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar Mercado Pago', exact: true })).toBeEnabled();
});

test('estado ambíguo com dois bancos ativos bloqueia ambas as autorizações', async ({ page }) => {
  await setup(page);
  for (const provider of ['pagbank', 'mercado_pago'] as const) {
    await page.route(`**/payments/${endpoint(provider)}/status`, route => route.fulfill({ json: {
      ...status(provider, provider), connection_blocked: true,
    } }));
  }
  await page.goto('/?view=caixa&pagbank=cancelled');
  for (const provider of ['pagbank', 'mercado_pago'] as const) {
    const card = page.getByRole('region', { name: bankName(provider), exact: true });
    await expect(card.getByRole('button', { name: 'Reconectar', exact: true })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Desconectar', exact: true })).toBeEnabled();
  }
});

test('resposta HTTP 200 incompleta não é tratada como ausência de recebedor', async ({ page }) => {
  await setup(page);
  let malformed = true;
  await page.route('**/payments/pagbank/status', route => route.fulfill({ json: status('pagbank', null) }));
  await page.route('**/payments/mercado-pago/status', route => route.fulfill({ json: malformed ? {} : status('mercado_pago', null) }));
  await page.goto('/?view=caixa&pagbank=cancelled');
  const mp = page.getByRole('region', { name: 'Mercado Pago', exact: true });
  await expect(mp.getByRole('status')).toContainText('Não foi possível consultar o Mercado Pago.');
  await expect(page.getByRole('button', { name: 'Conectar PagBank', exact: true })).toBeDisabled();
  await expect(mp.getByRole('button', { name: 'Conectar Mercado Pago', exact: true })).toBeDisabled();
  malformed = false;
  await mp.getByRole('button', { name: 'Atualizar status do Mercado Pago' }).click();
  await expect(mp.getByRole('button', { name: 'Conectar Mercado Pago', exact: true })).toBeEnabled();
  await expect(mp.getByRole('status')).toHaveCount(0);
});

for (const connected of [false, true]) {
  test(`retorno Mercado Pago só anuncia Pix habilitado após confirmar recebedor: ${connected}`, async ({ page }) => {
    await setup(page);
    const receiver = connected ? 'mercado_pago' : null;
    await page.route('**/payments/pagbank/status', route => route.fulfill({ json: status('pagbank', receiver) }));
    await page.route('**/payments/mercado-pago/status', route => route.fulfill({ json: status('mercado_pago', receiver) }));
    await page.goto('/?view=caixa&mercado_pago=connected');
    const mp = page.getByRole('region', { name: 'Mercado Pago', exact: true });
    if (connected) {
      await expect(mp.getByRole('status')).toContainText('Mercado Pago conectado. Pix habilitado no cardápio online.');
      await expect(page.getByRole('button', { name: 'Conectar PagBank', exact: true })).toBeDisabled();
    } else {
      await expect(mp.getByRole('status')).toContainText('Não foi possível confirmar a conexão do Mercado Pago.');
      await expect(mp.getByText('Mercado Pago conectado. Pix habilitado no cardápio online.', { exact: true })).toHaveCount(0);
    }
    expect(page.url()).not.toContain('mercado_pago=');
  });
}
