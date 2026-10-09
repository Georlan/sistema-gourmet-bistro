import { expect, test } from '@playwright/test';

test('owner records unknown and confirmed costs without confusing restaurant sales with income', async ({ page }) => {
  let reads = 0;
  const updates: unknown[] = [];
  const costs = { chatgpt: null, database: null, railway: null, tools: null, taxes: null, other: null };
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'qa-token'));
  await page.route('**/api/super-admin/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/super-admin/finance') {
      reads++;
      return route.fulfill({ json: { period: '2026-10', received: '50', outstanding: '39', costs, known_costs: '0', unknown_costs: Object.keys(costs), recorded_result: null, coverage: 'Recebimentos externos não incluídos. Resultado registrado não comprova lucro total.', tenants: [{ tenant_id: '965901', received: '50', outstanding: '39' }] } });
    }
    if (path.includes('/finance/costs/')) {
      const body = route.request().postDataJSON(); updates.push(body);
      return route.fulfill({ json: { saved: true, costs: body.costs } });
    }
    return route.fulfill({ json: path.endsWith('/restaurantes') ? [] : { items: [], pendingCount: 0 } });
  });
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/super-admin');
  await page.getByRole('button', { name: /Financeiro KÔMA Recebimentos e custos/ }).click();
  await expect(page.getByText('Custos incompletos', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar custos do mês' })).toBeDisabled();
  const initialReads = reads;
  await page.getByLabel('ChatGPT', { exact: true }).fill('120');
  await page.getByLabel('Motivo do registro', { exact: true }).fill('Fatura conferida');
  await page.getByRole('button', { name: 'Salvar custos do mês' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Custos salvos' })).toBeVisible();
  await expect(page.getByText('Custos incompletos', { exact: true })).toBeVisible();
  expect(updates).toEqual([{ costs: { ...costs, chatgpt: '120' }, reason: 'Fatura conferida' }]);
  expect(reads).toBe(initialReads);
  for (const label of ['Banco de dados', 'Railway', 'Outras ferramentas e domínio', 'Impostos e tarifas', 'Outros custos']) await page.getByLabel(label, { exact: true }).fill('0');
  await page.getByLabel('Motivo do registro', { exact: true }).fill('Sem outros custos confirmados');
  await page.getByRole('button', { name: 'Salvar custos do mês' }).click();
  await expect(page.getByText('Custos incompletos', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/-.*70,00/)).toBeVisible();
});
