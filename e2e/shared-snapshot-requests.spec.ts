import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('Caixa compartilha clientes entre checkout e tela Clientes', async ({ page }, testInfo) => {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  const requests: string[] = [];
  page.on('request', request => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/fidelidade/clientes') requests.push(request.url());
  });
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(1);
  const before = requests.length;
  expect(before).toBe(1);
  if (testInfo.project.name.startsWith('mobile')) await page.getByRole('button', { name: 'Abrir menu completo' }).click();
  const sidebar = page.locator('.cashier-sidebar:visible');
  await sidebar.getByRole('button', { name: /^Clientes(?: \d+)?$/ }).click();
  await expect(page.getByText('Cliente E2E', { exact: true }).filter({ visible: true }).last()).toBeVisible();
  expect(requests).toHaveLength(1);
});

test('SuperAdmin compartilha tenants entre quatro abas', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-token'));
  const requests: string[] = [];
  await page.route('http://127.0.0.1:8000/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/super-admin/restaurantes') {
      requests.push(path);
      return route.fulfill({ json: [{ id: 'tenant-1', name: 'Restaurante E2E', status: 'ACTIVE', plan: 'pro' }] });
    }
    if (path === '/health/live') return route.fulfill({ json: { status: 'ok' } });
    if (path === '/api/super-admin/contracts') return route.fulfill({ json: { items: [], pendingCount: 0 } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/super-admin');
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(1);
  const before = requests.length;
  expect(before).toBe(1);
  for (const tab of ['Restaurantes', 'Pagamentos online', 'Planos e cobrança', 'Visão geral']) {
    await page.locator('#superadmin-sidebar').getByRole('button', { name: tab, exact: true }).click();
  }
  expect(requests).toHaveLength(1);
});

test('hints próximos de clientes geram uma reconciliação e preservam o snapshot durante refresh', async ({ page }, testInfo) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  let reads = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/fidelidade/clientes', async route => {
    reads++;
    if (reads === 2) await pending;
    await route.fulfill({ json: [{ id: 'cli-1', nome: reads === 1 ? 'Cliente E2E' : 'Cliente atualizado', telefone: '85999999999' }] });
  });
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  await expect.poll(() => reads).toBe(1);
  if (testInfo.project.name.startsWith('mobile')) await page.getByRole('button', { name: 'Abrir menu completo' }).click();
  await page.locator('.cashier-sidebar:visible').getByRole('button', { name: /^Clientes(?: \d+)?$/ }).click();
  await expect(page.getByText('Cliente E2E', { exact: true }).filter({ visible: true }).last()).toBeVisible();
  await page.evaluate(() => {
    for (let index = 0; index < 4; index++) window.dispatchEvent(new Event('koma_customers_updated'));
  });
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByText('Cliente E2E', { exact: true }).filter({ visible: true }).last()).toBeVisible();
  release();
  await expect(page.getByText('Cliente atualizado', { exact: true }).filter({ visible: true }).last()).toBeVisible();
  expect(reads).toBe(2);
});

test('falha inicial de clientes não aparece como lista vazia e permite tentar novamente', async ({ page }, testInfo) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  let reads = 0;
  await page.route('**/fidelidade/clientes', route => {
    reads++;
    return route.fulfill(reads === 1 ? { status: 503, json: {} } : { json: [{ id: 'cli-1', nome: 'Cliente E2E' }] });
  });
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  if (testInfo.project.name.startsWith('mobile')) await page.getByRole('button', { name: 'Abrir menu completo' }).click();
  await page.locator('.cashier-sidebar:visible').getByRole('button', { name: /^Clientes(?: \d+)?$/ }).click();
  await expect(page.getByText('Não foi possível carregar os clientes')).toBeVisible();
  await expect(page.getByText('Nenhum cliente cadastrado ainda')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByText('Cliente E2E', { exact: true }).filter({ visible: true }).last()).toBeVisible();
  expect(reads).toBe(2);
});

test('SuperAdmin distingue falha inicial de zero tenants e conserva snapshot após falha de refresh', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-token'));
  let reads = 0;
  await page.route('http://127.0.0.1:8000/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/super-admin/restaurantes') {
      reads++;
      return route.fulfill(reads === 1 || reads === 3
        ? { status: 503, json: { detail: 'Indisponível' } }
        : { json: [{ id: 'tenant-1', name: 'Restaurante E2E', status: 'ACTIVE', plan: 'pro' }] });
    }
    if (path === '/health/live') return route.fulfill({ json: { status: 'ok' } });
    if (path === '/api/super-admin/contracts') return route.fulfill({ json: { items: [], pendingCount: 0 } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/super-admin');
  await expect(page.getByText('Não foi possível carregar os restaurantes')).toBeVisible();
  await expect(page.getByText('Fonte indisponível')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByText('Restaurante E2E')).toBeVisible();
  await page.locator('#superadmin-sidebar').getByRole('button', { name: 'Restaurantes', exact: true }).click();
  await page.getByTitle('Atualizar lista').click();
  await expect(page.getByText('Mostrando os últimos restaurantes carregados.')).toBeVisible();
  await expect(page.getByText('Restaurante E2E')).toBeVisible();
  expect(reads).toBe(3);
});

test('nova sessão de Caixa não reaproveita clientes da sessão anterior', async ({ page }, testInfo) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  const tokens: string[] = [];
  await page.route('**/fidelidade/clientes', route => {
    const token = route.request().headers().authorization || '';
    tokens.push(token);
    return route.fulfill({ json: [{ id: 'cli-1', nome: token.includes('session-new-fixture') ? 'Cliente da nova sessão' : 'Cliente da sessão antiga' }] });
  });
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  if (testInfo.project.name.startsWith('mobile')) await page.getByRole('button', { name: 'Abrir menu completo' }).click();
  await page.locator('.cashier-sidebar:visible').getByRole('button', { name: /^Clientes(?: \d+)?$/ }).click();
  await expect(page.getByText('Cliente da sessão antiga', { exact: true }).filter({ visible: true }).last()).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.setItem('koma_caixa_token', 'session-new-fixture');
    sessionStorage.setItem('koma_active_operational_portal', 'caixa');
    sessionStorage.setItem('koma_caixa_id', 'operator-new-fixture');
    const previous = JSON.parse(sessionStorage.getItem('koma_operator_session_caixa') || '{}');
    sessionStorage.setItem('koma_operator_session_caixa', JSON.stringify({
      ...previous, token:'session-new-fixture', user:{...previous.user,id:'operator-new-fixture'},
    }));
    window.dispatchEvent(new Event('popstate'));
  });
  await expect(page.getByText('Cliente da nova sessão', { exact: true }).filter({ visible: true }).last()).toBeVisible();
  await expect(page.getByText('Cliente da sessão antiga', { exact: true })).toHaveCount(0);
  expect(tokens.some(token => token.includes('playwright-e2e-token'))).toBe(true);
  expect(tokens.some(token => token.includes('session-new-fixture'))).toBe(true);
});
