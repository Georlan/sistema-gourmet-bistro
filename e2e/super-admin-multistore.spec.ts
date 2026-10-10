import { expect, test } from '@playwright/test';

test('SuperAdmin cadastra rede e autoriza contas de ida e volta com motivo', async ({ page }) => {
  const network = { id: 'rede-e2e', owner_id: 8, nome: 'Rede QA' };
  let created = false;
  let grants: any[] = [];
  const writes: { path: string; method: string; body: any }[] = [];
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-token'));
  await page.route('**/api/super-admin/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      const body = request.postDataJSON();
      writes.push({ path, method: request.method(), body });
      if (path.endsWith('/multistore/networks')) { created = true; return route.fulfill({ json: network }); }
      if (request.method() === 'DELETE') { grants = []; return route.fulfill({ json: { revoked: true } }); }
      if (path.endsWith('/units/8/accesses')) grants = [{ id: 'grant-a', user_id: 'admin-8', target_id: 9, target_user_id: 'admin-9' }];
      return route.fulfill({ json: { id: 'grant-a' } });
    }
    if (path.endsWith('/multistore/units/8')) return route.fulfill({ json: { network: created ? network : null, accesses: grants } });
    if (path.endsWith('/multistore/units/9')) return route.fulfill({ json: { network, accesses: [] } });
    if (path.endsWith('/restaurantes')) return route.fulfill({ json: [{ id: '8', name: 'Loja QA', status: 'ACTIVE', plan: 'premium' }] });
    if (path.endsWith('/contracts')) return route.fulfill({ json: { items: [], pendingCount: 0 } });
    if (path.endsWith('/trials')) return route.fulfill({ json: [] });
    if (path.endsWith('/incidents/attention')) return route.fulfill({ json: { items: [] } });
    if (path.endsWith('/release')) return route.fulfill({ json: { restaurant: {}, steps: {}, readiness: {}, onboarding: {} } });
    if (path.includes('/access/restaurantes/')) {
      const id = path.endsWith('/9') ? 9 : 8;
      return route.fulfill({ json: { activeUsers: 1, activeAdmins: 1, users: [{ id: `admin-${id}`, name: `Gestor ${id}`, role: 'admin', status: 'ativo' }], diagnostics: [] } });
    }
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { effective: {}, baseline: {}, overrides: {} } });
    if (path.endsWith('/incidents') || path.endsWith('/issues')) return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/super-admin');
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Abrir menu lateral' }).click();
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir 360°', exact: true }).click();
  await page.getByRole('button', { name: 'Equipe', exact: true }).click();
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Rede e unidades autorizadas' }) });
  await expect(section.getByText('Loja independente', { exact: true })).toBeVisible();
  await section.getByLabel('Criar rede com esta loja como matriz').fill('Rede QA');
  await expect(section.getByRole('button', { name: 'Criar rede', exact: true })).toBeDisabled();
  await section.getByLabel('Motivo da alteração').fill('Propriedade e identidade confirmadas');
  await section.getByRole('button', { name: 'Criar rede', exact: true }).click();
  await expect(section.getByText('Rede: Rede QA', { exact: true })).toBeVisible();
  await section.getByLabel('Gestor desta loja').selectOption('admin-8');
  await section.getByLabel('ID da unidade de destino').fill('9');
  await section.getByRole('button', { name: 'Consultar gestores da unidade' }).click();
  await section.getByLabel('Conta do mesmo gestor na unidade de destino').selectOption('admin-9');
  await section.getByRole('button', { name: 'Autorizar troca entre unidades' }).click();
  await expect(section.getByText('Gestor 8 → Loja #9', { exact: true })).toBeVisible();
  expect(writes).toEqual([
    { path: '/api/super-admin/multistore/networks', method: 'POST', body: { owner_id: 8, nome: 'Rede QA', reason: 'Propriedade e identidade confirmadas' } },
    { path: '/api/super-admin/multistore/units/8/accesses', method: 'POST', body: { user_id: 'admin-8', target_id: 9, target_user_id: 'admin-9', reason: 'Propriedade e identidade confirmadas' } },
    { path: '/api/super-admin/multistore/units/9/accesses', method: 'POST', body: { user_id: 'admin-9', target_id: 8, target_user_id: 'admin-8', reason: 'Propriedade e identidade confirmadas' } },
  ]);
  await section.getByRole('button', { name: 'Revogar acesso de ida' }).click();
  await expect(section.getByText('Gestor 8 → Loja #9', { exact: true })).toHaveCount(0);
  expect(writes.at(-1)?.method).toBe('DELETE');
});
