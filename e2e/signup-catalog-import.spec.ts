import { expect, test } from '@playwright/test';

test('primeiro acesso permite revisar e publicar o cardápio sem substituir por padrão', async ({ page }) => {
  let imported: unknown = null;
  await page.route('**/auth/ativar', route => route.fulfill({ json: { access_token: 'test-operator', usuario: { id: 'admin', cargo: 'admin', role: 'admin', nome: 'Ana', restaurante_id: 1 } } }));
  await page.route('**/api/subscription', route => route.fulfill({ json: { subscription: null } }));
  await page.route('**/api/onboarding/status', route => route.fulfill({ json: {
    restaurant: { id: '1', name: 'Bistrô Novo', slug: 'bistro', plan: 'pro' },
    trial: { status: 'active', startsAt: null, endsAt: null, daysRemaining: 7 }, payments: { mercadoPagoConnected: false },
    counts: { products: imported ? 1 : 0, orders: 0 }, steps: { profile: false, hours: false, catalog: Boolean(imported), mercadoPago: false, firstOrder: false },
    progress: { completed: imported ? 1 : 0, total: 5, percent: imported ? 20 : 0 },
  } }));
  await page.route('**/produtos/importar', async route => { imported = route.request().postDataJSON(); await route.fulfill({ json: [] }); });
  await page.goto('/?view=ativar#token=test-invitation');
  await page.getByLabel('E-mail de Login', { exact: true }).fill('ana@example.com');
  await page.getByLabel('Nova Senha', { exact: true }).fill('test-only-password');
  await page.getByLabel('Confirme a Senha', { exact: true }).fill('test-only-password');
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('heading', { name: 'Importar cardápio', exact: true })).toBeVisible();
  const product={ id: 'prato-1', nome: 'Prato do dia', preco: 25.9, categoria_id: 'cat-pratos' };
  await page.getByLabel('Arquivo do cardápio').setInputFiles({ name: 'cardapio.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([product])) });
  await expect(page.getByRole('cell', { name: 'Prato do dia', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publicar cardápio' })).toBeDisabled();
  await expect(page.getByLabel('Modo da importação')).toHaveValue('merge');
  await page.getByRole('checkbox', { name: 'Conferi nomes e preços.' }).check();
  await page.getByRole('button', { name: 'Publicar cardápio' }).click();
  await expect.poll(() => imported).toEqual({ mode: 'merge', products: [product] });
  await expect(page.getByText('1 de 5 passos detectados como concluídos')).toBeVisible();
});
