import { expect, test } from '@playwright/test';

test('primeiro acesso aceita PDF para implantação assistida sem exigir JSON do restaurante', async ({ page }) => {
  let assistance: null | { id: string; filename: string; status: string } = null;
  await page.route('**/auth/ativar', route => route.fulfill({ json: { access_token: 'test-operator', usuario: { id: 'admin', cargo: 'admin', role: 'admin', nome: 'Ana', restaurante_id: 1 } } }));
  await page.route('**/api/subscription', route => route.fulfill({ json: { subscription: null } }));
  await page.route('**/api/onboarding/status', route => route.fulfill({ json: {
    restaurant: { id: '1', name: 'Bistrô Novo', slug: 'bistro', plan: 'pro' },
    trial: { status: 'setup', startsAt: null, endsAt: null, daysRemaining: 7 }, payments: { mercadoPagoConnected: false },
    counts: { products: 0, activeProducts: 0, tables: 0 },
    catalogAssistance: assistance ? { ...assistance, contentType: 'application/pdf', fileSize: 30, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : null,
    steps: { profile: false, hours: false, catalog: false, mercadoPago: false, firstOrder: false },
    progress: { completed: 0, total: 3, percent: 0 },
    capabilities: null,
    configuration: { complete: false, checks: [
      { id: 'profile', label: 'Contato ou endereço do restaurante', ok: false, required: true, message: 'Informe um endereço ou WhatsApp de contato.' },
      { id: 'hours', label: 'Horários de funcionamento', ok: false, required: true, message: 'Defina os horários de funcionamento.' },
      { id: 'catalog', label: 'Produto publicado', ok: false, required: true, message: 'Publique ao menos um produto ativo.' },
      { id: 'order_modes', label: 'Tipos de pedido', ok: false, required: true, message: 'Escolha ao menos um tipo de pedido.' },
    ] },
    operation: { started: false, startedAt: null },
    readiness: { ready: false, testOrderComplete: false, checks: [] },
  } }));
  await page.route('**/api/onboarding/catalog-assistance', async route => {
    assistance = { id: 'assist-1', filename: 'cardapio.pdf', status: 'pending' };
    await route.fulfill({ status: 201, json: { ...assistance, message: 'Cardápio recebido.' } });
  });

  await page.goto('/?view=ativar#token=test-invitation');
  await page.getByLabel('E-mail de Login', { exact: true }).fill('ana@example.com');
  await page.getByLabel('Nova Senha', { exact: true }).fill('test-only-password');
  await page.getByLabel('Confirme a Senha', { exact: true }).fill('test-only-password');
  await page.locator('button[type=submit]').click();

  await expect(page.getByRole('heading', { name: 'Já possui um cardápio?', exact: true })).toBeVisible();
  await expect(page.getByText(/não precisa preparar JSON/i)).toBeVisible();
  await page.getByLabel('Arquivo do cardápio para implantação assistida').setInputFiles({
    name: 'cardapio.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nmenu de teste'),
  });
  await page.getByRole('button', { name: 'Enviar para implantação' }).click();

  await expect(page.getByText('Recebido pela equipe KÔMA')).toBeVisible();
  await expect(page.getByText('cardapio.pdf')).toBeVisible();
  await expect(page.getByText('0 de 3 passos detectados como concluídos')).toBeVisible();
  await expect(page.getByText(/passo só fica pronto quando os produtos forem realmente publicados/i)).toBeVisible();
});
