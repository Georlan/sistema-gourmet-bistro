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
    if (path === '/caixa/configuracoes') body = { restaurante_id: id, nome: `Loja ${id}`, taxa_servico_ativa: false, taxa_servico_padrao: 0 };
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
  await page.getByRole('button', { name: 'Trocar loja', exact: true }).click();
  return page.getByRole('dialog', { name: 'Trocar loja', exact: true });
}

test('troca confirmada usa o token da filial e preserva a loja em outra aba', async ({ page, context }) => {
  const reads = await openStore(page);
  const other = await context.newPage();
  await openStore(other, 3);
  let rejectLogin = true;
  const bodies: Record<string, unknown>[] = [];
  await page.route(`${API_ORIGIN}/auth/login`, async route => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (rejectLogin) {
      rejectLogin = false;
      return route.fulfill({ status: 401, json: { detail: 'Usuário ou senha incorretos' } });
    }
    if (!body.restaurante_id) return route.fulfill({ status: 409, json: { detail: {
      code: 'restaurant_selection_required', restaurantes: [{ id: 1, nome: 'Matriz' }, { id: 2, nome: 'Filial Centro' }],
    } } });
    expect(body.restaurante_id).toBe(2);
    await route.fulfill({ json: { access_token: 'store-2-token', usuario: { id: 'manager-2', nome: 'Gerente Centro', role: 'gerente', restaurante_id: 2 } } });
  });
  let dialog = await openSwitch(page);
  await dialog.getByLabel('E-mail', { exact: true }).fill('admin@koma.test');
  await dialog.getByLabel('Senha', { exact: true }).fill('senha-teste');
  await dialog.getByRole('button', { name: 'Confirmar acesso', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Usuário ou senha incorretos');
  expect(await page.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('store-1-token');
  await dialog.getByRole('button', { name: 'Confirmar acesso', exact: true }).click();
  await dialog.getByLabel('Loja de destino', { exact: true }).selectOption('2');
  await dialog.getByRole('button', { name: 'Acessar loja selecionada', exact: true }).click();
  await expect(dialog.getByText('Entrar em Filial Centro como Gerente Centro?')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('store-1-token');
  // Cancelling after valid authentication still leaves the original store intact.
  await dialog.getByRole('button', { name: 'Fechar troca de loja' }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('store-1-token');
  const mobileMenu = page.getByRole('dialog', { name: 'Menu principal', exact: true });
  if (await mobileMenu.isVisible()) await mobileMenu.getByRole('button', { name: 'Fechar menu', exact: true }).click();
  dialog = await openSwitch(page);
  await dialog.getByLabel('E-mail', { exact: true }).fill('admin@koma.test');
  await dialog.getByLabel('Senha', { exact: true }).fill('senha-teste');
  await dialog.getByRole('button', { name: 'Confirmar acesso', exact: true }).click();
  await dialog.getByLabel('Loja de destino', { exact: true }).selectOption('2');
  await dialog.getByRole('button', { name: 'Acessar loja selecionada', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirmar troca', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('store-2-token');
  await expect.poll(() => reads.some(read => read.path === '/caixa/configuracoes' && read.token === 'Bearer store-2-token')).toBe(true);
  expect(await other.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('store-3-token');
  expect(bodies.at(-1)).toEqual({ username: 'admin@koma.test', password: 'senha-teste', restaurante_id: 2 });
});

test('fechar durante autenticação impede a troca tardia', async ({ page }) => {
  await openStore(page);
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${API_ORIGIN}/auth/login`, async route => {
    await pending;
    await route.fulfill({ json: { access_token: 'store-2-token', usuario: { id: 'manager-2', nome: 'Gerente', role: 'gerente', restaurante_id: 2 } } }).catch(() => {});
  });
  const dialog = await openSwitch(page);
  await dialog.getByLabel('E-mail', { exact: true }).fill('admin@koma.test');
  await dialog.getByLabel('Senha', { exact: true }).fill('senha-teste');
  const sent = page.waitForRequest(`${API_ORIGIN}/auth/login`);
  await dialog.getByRole('button', { name: 'Confirmar acesso', exact: true }).click();
  await sent;
  await dialog.getByRole('button', { name: 'Fechar troca de loja' }).click();
  release();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('koma_caixa_token'))).toBe('store-1-token');
});
