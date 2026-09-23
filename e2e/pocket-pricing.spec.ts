import { expect, test } from '@playwright/test';

test('Pocket publica R$ 39,90 e mantém apenas o ciclo mensal', async ({ page }) => {
  await page.route('**/api/contracts/payment-methods-v2', route => route.fulfill({
    json: { credit_card: true, pix: true, account_money: true, publicKey: 'TEST-public' },
  }));
  await page.goto('/contratar/pocket?cobranca=anual');
  await expect(page).toHaveURL(/\/contratar\/pocket\?cobranca=mensal/);
  await expect(page.getByRole('radio', { name: /^Pocket\b/ })).toContainText('R$ 39,90');
  await expect(page.getByText('7 dias grátis no componente fixo.')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Anual/ })).toHaveCount(0);
});

test('Pocket novo exige meio de pagamento para a mensalidade', async ({ page }) => {
  await page.route('**/api/contracts/payment-methods-v2', route => route.fulfill({
    json: { credit_card: false, pix: false, account_money: false, publicKey: '' },
  }));
  await page.route('**/api/signups', route => route.fulfill({
    status: 201,
    json: { id: 'pocket-signup-test', token: 'pocket-resume-test', message: 'Inscrição recebida.' },
  }));
  await page.goto('/contratar/pocket?cobranca=mensal');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Nome do restaurante', { exact: true }).fill('Bistrô Teste');
  await page.getByLabel('Seu nome', { exact: true }).fill('Ana Silva');
  await page.getByLabel('E-mail', { exact: true }).fill('ana@example.com');
  await page.getByLabel('WhatsApp', { exact: true }).fill('85999999999');
  await page.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(page.getByText(/meios de pagamento estão temporariamente indisponíveis/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aceitar e registrar contratação' })).toBeDisabled();
});

test('aceite Pocket antigo preserva R$ 0 ao retomar a inscrição', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('koma_signup_resume', 'legacy-pocket-token'));
  await page.route('**/api/contracts/payment-methods-v2', route => route.fulfill({
    json: { credit_card: true, pix: true, account_money: true, publicKey: 'TEST-public' },
  }));
  await page.route('**/api/signups/current', route => route.fulfill({
    json: {
      id: 'legacy-pocket-signup', token: 'legacy-pocket-token',
      data: { plan: 'pocket', billing_cycle: 'mensal', restaurant_name: 'Bistrô Antigo', responsible_name: 'Ana Silva', email: 'ana@example.com', phone: '85999999999' },
      receipt: {
        protocol: 'KOMA-CTR-20260918-LEGACY', acceptedAtBrasilia: '2026-09-18T12:00:00-03:00',
        contractingParty: { name: 'Ana Silva', taxId: '52998224725', taxIdKind: 'cpf', restaurantName: 'Bistrô Antigo', email: 'ana@example.com', phone: '85999999999' },
        representative: { name: 'Ana Silva', taxId: '52998224725', role: 'Titular da contratação' },
        commercial: { plan: 'pocket', billingCycle: 'mensal', fixedMonthlyPrice: '0.00', billingAmount: '0.00', marketplaceRate: '0.017900' },
        documents: { version: '2.6', terms: { hash: 't' }, commercial: { hash: 'c' } },
        evidence: { sourceIp: '127.0.0.1' },
      },
    },
  }));
  await page.goto('/contratar/pocket?cobranca=mensal');
  await page.getByRole('button', { name: 'Retomar inscrição' }).click();
  await expect(page.getByText('Seu contrato anterior mantém mensalidade fixa de R$ 0 e dispensa meio de pagamento.')).toBeVisible();
  await expect(page.getByText('Sem cobrança fixa')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Forma de pagamento/ })).toHaveCount(0);
  await expect(page.locator('.koma-sub-summary-price')).toContainText('R$ 0,00/mês');
});
