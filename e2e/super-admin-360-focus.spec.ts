import { expect, test } from '@playwright/test';

test('360 administrativo mantém foco e agrupa resumo sem apagar evidências', async ({ page }) => {
  let writes = 0;
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-token'));
  await page.route('**/api/super-admin/**', async route => {
    if (route.request().method() !== 'GET') writes++;
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/restaurantes')) return route.fulfill({ json: [{ id: '8', name: 'D8 QA', status: 'ACTIVE', plan: 'premium' }] });
    if (path.endsWith('/contracts')) return route.fulfill({ json: { items: [], pendingCount: 0 } });
    if (path.endsWith('/trials')) return route.fulfill({ json: [] });
    if (path.endsWith('/incidents/attention')) return route.fulfill({ json: { checked_at: '2026-10-07T04:00:00Z', items: [] } });
    if (path.endsWith('/release')) return route.fulfill({ json: {
      restaurant: { operationProfile: 'hamburgueria' }, subscription: null,
      steps: { profile: true, hours: true, catalog: true, operations: true },
      onboarding: { mode: 'administrative', operationReleased: true, requiresKomaRelease: false },
      readiness: { readyToOperate: true, blockers: [], operationReleased: true }, readyForRelease: false, trialStarted: false,
    } });
    if (path.includes('/access/restaurantes/')) return route.fulfill({ json: { activeUsers: 1, activeAdmins: 1, users: [], diagnostics: [] } });
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { effective: { printing: true }, baseline: {}, overrides: {}, plan: 'premium' } });
    if (path.endsWith('/incidents')) return route.fulfill({ json: [1, 2, 3, 4].map(id => ({
      id: `job-${id}`, tenant_id: 8, source: 'impressao', severity: 'medium', title: 'Documento retido', detail: `Documento ${id}`, evidence: { job: id }, recommended_action: 'Verificar agente', detected_at: '2026-10-07T04:00:00Z',
    })) });
    return route.fulfill({ json: {} });
  });
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/super-admin');
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Abrir menu lateral' }).click();
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir 360°', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'D8 QA', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gestão de Restaurantes' })).toHaveCount(0);
  await expect(page.getByText('hamburgueria', { exact: true })).toBeVisible();
  await expect(page.getByText('Documento retido · 4 ocorrências', { exact: true })).toBeVisible();
  await expect(page.getByText('Algumas fontes estão indisponíveis.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver os 4 incidentes e suas evidências na aba Operação' }).click();
  for (const id of [1, 2, 3, 4]) await expect(page.getByText(`Documento ${id}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar para restaurantes' }).click();
  await expect(page.getByRole('heading', { name: 'Gestão de Restaurantes' })).toBeVisible();
  expect(writes).toBe(0);
});
