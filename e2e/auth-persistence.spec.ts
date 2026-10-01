import { expect, test, type Page, type Route } from '@playwright/test';

const APP_ORIGIN = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;
const API_ORIGIN = 'http://127.0.0.1:8000';
const CANONICAL_OPERATIONAL_PATH = '/?view=operacional';

type LoginReply = (route: Route, body: Record<string, unknown>) => Promise<void>;

async function installOperationalApi(page: Page, loginReply: LoginReply, authorization: string[] = []) {
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

    const bearer = request.headers().authorization;
    if (bearer) authorization.push(bearer);
    let body: unknown = {};
    if (key === 'GET /mesas/' || key === 'GET /comandas/detalhes/todos' || key === 'GET /caixa/pagamentos/pendentes') body = [];
    else if (key === 'GET /produtos/catalogo') body = { categorias: [], produtos: [] };
    else if (key === 'GET /caixa/configuracoes') body = {};
    else if (key === 'GET /caixa/turno-atual') body = null;
    else if (key === 'GET /api/onboarding/status') body = {onboarding:{releaseState:'released'}};
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

async function removePortalAlias(page: Page, portal: 'garcom' | 'caixa') {
  await page.evaluate((selectedPortal) => {
    const keys = selectedPortal === 'garcom'
      ? ['koma_waiter_token', 'koma_waiter_id', 'koma_waiter_name', 'koma_user_role']
      : ['koma_caixa_token', 'koma_caixa_id', 'koma_caixa_name', 'koma_caixa_user_id', 'koma_caixa_user_name', 'koma_caixa_role'];
    for (const key of keys) sessionStorage.removeItem(key);
  }, portal);
}

test('garçom persiste na própria aba e nova aba continua livre para outro login', async ({ page, context }) => {
  const bodies: unknown[] = [];
  const waiterReply: LoginReply = async (route, body) => {
    bodies.push(body);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      access_token: 'waiter-persist-token',
      usuario: { id: 'waiter-persist', nome: 'Garçom Persistente', role: 'garcom', cargo: 'garcom', restaurante_id: 1 },
    }) });
  };
  await installOperationalApi(page, waiterReply);

  await page.goto(CANONICAL_OPERATIONAL_PATH);
  await submitLogin(page, 'GARCOM@KOMA.TEST', 'senha-teste');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_waiter_token'))).toBe('waiter-persist-token');
  expect(bodies).toEqual([{ username: 'garcom@koma.test', password: 'senha-teste' }]);
  await page.reload();
  await expect(page.getByLabel('E-MAIL')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_active_operational_portal'))).toBe('garcom');

  const secondPage = await context.newPage();
  await installOperationalApi(secondPage, waiterReply);
  await secondPage.goto(CANONICAL_OPERATIONAL_PATH);
  await expect(secondPage.getByLabel('E-MAIL')).toBeVisible();
  expect(await secondPage.evaluate(() => sessionStorage.getItem('koma_waiter_token'))).toBeNull();
  expect(await secondPage.evaluate(() => sessionStorage.getItem('koma_active_operational_portal'))).toBeNull();
});

test('caixa normaliza role legado pelo cargo, persiste sessão e não vaza para nova aba', async ({ page, context }) => {
  const cashierReply: LoginReply = async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      access_token: 'cashier-persist-token',
      usuario: { id: 'cashier-persist', nome: 'Caixa Persistente', role: null, cargo: 'caixa', restaurante_id: 2 },
    }) });
  };
  await installOperationalApi(page, cashierReply);

  await page.goto(CANONICAL_OPERATIONAL_PATH);
  await submitLogin(page, 'caixa@koma.test', 'senha-teste');
  await expect.poll(() => page.evaluate(() => ({
    token: sessionStorage.getItem('koma_caixa_token'),
    role: sessionStorage.getItem('koma_caixa_role'),
    operatorRole: JSON.parse(sessionStorage.getItem('koma_operator_session_caixa') || 'null')?.user?.role ?? null,
    tabPortal: sessionStorage.getItem('koma_active_operational_portal'),
  }))).toEqual({
    token: 'cashier-persist-token',
    role: 'caixa',
    operatorRole: 'caixa',
    tabPortal: 'caixa',
  });
  await page.reload();
  await expect(page.getByLabel('E-MAIL')).toHaveCount(0);

  const secondPage = await context.newPage();
  await installOperationalApi(secondPage, cashierReply);
  await secondPage.goto(CANONICAL_OPERATIONAL_PATH);
  await expect(secondPage.getByLabel('E-MAIL')).toBeVisible();
  expect(await secondPage.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBeNull();
  expect(await secondPage.evaluate(() => sessionStorage.getItem('koma_active_operational_portal'))).toBeNull();
});

