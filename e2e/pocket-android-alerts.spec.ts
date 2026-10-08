import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession, cashierConfig } from './fixtures/cashier';

for (const theme of ['light', 'dark']) {
  test(`Pocket: ativar e revogar avisos sem bloquear pedidos (${theme})`, async ({ page }) => {
    await mockCashierBackend(page);
    await seedCashierSession(page);
    await page.addInitScript((theme) => {
      localStorage.setItem('@koma:theme', theme);
      Object.defineProperty(window, 'PushManager', { value: function () {} });
      Object.defineProperty(window, 'Notification', { value: { permission: 'default', requestPermission: async () => 'granted' } });
      const subscription = { endpoint: 'https://push.example.test/android', toJSON: () => ({ endpoint: 'https://push.example.test/android', keys: { p256dh: 'key', auth: 'auth' } }) };
      Object.defineProperty(navigator, 'serviceWorker', { value: {
        register: async () => ({}),
        getRegistration: async () => ({ active: {}, pushManager: { getSubscription: async () => subscription } }),
        addEventListener: () => {}, removeEventListener: () => {},
      } });
    }, theme);
    let enabled = false;
    const mutations: string[] = [];
    await page.route('**/caixa/notificacoes/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path.endsWith('/subscription')) { mutations.push(method); enabled = method === 'PUT'; }
      await route.fulfill({ json: path.endsWith('/config') ? { enabled: true, publicKey: 'cHVibGlj' } : { enabled } });
    });
    await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, plano: 'pocket', plano_efetivo: 'pocket', entitlements: { ...cashierConfig.entitlements, printing: false, kds: false } } }));
    await page.goto('/?view=caixa');
    const panel = page.getByRole('region', { name: 'Avisos fora do KÔMA' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Ativar', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Desativar' })).toBeVisible();
    await panel.getByRole('button', { name: 'Desativar' }).click();
    await expect(panel.getByRole('button', { name: 'Ativar', exact: true })).toBeVisible();
    expect(mutations).toEqual(['PUT', 'DELETE']);
    await expect(page.locator('.cashier-topbar')).toBeVisible();
    await expect(page.locator('.cashier-shell')).toHaveAttribute('data-koma-plan', 'pocket');
    const action = page.locator('.orders-card__action').first();
    if (await action.count()) expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  });
}

test('Loja sem habilitação continua sem alterar sua operação', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.route('**/caixa/notificacoes/config', route => route.fulfill({ json: { enabled: false, publicKey: '' } }));
  await page.goto('/?view=caixa');
  await expect(page.locator('.cashier-topbar')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Avisos fora do KÔMA' })).toHaveCount(0);
});
