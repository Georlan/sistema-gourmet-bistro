import { expect, test, type Page } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
async function openStore(page: Page, storeId = 1) {
  await page.addInitScript(({ storeId }) => {
    if (sessionStorage.getItem('multistore-fixture-seeded')) return;
    const user = { id: `admin-${storeId}`, nome: `Admin ${storeId}`, role: 'admin', restaurante_id: storeId };
    const token = `store-${storeId}-token`;
    sessionStorage.setItem('koma_operator_session_caixa', JSON.stringify({ token, user, expiresAt: Date.now() + 600_000 }));
    sessionStorage.setItem('koma_caixa_token', token);
    sessionStorage.setItem('koma_caixa_id', user.id);
    sessionStorage.setItem('koma_caixa_name', user.nome);
    sessionStorage.setItem('koma_caixa_role', user.role);
    sessionStorage.setItem('koma_active_operational_portal', 'caixa');
    sessionStorage.setItem('multistore-fixture-seeded', '1');
  }, { storeId });
  await page.routeWebSocket(/\/ws\//, socket => { socket.onMessage(() => {}); });
  const reads: { path: string; token: string }[] = [];
  await page.route(`${API_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const token = route.request().headers().authorization || '';
    reads.push({ path, token });
    const id = token.includes('store-2-token') ? 2 : storeId;
    let body: unknown = [];
    if (path === '/auth/lojas') body = { current: { id, nome: `Loja ${id}` }, network: { id: 'rede-demo', nome: 'Rede Demo' }, units: [{ id: id === 2 ? 1 : 2, nome: id === 2 ? 'Matriz' : 'Filial Centro' }] };
    else if (path === '/caixa/configuracoes') body = { restaurante_id: id, nome: `Loja ${id}`, taxa_servico_ativa: false, taxa_servico_padrao: 0 };
    else if (path === '/api/onboarding/status') body = { onboarding: { releaseState: 'released' } };
    else if (path === '/produtos/catalogo') body = { categorias: [], produtos: [] };
    else if (path === '/caixa/turno/atual' || path === '/caixa/turno-atual') body = null;
    else if (path === '/caixa/turno-atual/resumo') body = { total_vendas: 0, comandas_abertas_count: 0 };
    else if (path === '/api/online-orders/control') body = { paused: false, max_active_orders: 50, level: 'normal', counts: { active: 0 } };
    await route.fulfill({ json: body });
  });
  await page.goto('/?view=caixa');
  return reads;
}
async function openSwitch(page: Page) {
  await expect(page.locator('.cashier-main')).toBeVisible();
  const mobileMenu = page.getByRole('button', { name: 'Abrir menu principal', exact: true });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page.getByRole('button', { name: 'Minhas lojas', exact: true }).click();
  return page.getByRole('dialog', { name: 'Minhas lojas', exact: true });
}

test('rede lista unidades autorizadas e troca sem outro login, preservando outra aba', async ({ page, context }) => {
  const reads = await openStore(page);
  const other = await context.newPage();
  await openStore(other, 3);
  let denied = true;
  const requests: string[] = [];
  await page.route(`${API_ORIGIN}/auth/lojas/2/entrar`, async route => {
    requests.push(route.request().headers().authorization);
    expect(route.request().postData()).toBeNull();
    if (denied) { denied = false; return route.fulfill({ status: 403, json: { detail: 'Acesso revogado' } }); }
    await route.fulfill({ json: { access_token: 'store-2-token', usuario: { id: 'manager-2', nome: 'Gerente Centro', role: 'gerente', restaurante_id: 2 } } });
  });
  await page.route(`${API_ORIGIN}/auth/login`, () => { throw new Error('A troca entre unidades não deve pedir outro login'); });
  const dialog = await openSwitch(page);
  await expect(dialog.getByText('Rede Rede Demo', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Filial Centro', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Acesso revogado');
  expect(await page.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('store-1-token');
  await dialog.getByRole('button', { name: 'Tentar novamente' }).click();
  await dialog.getByRole('button', { name: 'Filial Centro', exact: true }).click();
  await expect(dialog.getByText('Entrar em Filial Centro?')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('store-1-token');
  await dialog.getByRole('button', { name: 'Voltar às unidades' }).click();
  await dialog.getByRole('button', { name: 'Filial Centro', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirmar troca', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('store-2-token');
  await expect.poll(() => reads.some(read => read.path === '/caixa/configuracoes' && read.token === 'Bearer store-2-token')).toBe(true);
  expect(await other.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('store-3-token');
  expect(requests).toEqual(['Bearer store-1-token', 'Bearer store-1-token', 'Bearer store-1-token']);
});

test('loja independente explica o vínculo e não oferece login livre', async ({ page }) => {
  await openStore(page);
  await page.route(`${API_ORIGIN}/auth/lojas`, route => route.fulfill({ json: { current: { id: 1, nome: 'Loja independente' }, network: null, units: [] } }));
  const dialog = await openSwitch(page);
  await expect(dialog.getByText('Esta loja ainda não está vinculada a uma rede.', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Confirmar troca' })).toHaveCount(0);
});

test('rede sem permissão não confunde a loja com uma unidade independente', async ({ page }) => {
  await openStore(page);
  await page.route(`${API_ORIGIN}/auth/lojas`, route => route.fulfill({ json: { current: { id: 1, nome: 'Matriz' }, network: { id: 'rede-demo', nome: 'Rede Demo' }, units: [] } }));
  const dialog = await openSwitch(page);
  await expect(dialog.getByText('Você ainda não tem acesso autorizado a outra unidade desta rede.', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Loja independente', { exact: true })).toHaveCount(0);
});

test('fechar durante a consulta cancela a troca tardia', async ({ page }) => {
  await openStore(page);
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${API_ORIGIN}/auth/lojas/2/entrar`, async route => {
    await pending;
    await route.fulfill({ json: { access_token: 'store-2-token', usuario: { id: 'manager-2', nome: 'Gerente', role: 'gerente', restaurante_id: 2 } } }).catch(() => {});
  });
  const dialog = await openSwitch(page);
  const sent = page.waitForRequest(`${API_ORIGIN}/auth/lojas/2/entrar`);
  await dialog.getByRole('button', { name: 'Filial Centro', exact: true }).click();
  await sent;
  await dialog.getByRole('button', { name: 'Fechar minhas lojas' }).click();
  release();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('store-1-token');
});
