import { expect, test } from '@playwright/test';

// Simulação integral do checkout público, com backend e gateway isolados.
// Nenhuma cobrança/mandato é criado no Mercado Pago real.
const cases = [
  { plan: 'pocket', cycle: 'mensal', method: 'pix', amount: '79.90' },
  { plan: 'pocket', cycle: 'anual', method: 'pix', amount: '862.92' },
  { plan: 'pro', cycle: 'mensal', method: 'credit_card', amount: '179.90' },
  { plan: 'pro', cycle: 'anual', method: 'credit_card', amount: '1942.92' },
  { plan: 'premium', cycle: 'mensal', method: 'pix', amount: '329.90' },
  { plan: 'premium', cycle: 'anual', method: 'credit_card', amount: '3562.92' },
] as const;

for (const scenario of cases) {
  test(`${scenario.plan} ${scenario.cycle}: simula inscrição, escolha de ${scenario.method} e convite pós-liberação`, async ({ page }) => {
    const protocol = 'KOMA-CTR-20261015-ABCDEF123456';
    const mobile = scenario.plan === 'pocket' && scenario.cycle === 'mensal';
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    let acceptanceSeen = false;
    let billingSeen = false;

    await page.route('**/api/contracts/payment-methods-v2', route => route.fulfill({
      json: { credit_card: true, pix: true, account_money: false, publicKey: 'TEST-public' },
    }));
    await page.route('**/api/signups', route => route.fulfill({
      status: 201,
      json: { id: 'signup-checkout-e2e', token: 'resume-checkout-e2e', message: 'Inscrição salva.' },
    }));
    await page.route('**/api/signups/current', route => route.fulfill({
      json: { id: 'signup-checkout-e2e', token: 'resume-checkout-e2e', message: 'Inscrição atualizada.' },
    }));
    await page.route('**/api/contracts/accept', async route => {
      const data = route.request().postDataJSON();
      expect(data.plan).toBe(scenario.plan);
      expect(data.billing_cycle).toBe(scenario.cycle);
      expect(data.legal_version).toBe('3.5');
      expect(data.email).toBe('ana@example.com');
      acceptanceSeen = true;
      await route.fulfill({ status: 201, json: { receipt: {
        protocol,
        commercial: {
          plan: scenario.plan,
          billingCycle: scenario.cycle,
          fixedMonthlyPrice: scenario.plan === 'pocket' ? '79.90' : scenario.plan === 'pro' ? '179.90' : '329.90',
          billingAmount: scenario.amount,
          marketplaceRate: '0.000000',
        },
        documents: { version: '3.5' },
      } } });
    });
    await page.route(`**/api/contracts/${protocol}/billing/status`, route => route.fulfill({
      json: { billingStatus: 'pending', isActivated: false },
    }));
    await page.route('https://api.mercadopago.com/v1/card_tokens**', async route => {
      expect(scenario.method).toBe('credit_card');
      await route.fulfill({ status: 201, json: { id: 'tok_simulated' } });
    });
    const paymentPath = scenario.method === 'pix' ? 'pix/select' : 'setup';
    await page.route(`**/api/contracts/${protocol}/billing/${paymentPath}`, async route => {
      if (scenario.method === 'credit_card') {
        const data = route.request().postDataJSON();
        expect(data.payment_method_type).toBe('credit_card');
        expect(data.card_token_id).toBe('tok_simulated');
      } else {
        expect(route.request().postData()).toBeNull();
      }
      billingSeen = true;
      await route.fulfill({ status: 200, json: {
        status: 'awaiting_release',
        paymentMethodType: scenario.method,
        amountDueToday: 0,
        trialDays: 7,
        message: 'Inscrição simulada sem cobrança. Aguarde a liberação KÔMA.',
      } });
    });

    await page.goto(`/contratar/${scenario.plan}?cobranca=${scenario.cycle}`);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByLabel('Nome do restaurante', { exact: true }).fill('Bistrô Simulado');
    await page.getByLabel('Tipo de operação').selectOption('generic');
    await page.getByLabel('Seu nome', { exact: true }).fill('Ana Silva');
    await page.getByLabel('E-mail de acesso do administrador').fill('ana@example.com');
    await page.getByLabel('WhatsApp', { exact: true }).fill('85999999999');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();

    await expect(page.getByRole('heading', { name: 'Ative seu restaurante.' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(80);
    await expect(page.getByRole('radio', { name: /Saldo Mercado Pago/ })).toHaveCount(0);

    await page.getByLabel('CPF / CNPJ').fill('52998224725');
    await page.getByRole('radio', { name: scenario.method === 'pix' ? /^Pix/ : /^Cartão de crédito/ }).click();
    if (scenario.method === 'credit_card') {
      await page.getByLabel('Número do cartão').fill('4111111111111111');
      await page.getByLabel('Nome impresso no cartão').fill('ANA SILVA');
      await page.getByLabel('Validade').fill('12/30');
      await page.getByLabel('CVV').fill('123');
    }
    await page.locator('#legal-acceptance').check();
    await page.getByRole('button', { name: 'Aceitar e registrar contratação' }).click();
    await expect(page.getByText('Inscrição simulada sem cobrança. Aguarde a liberação KÔMA.')).toBeVisible();
    await expect(page.getByText(/Assim que a equipe KÔMA liberar seu acesso/)).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(80);
    expect(acceptanceSeen).toBe(true);
    expect(billingSeen).toBe(true);
    const actions = await page.evaluate(() => (window.__KOMA_ANALYTICS_EVENTS__ || [])
      .filter(event => event.event === 'operational_action').map(event => event.properties));
    expect(actions).toEqual([
      { action: 'signup_checkout', target: scenario.method, outcome: 'requested' },
      { action: 'signup_checkout', target: scenario.method, outcome: 'succeeded' },
    ]);
    expect(JSON.stringify(actions)).not.toMatch(/ana@|411111|529982|tok_simulated|resume-checkout/);
  });
}
