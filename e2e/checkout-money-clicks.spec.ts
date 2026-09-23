import { expect, test } from '@playwright/test';

const cases = [
  { plan: 'pocket', cycle: 'mensal', method: 'pix', amount: '39.00', rate: '0.0179', endpoint: 'pix/select' },
  { plan: 'pocket', cycle: 'anual', method: 'pix', amount: '421.20', rate: '0.0179', endpoint: 'pix/select' },
  { plan: 'pro', cycle: 'anual', method: 'credit_card', amount: '1393.20', rate: '0.0050', endpoint: 'setup' },
  { plan: 'premium', cycle: 'anual', method: 'account_money', amount: '2689.20', rate: '0.0020', endpoint: 'setup' },
] as const;

for (const scenario of cases) {
  test(`${scenario.plan} ${scenario.cycle}: clique em ${scenario.method} mantém contrato e chamada financeira`, async ({ page }) => {
    const protocol = 'KOMA-CTR-20260923-ABCDEF123456';
    let acceptanceSeen = false;
    let billingSeen = false;
    await page.route('**/api/contracts/payment-methods-v2', route => route.fulfill({
      json: { credit_card: true, pix: true, account_money: true, publicKey: 'TEST-public' },
    }));
    await page.route('**/api/signups', route => route.fulfill({
      status: 201,
      json: { id: 'signup-money-clicks', token: 'resume-money-clicks', message: 'Inscrição recebida.' },
    }));
    await page.route('**/api/signups/current', route => route.fulfill({
      json: { id: 'signup-money-clicks', token: 'resume-money-clicks', message: 'Inscrição atualizada.' },
    }));
    await page.route('**/api/contracts/accept', async route => {
      const payload = route.request().postDataJSON();
      expect(payload.plan).toBe(scenario.plan);
      expect(payload.billing_cycle).toBe(scenario.cycle);
      expect(payload.legal_version).toBe('2.9');
      acceptanceSeen = true;
      await route.fulfill({ status: 201, json: { receipt: {
        protocol,
        commercial: {
          plan: scenario.plan,
          billingCycle: scenario.cycle,
          fixedMonthlyPrice: scenario.plan === 'pocket' ? '39.00' : scenario.plan === 'pro' ? '129.00' : '249.00',
          billingAmount: scenario.amount,
          marketplaceRate: scenario.rate,
        },
        documents: { version: '2.9' },
      } } });
    });
    await page.route('https://api.mercadopago.com/v1/card_tokens**', async route => {
      expect(scenario.method).toBe('credit_card');
      await route.fulfill({ status: 201, json: { id: 'tok_simulated' } });
    });
    await page.route(`**/api/contracts/${protocol}/billing/${scenario.endpoint}`, async route => {
      if (scenario.endpoint === 'setup') {
        const payload = route.request().postDataJSON();
        expect(payload.payment_method_type).toBe(scenario.method);
        if (scenario.method === 'credit_card') expect(payload.card_token_id).toBe('tok_simulated');
      } else {
        expect(route.request().postData()).toBeNull();
      }
      billingSeen = true;
      await route.fulfill({ status: 200, json: {
        status: 'awaiting_release', paymentMethodType: scenario.method,
        amountDueToday: 0, trialDays: 7, message: 'Simulação sem cobrança.',
      } });
    });

    await page.goto(`/contratar/${scenario.plan}?cobranca=${scenario.cycle}`);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByLabel('Nome do restaurante', { exact: true }).fill('Bistrô Simulado');
    await page.getByLabel('Seu nome', { exact: true }).fill('Ana Silva');
    await page.getByLabel('E-mail', { exact: true }).fill('ana@example.com');
    await page.getByLabel('WhatsApp', { exact: true }).fill('85999999999');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await page.getByLabel('CPF / CNPJ').fill('52998224725');
    const methodName = scenario.method === 'pix' ? /^Pix/ : scenario.method === 'credit_card' ? /^Cartão de crédito/ : /^Saldo Mercado Pago/;
    await page.getByRole('radio', { name: methodName }).click();
    if (scenario.method === 'credit_card') {
      await page.getByLabel('Número do cartão').fill('4111111111111111');
      await page.getByLabel('Nome impresso no cartão').fill('ANA SILVA');
      await page.getByLabel('Validade').fill('12/30');
      await page.getByLabel('CVV').fill('123');
    }
    await page.locator('#legal-acceptance').check();
    await expect(page.locator('.koma-sub-legal-acceptance')).toContainText(scenario.plan === 'pocket' ? (scenario.cycle === 'anual' ? 'R$ 421,20' : 'R$ 39,00') : scenario.plan === 'pro' ? 'R$ 1.393,20' : 'R$ 2.689,20');
    await page.getByRole('button', { name: 'Aceitar e registrar contratação' }).click();
    await expect(page.getByText('Simulação sem cobrança.')).toBeVisible();
    expect(acceptanceSeen).toBe(true);
    expect(billingSeen).toBe(true);
  });
}