test('garçom e caixa permanecem autenticados em abas paralelas com reload e logout escopados', async ({ page, context }) => {
  const waiterReply: LoginReply = async (route, body) => {
    expect(body.username).toBe('garcom@koma.test');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      access_token: 'waiter-concurrent-token',
      usuario: { id: 'waiter-concurrent', nome: 'Garçom Concorrente', role: 'garcom', cargo: 'garcom', restaurante_id: 1 },
    }) });
  };
  await installOperationalApi(page, waiterReply);

  await page.goto(CANONICAL_OPERATIONAL_PATH);
  await submitLogin(page, 'garcom@koma.test', 'senha-teste');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_active_operational_portal'))).toBe('garcom');

  const cashierPage = await context.newPage();
  const cashierReply: LoginReply = async (route, body) => {
    expect(body.username).toBe('caixa@koma.test');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      access_token: 'cashier-concurrent-token',
      usuario: { id: 'cashier-concurrent', nome: 'Caixa Concorrente', role: 'caixa', cargo: 'caixa', restaurante_id: 1 },
    }) });
  };
  await installOperationalApi(cashierPage, cashierReply);
  await cashierPage.goto(CANONICAL_OPERATIONAL_PATH);
  await expect(cashierPage.getByLabel('E-MAIL')).toBeVisible();
  await submitLogin(cashierPage, 'caixa@koma.test', 'senha-teste');
  await expect.poll(() => cashierPage.evaluate(() => sessionStorage.getItem('koma_active_operational_portal'))).toBe('caixa');

  expect(await page.evaluate(() => ({
    waiter: sessionStorage.getItem('koma_waiter_token'),
    cashier: sessionStorage.getItem('koma_caixa_token'),
    portal: sessionStorage.getItem('koma_active_operational_portal'),
  }))).toEqual({ waiter: 'waiter-concurrent-token', cashier: null, portal: 'garcom' });
  expect(await cashierPage.evaluate(() => ({
    waiter: sessionStorage.getItem('koma_waiter_token'),
    cashier: sessionStorage.getItem('koma_caixa_token'),
    portal: sessionStorage.getItem('koma_active_operational_portal'),
  }))).toEqual({ waiter: null, cashier: 'cashier-concurrent-token', portal: 'caixa' });

  await Promise.all([page.reload(), cashierPage.reload()]);
  await expect(page.getByLabel('E-MAIL')).toHaveCount(0);
  await expect(cashierPage.getByLabel('E-MAIL')).toHaveCount(0);

  const thirdPage = await context.newPage();
  await installOperationalApi(thirdPage, waiterReply);
  await thirdPage.goto(CANONICAL_OPERATIONAL_PATH);
  await expect(thirdPage.getByLabel('E-MAIL')).toBeVisible();
  expect(await thirdPage.evaluate(() => sessionStorage.getItem('koma_active_operational_portal'))).toBeNull();
  expect(await thirdPage.evaluate(() => ({
    waiter: sessionStorage.getItem('koma_waiter_token'),
    cashier: sessionStorage.getItem('koma_caixa_token'),
  }))).toEqual({ waiter: null, cashier: null });

  await removePortalAlias(page, 'garcom');
  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  await expect(cashierPage.getByLabel('E-MAIL')).toHaveCount(0);
  expect(await cashierPage.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('cashier-concurrent-token');

  await submitLogin(page, 'garcom@koma.test', 'senha-teste');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_active_operational_portal'))).toBe('garcom');

  await removePortalAlias(cashierPage, 'caixa');
  await expect(cashierPage.getByLabel('E-MAIL')).toBeVisible();
  await expect(page.getByLabel('E-MAIL')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('koma_waiter_token'))).toBe('waiter-concurrent-token');
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
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_waiter_token'))).toBe('tenant-two-token');
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

