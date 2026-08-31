import { expect, test, type Page } from '@playwright/test';

const APP_ORIGIN = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;
const API_ORIGIN = 'http://127.0.0.1:8000';
const NOW = new Date('2026-08-30T15:00:00.000Z');
const SETTINGS_KEY = 'koma_settings_vFinal_v3';

type ShellSession = 'garcom' | 'cozinha' | 'login';

async function openShell(page: Page, session: ShellSession = 'garcom') {
  const requests: string[] = [];
  const unexpectedRequests: string[] = [];
  const loginBodies: unknown[] = [];
  const order = {
    id: 'check-shell-e2e',
    mesa_id: 7,
    garcom_id: 'waiter-shell-e2e',
    criada_por: { nome: 'Garçom Shell E2E' },
    tipo: 'Consumo no Local',
    numero_pedido: 24,
    fechada: false,
    valor_pago: 0,
    criado_em: new Date(NOW.getTime() - 12 * 60_000).toISOString(),
    status_comanda: null,
    itens: [{
      id: 'item-shell-e2e',
      produto_id: 'product-shell-e2e',
      lancamento_id: 'launch-shell-e2e',
      preco_unit: 48,
      status: 'pronto',
      pago: false,
      observacao: '',
      cliente_nome: 'Consumo Geral',
      produto: { id: 'product-shell-e2e', nome: 'Prato Shell', preco: 48, ativo: true },
    }],
  };

  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ session, settingsKey }) => {
    const fixtureSeedKey = '__koma_shell_fixture_seeded_v1';
    if (!sessionStorage.getItem(fixtureSeedKey)) {
      localStorage.setItem('@koma:theme', 'dark');
      localStorage.setItem(settingsKey, JSON.stringify({ exibirImagens: true, exibirDescricoes: true }));
      localStorage.setItem('koma_restaurant_name_v3', 'Restaurante Shell E2E');
      localStorage.setItem('shell-unrelated-data', 'preserve-me');
      if (session === 'garcom') {
        localStorage.setItem('koma_waiter_token', 'waiter-shell-fixture-token');
        localStorage.setItem('koma_waiter_id', 'waiter-shell-e2e');
        localStorage.setItem('koma_waiter_name', 'Garçom Shell E2E');
        localStorage.setItem('koma_user_role', 'garcom');
      } else if (session === 'cozinha') {
        localStorage.setItem('koma_caixa_token', 'kitchen-shell-fixture-token');
        localStorage.setItem('koma_caixa_id', 'kitchen-shell-e2e');
        localStorage.setItem('koma_caixa_name', 'Cozinha Shell E2E');
        localStorage.setItem('koma_caixa_role', 'cozinha');
      }
      sessionStorage.setItem(fixtureSeedKey, '1');
    }

    const events: string[] = [];
    (window as any).__shellShortcutEvents = events;
    for (const event of ['koma-open-impressoras', 'koma-open-suprimento', 'koma-open-sangria', 'koma-sync-all']) {
      window.addEventListener(event, () => events.push(event));
    }
  }, { session, settingsKey: SETTINGS_KEY });

  await page.routeWebSocket(/\/ws\//, socket => { socket.onMessage(() => {}); });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === APP_ORIGIN) {
      await route.continue();
      return;
    }
    if (url.origin !== API_ORIGIN) {
      await route.abort();
      return;
    }
    const key = `${request.method()} ${url.pathname}`;
    requests.push(key);
    let body: unknown;
    if (key === 'GET /mesas/') {
      body = [{ id: 7, capacidade: 4, status: 'ocupada' }, { id: 8, capacidade: 4, status: 'livre' }];
    } else if (key === 'GET /comandas/detalhes/todos') {
      body = [order];
    } else if (key === 'GET /comandas/check-shell-e2e') {
      body = order;
    } else if (key === 'GET /caixa/configuracoes') {
      body = { perm_garcom_status: true, perm_garcom_editar: true, perm_garcom_print: true };
    } else if (key === 'GET /caixa/pagamentos/pendentes') {
      body = [];
    } else if (key === 'GET /produtos/catalogo') {
      body = { categorias: [{ id: 'meals', nome: 'Pratos', destino_impressao: 'COZINHA' }], produtos: [{ ...order.itens[0].produto, categoria_id: 'meals' }] };
    } else if (key === 'POST /auth/login') {
      loginBodies.push(request.postDataJSON());
      body = {
        access_token: 'waiter-shell-login-fixture-token',
        usuario: { id: 'waiter-shell-e2e', nome: 'Garçom Shell E2E', role: 'garcom', restaurante_id: 99001 },
      };
    } else {
      unexpectedRequests.push(key);
      await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ detail: 'Outside shell fixture' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto(session === 'cozinha' ? '/?view=caixa' : '/?view=garcom');
  if (session === 'login') await expect(page.getByLabel('E-MAIL')).toBeVisible();
  else await expect(page.locator('#open-sidebar-btn')).toBeVisible();
  if (session === 'garcom') await expect(page.locator('#mesa-card-7')).toBeVisible();
  return { requests, unexpectedRequests, loginBodies };
}

