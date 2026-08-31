import { expect, test, type Page, type Route } from '@playwright/test';

const APP_ORIGIN = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;
const API_ORIGIN = 'http://127.0.0.1:8000';

type LoginReply = (route: Route, body: Record<string, unknown>) => Promise<void>;

async function installOperationalApi(page: Page, loginReply: LoginReply) {
  await page.routeWebSocket(/\/ws\//, socket => { socket.onMessage(() => {}); });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === APP_ORIGIN) return route.continue();
    if (url.origin !== API_ORIGIN) return route.abort();

    const key = `${request.method()} ${url.pathname}`;
    if (key === 'POST /auth/login') {
      await loginReply(route, request.postDataJSON() as Record<string, unknown>);
      return;
    }

    let body: unknown = {};
    if (key === 'GET /mesas/' || key === 'GET /comandas/detalhes/todos' || key === 'GET /caixa/pagamentos/pendentes') body = [];
    else if (key === 'GET /produtos/catalogo') body = { categorias: [], produtos: [] };
    else if (key === 'GET /caixa/configuracoes') body = {};
    else if (key === 'GET /caixa/turno-atual/resumo') body = { total_vendas: 0, comandas_abertas_count: 0 };
    else if (request.method() === 'GET') body = [];

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.getByLabel('E-MAIL').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('garçom persiste apenas no portal de garçom e sobrevive a reload', async ({ page }) => {
  const bodies: unknown[] = [];
  await installOperationalApi(page, async (route, body) => {
    bodies.push(body);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      access_token: 'waiter-persist-token',
      usuario: { id: 'waiter-persist', nome: 'Garçom Persistente', role: 'garcom', cargo: 'garcom', restaurante_id: 1 },
    }) });
  });

  await page.goto('/?view=garcom');
  await submitLogin(page, 'GARCOM@KOMA.TEST', 'senha-teste');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('koma_waiter_token'))).toBe('waiter-persist-token');
  expect(bodies).toEqual([{ username: 'garcom@koma.test', password: 'senha-teste' }]);
  await page.reload();
  await expect(page.getByLabel('E-MAIL')).toHaveCount(0);
  await page.goto('/?view=caixa');
  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('koma_caixa_token'))).toBeNull();
});

test('caixa normaliza role legado pelo cargo, persiste sessão e não vaza para garçom', async ({ page }) => {
  await installOperationalApi(page, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      access_token: 'cashier-persist-token',
      usuario: { id: 'cashier-persist', nome: 'Caixa Persistente', role: null, cargo: 'caixa', restaurante_id: 2 },
    }) });
  });

  await page.goto('/?view=caixa');
  await submitLogin(page, 'caixa@koma.test', 'senha-teste');
  await expect.poll(() => page.evaluate(() => ({
    token: localStorage.getItem('koma_caixa_token'),
    role: localStorage.getItem('koma_caixa_role'),
    operatorRole: JSON.parse(localStorage.getItem('koma_operator_session') || 'null')?.user?.role ?? null,
  }))).toEqual({
    token: 'cashier-persist-token',
    role: 'caixa',
    operatorRole: 'caixa',
  });
  await page.reload();
  await expect(page.getByLabel('E-MAIL')).toHaveCount(0);
  await page.goto('/?view=garcom');
  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('koma_waiter_token'))).toBeNull();
});

test('login duplicado pede estabelecimento e repete com restaurante_id explícito', async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  await installOperationalApi(page, async (route, body) => {
    bodies.push(body);
    if (!body.restaurante_id) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({
        detail: {
          code: 'restaurant_selection_required',
          message: 'Selecione o estabelecimento para continuar.',
          restaurante_ids: [1, 2],
          restaurantes: [
            { id: 1, nome: 'Bagueteria e Pastelaria Pôr do sol' },
            { id: 2, nome: 'Pizzeria Bella Italia' },
          ],
        },
      }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      access_token: 'tenant-two-token',
      usuario: { id: 'tenant-two-user', nome: 'Operador Dois', role: 'garcom', cargo: 'garcom', restaurante_id: 2 },
    }) });
  });

  await page.goto('/?view=garcom');
  await submitLogin(page, 'duplicado@koma.test', 'senha-compartilhada');
  await expect(page.getByLabel('Estabelecimento')).toBeVisible();
  await page.getByLabel('Estabelecimento').selectOption('2');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('koma_waiter_token'))).toBe('tenant-two-token');
  expect(bodies).toEqual([
    { username: 'duplicado@koma.test', password: 'senha-compartilhada' },
    { username: 'duplicado@koma.test', password: 'senha-compartilhada', restaurante_id: 2 },
  ]);
  await page.reload();
  await expect(page.getByLabel('E-MAIL')).toHaveCount(0);
});

test('SuperAdmin mantém token na sessão da aba após reload', async ({ page }) => {
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === APP_ORIGIN) return route.continue();
    if (url.origin !== API_ORIGIN) return route.abort();
    if (request.method() === 'POST' && url.pathname === '/api/super-admin/token') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'superadmin-persist-token', token_type: 'bearer' }) });
      return;
    }
    await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ detail: 'Fixture sem operação real' }) });
  });

  await page.goto('/super-admin');
  await page.getByLabel('Usuário').fill('admin-test');
  await page.getByLabel('Senha').fill('senha-test');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_super_admin_token'))).toBe('superadmin-persist-token');
  await page.reload();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_super_admin_token'))).toBe('superadmin-persist-token');
  await expect(page.locator('#superadmin-login')).toHaveCount(0);
});

test('Cardápio restaura sessão de cliente por restaurante em reloads', async ({ page }) => {
  let profileReads = 0;
  await page.addInitScript(() => {
    localStorage.setItem('koma_customer_session:1', JSON.stringify({
      token: 'customer-persist-token',
      profile: { id: 'customer-1', name: 'Cliente Persistente', phone: '11999999999', address: '', points: 10, cashback: 2 },
    }));
  });
  await page.routeWebSocket(/\/ws\//, socket => { socket.onMessage(() => {}); });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === APP_ORIGIN) return route.continue();
    if (url.origin !== API_ORIGIN) return route.abort();
    if (url.pathname === '/api/cardapio-digital/public') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        restaurante: { id: 1, nome: 'Cardápio Teste', status_loja: 'aberto' }, categorias: [], produtos: [],
      }) });
      return;
    }
    if (url.pathname === '/cardapio/clientes/me') {
      expect(request.headers()['x-koma-customer-token']).toBe('customer-persist-token');
      profileReads += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        id: 'customer-1', nome: 'Cliente Persistente', telefone: '11999999999', saldo_pontos: 10, saldo_cashback: 2,
      }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.goto('/?view=cardapio&restaurante_id=1');
  await expect.poll(() => profileReads).toBeGreaterThan(0);
  const beforeReload = profileReads;
  await page.reload();
  await expect.poll(() => profileReads).toBeGreaterThan(beforeReload);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('koma_customer_session:1') || 'null')?.token)).toBe('customer-persist-token');
});
