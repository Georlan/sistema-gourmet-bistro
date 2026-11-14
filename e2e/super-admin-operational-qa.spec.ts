import { expect, test } from '@playwright/test';

test('liberação de homologação exige motivo, respeita duração e registra somente o restaurante escolhido', async ({ page }) => {
  const requests: unknown[] = [];
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-token'));
  await page.route('**/api/super-admin/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/operational-qa')) {
      requests.push({ path, ...route.request().postDataJSON() });
      return route.fulfill({ json: { qaActive: true, expiresAt: '2026-11-13T15:00:00Z' } });
    }
    if (path.endsWith('/restaurantes')) return route.fulfill({ json: [{ id: '961301', name: 'Restaurante QA', status: 'ACTIVE', plan: 'pocket' }] });
    if (path.endsWith('/contracts')) return route.fulfill({ json: { items: [], pendingCount: 0 } });
    if (path.endsWith('/trials') || path.endsWith('/incidents') || path.endsWith('/issues')) return route.fulfill({ json: [] });
    if (path.endsWith('/release')) return route.fulfill({ json: { restaurant: {}, subscription: null, steps: { profile: true, hours: true, catalog: true, operations: true }, onboarding: { mode: 'administrative' }, readyForRelease: false, trialStarted: false } });
    if (path.includes('/access/restaurantes/')) return route.fulfill({ json: { activeUsers: 1, activeAdmins: 1, users: [], diagnostics: [] } });
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { effective: {}, baseline: {}, overrides: {}, plan: 'pocket' } });
    return route.fulfill({ json: {} });
  });
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/super-admin');
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Abrir menu lateral' }).click();
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir 360°', exact: true }).click();
  await page.getByRole('button', { name: 'Implantação', exact: true }).click();
  await page.getByRole('button', { name: 'Preparar liberação de teste' }).click();
  const submit = page.getByRole('button', { name: 'Liberar para testes' });
  await expect(submit).toBeDisabled();
  await page.getByLabel('Motivo', { exact: true }).fill('Homologação autorizada pelo restaurante');
  await page.getByLabel('Duração em horas (1 a 72)').fill('73');
  await expect(submit).toBeDisabled();
  await page.getByLabel('Duração em horas (1 a 72)').fill('72');
  await submit.click();
  await expect(page.getByRole('status').filter({ hasText: 'Homologação liberada' })).toBeVisible();
  expect(requests).toEqual([{ path: '/api/super-admin/onboarding/restaurantes/961301/operational-qa', action: 'start', hours: 72, reason: 'Homologação autorizada pelo restaurante' }]);
});