test('Cardápio migra sessão legada para a aba e a restaura em reloads', async ({ page }) => {
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
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('koma_customer_session:1') || 'null')?.token)).toBe('customer-persist-token');
  expect(await page.evaluate(() => localStorage.getItem('koma_customer_session:1'))).toBeNull();
});

test('duas abas de Caixa em restaurantes diferentes e uma de Garçom isolam tokens após reload e saída', async ({page,context}) => {
  const tabs = [page, await context.newPage(), await context.newPage()];
  const identities = [
    {id:'admin-five',nome:'Admin Restaurante 5',role:'admin',restaurante_id:5},
    {id:'admin-two',nome:'Admin Restaurante Demo',role:'admin',restaurante_id:2},
    {id:'waiter-one',nome:'Garçom Restaurante 1',role:'garcom',restaurante_id:1},
  ];
  const observed: string[][] = [[],[],[]];
  const mutations: string[] = [];
  for (let index=0;index<tabs.length;index++) {
    const token = `isolated-token-${index}`;
    await tabs[index].addInitScript(() => {
      (window as any).__operationalSocketProtocols = [];
      const wrap = (OriginalWebSocket: typeof WebSocket) => class extends OriginalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          (window as any).__operationalSocketProtocols.push(protocols);
        }
      };
      let socketConstructor = wrap(window.WebSocket);
      // Preserva a observação quando Playwright instala seu mock de WebSocket.
      Object.defineProperty(window, 'WebSocket', {
        configurable: true,
        get: () => socketConstructor,
        set: (original: typeof WebSocket) => { socketConstructor = wrap(original); },
      });
    });
    await installOperationalApi(tabs[index],async route=>{
      await route.fulfill({json:{access_token:token,usuario:identities[index]}});
    },observed[index]);
    if (index < 2) {
      let memberExists = true;
      await tabs[index].route('**/caixa/funcionarios', route => route.fulfill({json:memberExists ? [{
        id:`member-${index}`,nome:`Pessoa Teste ${index}`,cargo:'cozinha',status:'inativo',
      }] : []}));
      await tabs[index].route(`**/auth/usuarios/member-${index}?remover_cadastro=true`, async route => {
        expect(route.request().method()).toBe('DELETE');
        expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
        memberExists = false;
        mutations.push(token);
        await route.fulfill({status:204});
      });
    }
    await tabs[index].goto(CANONICAL_OPERATIONAL_PATH);
    await expect(tabs[index].getByLabel('E-MAIL')).toBeVisible();
    await submitLogin(tabs[index],`staff-${index}@example.test`,'local-test');
    await expect.poll(()=>observed[index].length).toBeGreaterThan(0);
  }
  await Promise.all(tabs.map(tab=>tab.evaluate(()=>{window.dispatchEvent(new Event('popstate'));window.dispatchEvent(new Event('hashchange'));})));
  for (const tab of tabs) await expect(tab.getByLabel('E-MAIL')).toHaveCount(0);
  await Promise.all(tabs.map(tab=>tab.reload()));
  for(let index=0;index<tabs.length;index++) {
    await tabs[index].bringToFront();
    const portal=index===2?'garcom':'caixa';
    await expect.poll(()=>tabs[index].evaluate(selected=>JSON.parse(sessionStorage.getItem(`koma_operator_session_${selected}`)||'null')?.user,portal)).toEqual(identities[index]);
    await expect(tabs[index].getByLabel('E-MAIL')).toHaveCount(0);
    expect(new Set(observed[index])).toEqual(new Set([`Bearer isolated-token-${index}`]));
    await expect.poll(()=>tabs[index].evaluate(()=>(window as any).__operationalSocketProtocols)).toContainEqual(['koma-auth',`isolated-token-${index}`]);
    expect(await tabs[index].evaluate(()=>localStorage.getItem('koma_caixa_token'))).toBeNull();
  }
  // Ações reais da UI enviam o bearer do restaurante da própria aba.
  for (let index=0;index<2;index++) {
    await tabs[index].bringToFront();
    if (test.info().project.name.startsWith('mobile')) await tabs[index].getByRole('button',{name:'Abrir menu principal'}).click();
    await tabs[index].getByRole('button',{name:'Equipe',exact:true}).click();
    await expect(tabs[index].getByRole('heading',{name:`Pessoa Teste ${index}`})).toBeVisible();
    tabs[index].once('dialog',dialog=>dialog.accept());
    await tabs[index].getByRole('button',{name:`Remover Pessoa Teste ${index} da equipe`}).click();
    await expect(tabs[index].getByRole('heading',{name:`Pessoa Teste ${index}`})).toHaveCount(0);
  }
  expect(mutations).toEqual(['isolated-token-0','isolated-token-1']);
  // O logout real do painel limpa somente a aba, sem editar storage de outras abas.
  await tabs[1].bringToFront();
  if (test.info().project.name.startsWith('mobile')) await tabs[1].getByRole('button',{name:'Abrir menu principal'}).click();
  await expect(tabs[1].getByRole('button',{name:'Abrir conta e preferências',exact:true})).toBeVisible();
  await tabs[1].getByRole('button',{name:'Abrir conta e preferências',exact:true}).click();
  await tabs[1].getByRole('button',{name:'LOGOUT / TROCAR OPERADOR'}).click();
  await expect(tabs[1].getByLabel('E-MAIL')).toBeVisible();
  await Promise.all([tabs[0].reload(),tabs[2].reload()]);
  await expect(tabs[0].getByLabel('E-MAIL')).toHaveCount(0);
  await expect(tabs[2].getByLabel('E-MAIL')).toHaveCount(0);
  expect(new Set(observed[0])).toEqual(new Set(['Bearer isolated-token-0']));
  expect(new Set(observed[2])).toEqual(new Set(['Bearer isolated-token-2']));
});

