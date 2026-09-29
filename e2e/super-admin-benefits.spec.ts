import { expect, test } from '@playwright/test';

test('Pocket mantém plano ao conceder, revogar e restaurar benefício com motivo', async ({ page }) => {
  const mutations: Array<{ mode: string; reason: string }> = [];
  let override: boolean | undefined;
  const snapshot = () => ({ restaurantId: '961301', plan: 'pocket', baseline: { printing: false }, overrides: override === undefined ? {} : { printing: { enabled: override, source: 'manual' } }, effective: { printing: override === true } });
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-superadmin-token'));
  await page.route('**/api/super-admin/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith('/capabilities/printing')) {
      const payload = route.request().postDataJSON();
      mutations.push(payload);
      override = payload.mode === 'baseline' ? undefined : payload.mode === 'grant';
      body = snapshot();
    } else if (path.endsWith('/capabilities')) body = snapshot();
    else if (path.endsWith('/restaurantes')) body = [{ id: '961301', name: 'Primeiro Cliente QA', plan: 'pocket', status: 'ACTIVE', subdomain: 'primeiro-qa', onlinePaymentStatus: 'disconnected' }];
    else if (path.includes('/contracts')) body = { items: [], pendingCount: 0 };
    await route.fulfill({ json: body });
  });
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok', commit: 'e2e' } }));
  await page.goto('/super-admin');
  const mobileMenu = page.getByRole('button', { name: 'Abrir menu lateral' });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page.getByRole('button', { name: 'Restaurantes', exact: true }).click();
  await page.getByRole('button', { name: 'Recursos/Benefícios', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Recursos\/Benefícios/ });
  await expect(dialog).toContainText('Plano comercial: pocket');
  await expect(dialog.getByRole('row').nth(1)).toContainText('Sem override');
  await dialog.getByLabel('Motivo obrigatório').fill('   ');
  await dialog.getByRole('button', { name: 'Salvar benefício' }).click();
  expect(mutations).toHaveLength(0);
  await expect(dialog.getByRole('alert')).toContainText('Informe um motivo');
  for (const [mode, display] of [['grant', 'Liberado (manual)'], ['revoke', 'Revogado (manual)'], ['baseline', 'Sem override']]) {
    await dialog.getByLabel('Ação', { exact: true }).selectOption(mode);
    await dialog.getByLabel('Motivo obrigatório').fill(`Primeiro cliente KÔMA; extra R$ 0; ação ${mode}`);
    await dialog.getByRole('button', { name: 'Salvar benefício' }).click();
    await expect(dialog.getByRole('status')).toContainText('Alteração salva');
    await expect(dialog.getByRole('row').nth(1)).toContainText(display);
    await expect(dialog).toContainText('Plano comercial: pocket');
  }
  expect(mutations.map(item => item.mode)).toEqual(['grant', 'revoke', 'baseline']);
  expect(mutations.every(item => item.reason.includes('R$ 0'))).toBe(true);
});
