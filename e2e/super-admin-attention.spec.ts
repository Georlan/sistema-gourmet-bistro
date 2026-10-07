import { expect, test } from '@playwright/test';
test('restaurantes prioriza atenção real e distingue diagnóstico indisponível', async ({ page }) => {
  let failed = false;
  let reads = 0;
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-token'));
  await page.route('**/api/super-admin/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/restaurantes')) return route.fulfill({ json: [
      { id: '1', name: 'Alfa', status: 'ACTIVE', plan: 'pro' }, { id: '2', name: 'Zulu crítico', status: 'ACTIVE', plan: 'pro' },
    ] });
    if (path.endsWith('/contracts')) return route.fulfill({ json: { items: [], pendingCount: 0 } });
    if (path.endsWith('/incidents/attention')) {
      reads++;
      if (failed) return route.fulfill({ status: 503, json: { detail: 'Indisponível' } });
      return route.fulfill({ json: { checked_at: '2026-10-03T12:00:00Z', items: [
        { tenant_id: '1', priority: 'no_attention', blockers: [], release_state: 'released', incident_count: 0, incident_sources: [], primary_incident: null, unavailable_sources: [] },
        { tenant_id: '2', priority: 'critical', blockers: [], release_state: null, incident_count: 1, incident_sources: ['outbox'], primary_incident: { id: 'event-42', source: 'outbox', severity: 'critical', title: 'Mensageria falhou', detected_at: '2026-10-03T10:00:00Z', recommended_action: 'Abrir incidente' }, unavailable_sources: ['onboarding'] },
      ] } });
    }
    return route.fulfill({ json: {} });
  });
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/super-admin');
  if (await page.getByRole('button', { name: 'Abrir menu lateral' }).isVisible()) await page.getByRole('button', { name: 'Abrir menu lateral' }).click();
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  const table = page.getByRole('table').first();
  await expect(table.getByRole('row').nth(1)).toContainText('Zulu crítico');
  await expect(table.getByRole('row').nth(1)).toContainText('event-42');
  await expect(table.getByRole('row').nth(1)).toContainText('Fonte indisponível: onboarding');
  expect(reads).toBe(1);
  await page.getByLabel('Filtrar atenção').selectOption('outbox');
  await expect(table.getByRole('row')).toHaveCount(2);
  await page.getByLabel('Filtrar atenção').selectOption('ALL');
  failed = true;
  await page.getByRole('button', { name: 'Atualizar prioridades' }).click();
  await expect(page.getByText('Diagnóstico de prioridades indisponível.')).toBeVisible();
  await expect(table.getByText('Sem atenção detectada')).toHaveCount(0);
});
