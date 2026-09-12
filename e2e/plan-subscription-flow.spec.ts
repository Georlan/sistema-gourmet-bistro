import { expect, test } from '@playwright/test';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasOverflow).toBe(false);
}

test.describe('checkout público de adesão KÔMA', () => {
  test('salva o contato antes de pedir documento ou cartão e retoma após recarregar', async ({ page }) => {
    const data = { restaurant_name: 'Bistrô Novo', responsible_name: 'Ana Silva', email: 'ana@example.com', phone: '85999999999', plan: 'premium', billing_cycle: 'anual' };
    let saved = false;
    await page.route('**/api/contracts/payment-methods', route => route.fulfill({ json: { credit_card: true, pix: true, publicKey: 'TEST-public' } }));
    await page.route('**/api/signups', async route => {
      expect(route.request().postDataJSON()).toEqual(data); saved = true;
      await route.fulfill({ status: 201, json: { id: '12345678-1234-1234-1234-123456789012', token: 'private-resume-token-test', message: 'Inscrição recebida.' } });
    });
    await page.route('**/api/signups/current', route => route.fulfill({ json: { id: '12345678-1234-1234-1234-123456789012', data, receipt: null } }));
    await page.goto('/contratar/premium?cobranca=anual');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Vamos começar.' })).toBeVisible();
    await expect(page.getByText('Número do cartão', { exact: true })).toHaveCount(0);
    await page.getByLabel('Nome do restaurante', { exact: true }).fill(data.restaurant_name);
    await page.getByLabel('Seu nome', { exact: true }).fill(data.responsible_name);
    await page.getByLabel('E-mail', { exact: true }).fill(data.email);
    await page.getByLabel('WhatsApp', { exact: true }).fill(data.phone);
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await expect(page.getByText('Inscrição recebida.', { exact: true })).toBeVisible();
    expect(saved).toBe(true);
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    expect(storage).not.toContain(data.email);
    expect(storage).not.toContain(data.phone);
    await page.reload();
    await expect(page.getByText('Sua inscrição foi recuperada. Continue de onde parou.')).toBeVisible();
    await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue(data.email);
    await page.getByRole('radio', { name: /Pix · pagamento único/ }).click();
    await expect(page.getByText('Número do cartão', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Pagamento único com 12 meses de acesso e 7 dias adicionais de bônus.')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('mensal permite salvar a inscrição mesmo com pagamentos indisponíveis', async ({ page }) => {
    await page.route('**/api/contracts/payment-methods', route => route.fulfill({ json: { credit_card: false, pix: false, publicKey: '' } }));
    await page.route('**/api/signups', route => route.fulfill({ status: 201, json: { id: '12345678-1234-1234-1234-123456789012', token: 'private-resume-token-test', message: 'Inscrição recebida.' } }));
    await page.goto('/contratar/pocket?cobranca=mensal');
    await expect(page.getByText('7 dias sem mensalidade fixa no cartão.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByLabel('Nome do restaurante', { exact: true }).fill('Bistrô Novo');
    await page.getByLabel('Seu nome', { exact: true }).fill('Ana Silva');
    await page.getByLabel('E-mail', { exact: true }).fill('ana@example.com');
    await page.getByLabel('WhatsApp', { exact: true }).fill('85999999999');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await expect(page.getByText(/Os pagamentos estão temporariamente indisponíveis/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceitar e registrar contratação' })).toBeDisabled();
    await expect(page.getByRole('radio', { name: /Pix/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('landing mantém foco em plano e preço sem expor roadmap de pagamentos', async ({ page }) => {
    await page.goto('/landing#planos');

    await expect(page.getByRole('group', { name: 'Escolha entre cobrança mensal ou anual' })).toBeVisible();
    await expect(page.getByLabel('Formas de pagamento da adesão')).toHaveCount(0);
    await expect(page.getByText('FORMAS DE PAGAMENTO', { exact: true })).toHaveCount(0);

    const billingSwitch = page.getByRole('group', { name: 'Escolha entre cobrança mensal ou anual' });
    await billingSwitch.getByRole('button', { name: /^Anual\b/ }).click();

    await expect(page.getByText(/É apenas uma referência de preço/)).toBeVisible();
    await expect(page.getByText(/condições de pagamento são apresentadas na contratação/)).toBeVisible();
    await expect(page.getByText('Pix', { exact: true })).toHaveCount(0);
    await expect(page.getByText('NuPay', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Boleto bancário', { exact: true })).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
  });
});