import { expect, test } from '@playwright/test';

test('onboarding permite criar categorias do segmento em 1 toque e importar cardápio sem sair da tela', async ({ page }) => {
  let catalogReady = false;
  const createdCategories: Array<{ id: string; nome: string; destino_impressao: string }> = [];
  let importPayload: Record<string, unknown> | null = null;

  await page.route('**/auth/ativar', route => route.fulfill({
    json: {
      access_token: `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, role: 'admin', restaurante_id: 5 })).toString('base64url')}.test`,
      usuario: { id: 'admin', cargo: 'admin', role: 'admin', nome: 'Ana', restaurante_id: 5 },
    },
  }));
  await page.route('**/api/subscription', route => route.fulfill({ json: { subscription: null } }));
  await page.route('**/api/onboarding/status', route => route.fulfill({
    json: {
      restaurant: { id: '5', name: 'Hamburgueria Express', slug: 'burger-express', plan: 'pro', operationProfile: 'generic' },
      trial: { status: 'setup', startsAt: null, endsAt: null, daysRemaining: 7 },
      trialCanStart: false,
      readyForRelease: catalogReady,
      onboarding: { mode: 'commercial', releaseState: catalogReady ? 'awaiting_koma' : 'configuring', operationReleased: false, requiresKomaRelease: true },
      payments: { mercadoPagoConnected: false, pixOnlineAvailable: false },
      counts: { products: catalogReady ? 2 : 0, activeProducts: catalogReady ? 2 : 0, orders: 0, tables: 0 },
      operations: { configured: true, ready: true, legacyPolicy: false, orderTypes: ['retirada'], tableMapEnabled: false, serviceChargeEnabled: false, serviceChargePercent: 0, blockers: [] },
      catalogAssistance: null,
      steps: { profile: true, hours: true, catalog: catalogReady, operations: true, mercadoPago: false, firstOrder: false },
      progress: { completed: catalogReady ? 4 : 3, total: 4, percent: catalogReady ? 100 : 75 },
      readiness: {
        configurationComplete: catalogReady,
        trialStarted: false,
        operationReleased: false,
        readyToOperate: false,
        blockers: catalogReady ? ['trial'] : ['catalog'],
      },
    },
  }));

  await page.route('**/produtos/categorias', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: createdCategories });
    }
    const body = route.request().postDataJSON();
    createdCategories.push(body);
    return route.fulfill({ status: 201, json: body });
  });

  await page.route('**/produtos/importar', async route => {
    importPayload = route.request().postDataJSON();
    catalogReady = true;
    await route.fulfill({ status: 200, json: importPayload?.products || [] });
  });

  await page.goto('/?view=ativar#token=test-invitation');
  await page.getByLabel('E-mail de Login', { exact: true }).fill('ana@example.com');
  await page.getByLabel('Nova Senha', { exact: true }).fill('test-only-password');
  await page.getByLabel('Confirme a Senha', { exact: true }).fill('test-only-password');
  await page.locator('button[type=submit]').click();

  await expect(page.getByText(/Caminho rápido: publique seu cardápio agora no celular/i)).toBeVisible({ timeout: 15_000 });

  // 1. Cria categorias iniciais do segmento Hamburgueria com 1 toque
  await page.getByRole('button', { name: 'Criar categorias do segmento', exact: true }).click();
  await expect(page.getByText(/5 categoria\(s\) de Hamburgueria criadas/i)).toBeVisible();
  expect(createdCategories.length).toBe(5);

  // 2. Importa texto WhatsApp via modal self-service direto no onboarding
  await page.getByRole('button', { name: 'Importar texto / planilha', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar cardápio em massa', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator('textarea').fill('*HAMBÚRGUERES*\nSmash Duplo - R$ 24,00\nRefrigerante Lata - R$ 6,00');
  await dialog.getByRole('button', { name: 'Estruturar prévia', exact: true }).click();
  await dialog.getByRole('button', { name: /Publicar 2 item/i }).click();

  await expect.poll(() => importPayload?.mode).toBe('merge');
  await expect(dialog.getByText(/2 produtos publicados/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Concluir', exact: true }).click();

  await expect(page.getByText('4 de 4 itens essenciais concluídos')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