const pendingOnboarding = {
  restaurant: { id: '5', name: 'Restaurante de Teste', slug: 'test', plan: 'pro', operationProfile: 'generic' },
  trial: { status: 'setup', startsAt: null, endsAt: null, daysRemaining: null },
  trialCanStart: false, readyForRelease: false,
  onboarding: { mode: 'commercial', releaseState: 'configuring', operationReleased: false, requiresKomaRelease: true },
  payments: { mercadoPagoConnected: false, pixOnlineAvailable: false },
  counts: { products: 0, activeProducts: 0, orders: 0, tables: 0 },
  operations: { configured: false, ready: false, legacyPolicy: false, orderTypes: [], tableMapEnabled: false, serviceChargeEnabled: false, serviceChargePercent: 0, blockers: ['order_types'] },
  catalogAssistance: null,
  steps: { profile: false, hours: false, catalog: false, operations: false, mercadoPago: false, firstOrder: false },
  progress: { completed: 0, total: 4, percent: 0 },
  readiness: { configurationComplete: false, trialStarted: false, operationReleased: false, readyToOperate: false, blockers: ['profile'] },
};

async function seedManagementSession(page: Page, expired = false) {
  await page.addInitScript(({ expired }) => {
    if (sessionStorage.getItem('test-session-seeded')) return;
    sessionStorage.setItem('test-session-seeded', '1');
    sessionStorage.removeItem('koma_operational_logged_out');
    const session = { token: 'test-management-session', user: { id: 'admin', nome: 'Admin Teste', role: 'admin', restaurante_id: 5 }, expiresAt: Date.now() + (expired ? -1000 : 60_000) };
    sessionStorage.setItem('koma_operator_session_caixa', JSON.stringify(session));
    sessionStorage.setItem('koma_caixa_token', session.token);
    sessionStorage.setItem('koma_caixa_role', 'admin');
    sessionStorage.setItem('koma_active_operational_portal', 'caixa');
  }, { expired });
}