async function openDrawer(page: Page) {
  await page.locator('#open-sidebar-btn').click();
  await expect(page.locator('#close-sidebar-btn')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
}

test('drawer abre, fecha pelo botão e backdrop, restaurando scroll e disponibilidade', async ({ page }) => {
  const state = await openShell(page);
  await openDrawer(page);
  await expect(page.getByText('1 p/ servir', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Disponível no Salão', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ocupado / Em Atendimento', exact: true })).toBeVisible();
  await page.locator('#close-sidebar-btn').click();
  await expect(page.locator('#sidebar-backdrop')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');

  await openDrawer(page);
  await expect(page.getByRole('button', { name: 'Ocupado / Em Atendimento', exact: true })).toBeVisible();
  const viewport = page.viewportSize()!;
  await page.locator('#sidebar-backdrop').click({ position: { x: viewport.width - 8, y: 20 } });
  await expect(page.locator('#sidebar-backdrop')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  expect(state.unexpectedRequests).toEqual([]);
});

test('sincronizar salão fecha o drawer e atualiza pedidos e mesas', async ({ page }) => {
  const state = await openShell(page);
  await openDrawer(page);
  const ordersBefore = state.requests.filter(value => value === 'GET /comandas/detalhes/todos').length;
  const tablesBefore = state.requests.filter(value => value === 'GET /mesas/').length;
  await page.getByRole('button', { name: /Sincronizar Salão/ }).click();
  await expect(page.locator('#sidebar-backdrop')).toHaveCount(0);
  await expect.poll(() => state.requests.filter(value => value === 'GET /comandas/detalhes/todos').length).toBeGreaterThan(ordersBefore);
  await expect.poll(() => state.requests.filter(value => value === 'GET /mesas/').length).toBeGreaterThan(tablesBefore);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  expect(state.unexpectedRequests).toEqual([]);
});

test('tema e preferências persistem ao reabrir; logout mantém dados não autenticadores', async ({ page }) => {
  const state = await openShell(page);
  await openDrawer(page);
  await page.locator('#sidebar-toggle-images').uncheck();
  await page.locator('#sidebar-toggle-descriptions').uncheck();
  await page.getByRole('button', { name: 'Escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-koma-theme', 'light');
  await page.locator('#close-sidebar-btn').click();
  await openDrawer(page);
  await expect(page.locator('#sidebar-toggle-images')).not.toBeChecked();
  await expect(page.locator('#sidebar-toggle-descriptions')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Claro', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'LOGOUT / SAIR', exact: true }).click();
  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  await expect(page.locator('#sidebar-backdrop')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  const persisted = await page.evaluate(settingsKey => ({
    token: localStorage.getItem('koma_waiter_token'),
    user: localStorage.getItem('koma_waiter_id'),
    theme: localStorage.getItem('@koma:theme'),
    settings: JSON.parse(localStorage.getItem(settingsKey) || '{}'),
    unrelated: localStorage.getItem('shell-unrelated-data'),
  }), SETTINGS_KEY);
  expect(persisted).toEqual({ token: null, user: null, theme: 'light', settings: { exibirImagens: false, exibirDescricoes: false }, unrelated: 'preserve-me' });
  expect(state.unexpectedRequests).toEqual([]);
});

test('login controlado mantém submit para autenticação real do App e tema independente', async ({ page }) => {
  const state = await openShell(page, 'login');
  await page.getByRole('button', { name: 'Alternar tema claro e escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-koma-theme', 'light');
  await page.getByLabel('E-MAIL').fill('GARCOM@KOMA.TEST');
  await page.getByLabel('Senha').fill('shell-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('#mesa-card-7')).toBeVisible();
  expect(state.loginBodies).toEqual([{ username: 'garcom@koma.test', password: 'shell-password' }]);
  await expect(page.locator('html')).toHaveAttribute('data-koma-theme', 'light');
  expect(state.unexpectedRequests).toEqual([]);
});

test('logout seguido de novo login renova sessão, refaz fluxo de dados e persiste no reload', async ({ page }) => {
  const state = await openShell(page);
  const tablesBeforeLogout = state.requests.filter(value => value === 'GET /mesas/').length;
  const ordersBeforeLogout = state.requests.filter(value => value === 'GET /comandas/detalhes/todos').length;

  await openDrawer(page);
  await page.getByRole('button', { name: 'LOGOUT / SAIR', exact: true }).click();
  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    token: localStorage.getItem('koma_waiter_token'),
    user: localStorage.getItem('koma_waiter_id'),
    name: localStorage.getItem('koma_waiter_name'),
    role: localStorage.getItem('koma_user_role'),
    unrelated: localStorage.getItem('shell-unrelated-data'),
  }))).toEqual({ token: null, user: null, name: null, role: null, unrelated: 'preserve-me' });

  await page.getByLabel('E-MAIL').fill('GARCOM@KOMA.TEST');
  await page.getByLabel('Senha').fill('fresh-login-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  await expect(page.locator('#mesa-card-7')).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    token: localStorage.getItem('koma_waiter_token'),
    user: localStorage.getItem('koma_waiter_id'),
    name: localStorage.getItem('koma_waiter_name'),
    role: localStorage.getItem('koma_user_role'),
  }))).toEqual({
    token: 'waiter-shell-login-fixture-token',
    user: 'waiter-shell-e2e',
    name: 'Garçom Shell E2E',
    role: 'garcom',
  });
  expect(state.loginBodies).toEqual([{ username: 'garcom@koma.test', password: 'fresh-login-password' }]);
  await expect.poll(() => state.requests.filter(value => value === 'GET /mesas/').length).toBeGreaterThan(tablesBeforeLogout);
  await expect.poll(() => state.requests.filter(value => value === 'GET /comandas/detalhes/todos').length).toBeGreaterThan(ordersBeforeLogout);

  await page.reload();
  await expect(page.getByLabel('E-MAIL')).toHaveCount(0);
  await expect(page.locator('#mesa-card-7')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('koma_waiter_token'))).toBe('waiter-shell-login-fixture-token');
  expect(await page.evaluate(() => localStorage.getItem('shell-unrelated-data'))).toBe('preserve-me');
  expect(state.unexpectedRequests).toEqual([]);
});

test('sessão de cozinha conserva ramo alternativo do drawer e eventos exatos dos atalhos', async ({ page }) => {
  const state = await openShell(page, 'cozinha');
  const actions = [
    ['Agente de Impressão', 'koma-open-impressoras'],
    ['Suprimento de Caixa', 'koma-open-suprimento'],
    ['Sangria de Segurança', 'koma-open-sangria'],
    ['Sincronizar Dados', 'koma-sync-all'],
  ];
  const expectedEvents: string[] = [];
  for (const [label, event] of actions) {
    await openDrawer(page);
    await expect(page.getByText('Operador do Caixa', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(label) }).click();
    await expect(page.locator('#sidebar-backdrop')).toHaveCount(0);
    expectedEvents.push(event);
    await expect.poll(() => page.evaluate(() => (window as any).__shellShortcutEvents)).toEqual(expectedEvents);
  }
  expect(state.unexpectedRequests).toEqual([]);
});
