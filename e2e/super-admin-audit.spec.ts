import { expect, test } from '@playwright/test';

test('360 consulta auditoria do tenant, pesquisa snapshots e distingue falha de histórico vazio', async ({ page }) => {
  const auditScopes: Array<string | null> = [];
  let unavailable = false;
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-superadmin-token'));
  await page.route('**/api/super-admin/**', async route => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname.endsWith('/restaurantes')) body = [{ id: '961301', name: 'Tenant Audit QA', plan: 'pro', status: 'ACTIVE', subdomain: 'audit-qa' }];
    else if (url.pathname.includes('/contracts')) body = { items: [], pendingCount: 0 };
    else if (url.pathname.endsWith('/audit')) {
      auditScopes.push(url.searchParams.get('tenant_id'));
      if (unavailable) return route.fulfill({ status: 503, json: { detail: 'Fonte temporariamente indisponível' } });
      body = [{ id: '42', restauranteId: '961301', restaurantName: 'Tenant Audit QA', actor: 'operador', action: 'UPDATE', reason: 'Corrigir modalidade', createdAt: '2026-10-03T12:00:00Z', beforeData: { delivery: false }, afterData: { delivery: true } }];
    } else if (url.pathname.includes('/incidents') || url.pathname.endsWith('/trials')) body = [];
    else return route.fulfill({ status: 503, json: { detail: 'Fonte fora do cenário de auditoria' } });
    await route.fulfill({ json: body });
  });
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/super-admin');
  const menu = page.getByRole('button', { name: 'Abrir menu lateral' });
  if (page.viewportSize()!.width < 1024) {
    await expect(menu).toBeVisible();
    await menu.click();
  }
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir 360°', exact: true }).click();
  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  await expect(page.getByText('Registro #42')).toBeVisible();
  expect(auditScopes.length).toBeGreaterThan(0);
  expect(auditScopes.every(scope => scope === '961301')).toBe(true);
  await page.getByLabel('Buscar ID, ator, motivo ou alteração').fill('delivery');
  await page.getByRole('button', { name: 'Ver alterações (before / after)' }).click();
  await expect(page.getByText('Estado Anterior (Before):')).toBeVisible();
  await expect(page.getByText('Novo Estado (After):')).toBeVisible();
  await page.getByLabel('Buscar ID, ator, motivo ou alteração').fill('inexistente');
  await expect(page.getByText('Nenhum registro nesta janela para os filtros selecionados')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  unavailable = true;
  await page.getByTitle('Atualizar trilha de auditoria').click();
  await expect(page.getByText('Auditoria indisponível', { exact: true })).toBeVisible();
  await expect(page.getByText('Registro #42')).toHaveCount(0);
});
