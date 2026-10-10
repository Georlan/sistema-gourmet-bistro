import { expect, test, type Route } from '@playwright/test';

test('QR de apresentação abre sem login e mostra o destino legível', async ({ page }) => {
  await page.goto('/siaratech/qr');
  await expect(page.getByRole('heading', { name: 'SEU PRÓXIMO PASSO.' })).toBeVisible();
  await expect(page.locator('svg').filter({ has: page.locator('title', { hasText: 'QR Code para conhecer o KÔMA' }) })).toBeVisible();
  await expect(page.getByText('komafood.com.br/siaratech', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('CRM salva qualificação, mantém consentimento e apresenta histórico', async ({ page }) => {
  let lead = { id: 1, nome: 'Ana Teste', whatsapp_raw: '(85) 99999-1234', whatsapp_normalizado: '5585999991234', empresa_nome: 'Bistrô Teste', event_slug: 'ceara-tech-summit-2026', source: 'qr_tela', status: 'new', consent_whatsapp: true, consent_at: '2026-10-07T01:00:00Z', consent_version: 'v1_cearatech_2026', owner_notification: { queue_status: 'sent', delivery_status: 'bounced' }, history: [] as unknown[] };
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'local-test-admin'));
  await page.route('**/api/super-admin/**', route => route.fulfill({ json: [] }));
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/leads/siaratech**', async route => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const patch = req.postDataJSON();
      expect(patch).not.toHaveProperty('consent_whatsapp');
      lead = { ...lead, ...patch, history: [{ id: 1, actor: 'local-test-admin', created_at: '2026-10-07T02:00:00Z', changes: { status: { before: 'new', after: 'qualified' } } }] };
    }
    await route.fulfill({ json: new URL(req.url()).pathname.endsWith('/1') ? lead : { total: 1, stats: { total: 1, new: 1, contacted: 0, qualified: 0, converted: 0, conversion_rate: 0 }, events: [], leads: [lead] } });
  });
  await page.goto('/super-admin');
  if (page.viewportSize()!.width < 1024) await page.getByRole('button', { name: 'Abrir menu lateral' }).click();
  await page.getByRole('button', { name: 'Leads', exact: true }).click();
  if (page.viewportSize()!.width < 768) await page.getByRole('button').filter({ hasText: 'Ana Teste' }).click();
  else await page.getByRole('button', { name: 'Ver lead', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Falha na entrega', { exact: true })).toBeVisible();
  await expect(dialog.getByText('v1_cearatech_2026', { exact: false })).toBeVisible();
  await dialog.getByLabel('Status', { exact: true }).selectOption('qualified');
  await dialog.getByLabel('Cidade', { exact: true }).fill('Fortaleza');
  await dialog.getByRole('button', { name: 'Salvar lead', exact: true }).click();
  await expect(dialog.getByText('Status: Novo → Qualificado', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Cidade', { exact: true })).toHaveValue('Fortaleza');
  await expect(dialog.getByRole('button', { name: 'Chamar no WhatsApp' })).toBeVisible();
});

test('endereço antigo ainda abre o QR de Siará', async ({ page }) => {
  await page.goto('/cearatech/qr');
  await expect(page.getByRole('img', { name: 'Siará Tech Summit 2026', exact: true })).toBeVisible();
  await expect(page.getByText('komafood.com.br/siaratech', { exact: true })).toBeVisible();
});

test('formulário Siará salva qualificação opcional e mostra Instagram e planos corretos', async ({ page }) => {
  await page.route('**/api/leads/siaratech/visits', route => route.fulfill({ status: 204 }));
  const capture = async (route: Route) => {
    const payload = route.request().postDataJSON();
    expect(payload.sistema_atual).toBe('Sistema Teste');
    expect(payload.principal_dor).toBe('Fechar o caixa');
    expect(payload.source).toBe('qr_tela');
    expect(payload.event_slug).toBe('ceara-tech-summit-2026');
    expect(payload.visit_id).toMatch(/^[a-f0-9-]{36}$/);
    await route.fulfill({ status: 201, json: { success: true, lead_id: 42, signup_url: '/contratar?event_ref=test-reference' } });
  };
  await page.route('**/api/leads/cearatech', capture);
  await page.route('**/api/leads/siaratech', route => page.viewportSize()!.width < 400 ? route.fulfill({ status: 404 }) : capture(route));
  await page.goto('/siaratech?source=qr_tela');
  await page.locator('#lead-nome').fill('Cliente Teste');
  await page.locator('#lead-whatsapp').fill('85999991234');
  await page.locator('summary').click();
  await page.getByLabel('Qual sistema você usa hoje?').fill('Sistema Teste');
  await page.getByLabel('Qual é sua maior dor de cabeça?').fill('Fechar o caixa');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'QUERO CONHECER O KÔMA' }).click();
  await expect(page.getByRole('heading', { name: 'Contato recebido ✓' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Seguir @georlanjunior no Instagram' })).toHaveAttribute('href', 'https://instagram.com/georlanjunior');
  await expect(page.getByRole('link', { name: 'Ver planos do KÔMA' })).toHaveAttribute('href', '/contratar?event_ref=test-reference');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