async function expectLoginWithoutOnboarding(page: Page) {
  await expect(page.getByLabel('E-MAIL', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Bem-vindo ao KÔMA/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeEnabled();
}

test('entrada sem sessão ignora identidade antiga no localStorage e continua no login após refresh', async ({ page }) => {
  let onboardingReads = 0;
  await installOperationalApi(page, async route => { await route.abort(); });
  await page.route('**/api/onboarding/status', async route => { onboardingReads++; await route.fulfill({ json: pendingOnboarding }); });
  await page.addInitScript(() => {
    localStorage.setItem('koma_operator_session_caixa', JSON.stringify({ token: 'stale', user: { role: 'admin' }, expiresAt: Date.now() + 60_000 }));
    localStorage.setItem('koma_caixa_token', 'stale');
    localStorage.setItem('koma_last_operational_portal', 'caixa');
  });
  await page.goto(CANONICAL_OPERATIONAL_PATH);
  await expectLoginWithoutOnboarding(page);
  await page.reload();
  await expectLoginWithoutOnboarding(page);
  expect(onboardingReads).toBe(0);
});

for (const status of [401, 403, 404]) {
  test(`sessão rejeitada (${status}) volta ao login sem loop na entrada e na retomada`, async ({ page }) => {
    await installOperationalApi(page, async route => { await route.abort(); });
    await seedManagementSession(page);
    await page.route('**/api/onboarding/status', route => route.fulfill({ status, json: { detail: 'Sessão indisponível' } }));
    await page.goto(CANONICAL_OPERATIONAL_PATH);
    await expectLoginWithoutOnboarding(page);
    expect(await page.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBeNull();
    await page.reload();
    await expectLoginWithoutOnboarding(page);
    await page.evaluate(() => sessionStorage.removeItem('test-session-seeded'));
    await page.goto('/ativar?resume=1');
    await expectLoginWithoutOnboarding(page);
    await page.reload();
    await expectLoginWithoutOnboarding(page);
  });
}

test('sessão local expirada abre login sem consultar implantação', async ({ page }) => {
  await installOperationalApi(page, async route => { await route.abort(); });
  await seedManagementSession(page, true);
  let reads = 0;
  await page.route('**/api/onboarding/status', async route => { reads++; await route.fulfill({ json: pendingOnboarding }); });
  await page.goto(CANONICAL_OPERATIONAL_PATH);
  await expectLoginWithoutOnboarding(page);
  expect(reads).toBe(0);
});

test('implantação pendente só aparece após validação e permite logout na entrada e em /ativar', async ({ page }) => {
  await installOperationalApi(page, async route => { await route.fulfill({ json: { access_token: 'new-management-session', usuario: { id: 'admin', nome: 'Admin Teste', role: 'admin', restaurante_id: 5 } } }); });
  await seedManagementSession(page);
  let release!: () => void;
  const statusReady = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/onboarding/status', async route => { await statusReady; await route.fulfill({ json: pendingOnboarding }); });
  await page.goto(CANONICAL_OPERATIONAL_PATH);
  await expect(page.getByText('Verificando implantação…', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Bem-vindo ao KÔMA/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Verificando implantação…', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Bem-vindo ao KÔMA/ })).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'Bem-vindo ao KÔMA, Restaurante de Teste' })).toBeVisible();
  await page.getByRole('button', { name: 'Sair e ir para o login', exact: true }).click();
  await expectLoginWithoutOnboarding(page);
  await submitLogin(page, 'admin@example.test', 'test-password');
  await expect(page.getByRole('heading', { name: /Bem-vindo ao KÔMA/ })).toBeVisible();
  await page.goto('/ativar?resume=1');
  await expect(page.getByRole('heading', { name: /Bem-vindo ao KÔMA/ })).toBeVisible();
  await page.getByRole('button', { name: 'Sair e ir para o login', exact: true }).click();
  await expectLoginWithoutOnboarding(page);
  await page.reload();
  await expectLoginWithoutOnboarding(page);
});

test('erro temporário ou resposta incompleta não vira implantação e oferece retorno ao login', async ({ page }) => {
  await installOperationalApi(page, async route => { await route.abort(); });
  await seedManagementSession(page);
  await page.route('**/api/onboarding/status', route => route.fulfill({ status: 503, json: {} }));
  await page.goto(CANONICAL_OPERATIONAL_PATH);
  await expect(page.getByText('Não foi possível validar a implantação inicial.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Bem-vindo ao KÔMA|Sua conta está ativa/ })).toHaveCount(0);
  await page.route('**/api/onboarding/status', route => route.fulfill({ json: {} }));
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByText('Não foi possível validar a implantação inicial.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ir para o login', exact: true }).click();
  await expectLoginWithoutOnboarding(page);
});

test('liberação canônica mantém revisão pendente e libera painel após refresh sem pedido de teste obrigatório', async ({ page }) => {
  await installOperationalApi(page, async route => { await route.abort(); });
  await seedManagementSession(page);
  let released = false;
  await page.route('**/api/onboarding/status', route => route.fulfill({ json: {
    ...pendingOnboarding,
    onboarding: { ...pendingOnboarding.onboarding, releaseState: released ? 'released' : 'awaiting_koma', operationReleased: released },
    progress: { completed: 4, total: 4, percent: 100 },
    readiness: { ...pendingOnboarding.readiness, configurationComplete: true, operationReleased: released },
    trial: { ...pendingOnboarding.trial, status: released ? 'active' : 'setup' },
  } }));
  await page.goto(CANONICAL_OPERATIONAL_PATH);
  await expect(page.getByText('Aguardando KÔMA', { exact: true })).toBeVisible();
  released = true;
  await page.reload();
  if (test.info().project.name.startsWith('mobile')) await page.getByRole('button', { name: 'Abrir menu principal' }).click();
  await expect(page.getByRole('button', { name: 'Abrir conta e preferências', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Bem-vindo ao KÔMA/ })).toHaveCount(0);
});

test('modo de configuração persistido não permite contornar sessão rejeitada', async ({ page }) => {
  await installOperationalApi(page, async route => { await route.abort(); });
  await seedManagementSession(page);
  await page.addInitScript(() => sessionStorage.setItem('koma_onboarding_setup_mode', '1'));
  await page.route('**/api/onboarding/status', route => route.fulfill({ status: 401, json: {} }));
  await page.goto(CANONICAL_OPERATIONAL_PATH);
  await expectLoginWithoutOnboarding(page);
});

test('timeout de validação oferece login sem concluir que implantação está pendente', async ({ page }) => {
  await installOperationalApi(page, async route => { await route.abort(); });
  await seedManagementSession(page);
  await page.route('**/api/onboarding/status', () => {});
  await page.clock.install();
  await page.goto(CANONICAL_OPERATIONAL_PATH);
  await expect(page.getByText('Verificando implantação…', { exact: true })).toBeVisible();
  await page.clock.fastForward(10_001);
  await expect(page.getByText('Não foi possível validar a implantação inicial.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Bem-vindo ao KÔMA/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ir para o login', exact: true }).click();
  await expectLoginWithoutOnboarding(page);
});

test('retomada sem sessão mantém caminho funcional para login', async ({ page }) => {
  await installOperationalApi(page, async route => { await route.abort(); });
  await page.goto('/ativar?resume=1');
  await expect(page.getByRole('heading', { name: 'Entre novamente para continuar' })).toBeVisible();
  await page.getByRole('button', { name: 'Ir para o login', exact: true }).click();
  await expectLoginWithoutOnboarding(page);
});
