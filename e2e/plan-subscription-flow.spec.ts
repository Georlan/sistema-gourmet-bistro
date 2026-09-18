import { expect, test } from '@playwright/test';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasOverflow).toBe(false);
}

test.describe('checkout público de adesão KÔMA', () => {
  test('salva o contato antes de pedir documento ou cartão e retoma após recarregar', async ({ page }) => {
    const data = { restaurant_name: 'Bistrô Novo', responsible_name: 'Ana Silva', email: 'ana@example.com', phone: '85999999999', plan: 'premium', billing_cycle: 'anual' };
    let saved = false;
    await page.route('**/api/contracts/payment-methods', route => route.fulfill({ json: { credit_card: true, pix: false, pix_automatic: true, account_money: true, publicKey: 'TEST-public' } }));
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
    await expect(page.getByRole('radio', { name: /Saldo Mercado Pago/ })).toBeVisible();
    await page.getByRole('radio', { name: /Pix Automático/ }).click();
    await expect(page.getByText('Número do cartão', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Nenhum Pix avulso será gerado e nenhuma mensalidade fixa será cobrada hoje/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('mensal permite salvar a inscrição mesmo com pagamentos indisponíveis', async ({ page }) => {
    await page.route('**/api/contracts/payment-methods', route => route.fulfill({ json: { credit_card: false, pix: false, pix_automatic: false, account_money: false, publicKey: '' } }));
    await page.route('**/api/signups', route => route.fulfill({ status: 201, json: { id: '12345678-1234-1234-1234-123456789012', token: 'private-resume-token-test', message: 'Inscrição recebida.' } }));
    await page.goto('/contratar/pocket?cobranca=mensal');
    await expect(page.getByText('7 dias grátis em qualquer forma de pagamento.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByLabel('Nome do restaurante', { exact: true }).fill('Bistrô Novo');
    await page.getByLabel('Seu nome', { exact: true }).fill('Ana Silva');
    await page.getByLabel('E-mail', { exact: true }).fill('ana@example.com');
    await page.getByLabel('WhatsApp', { exact: true }).fill('85999999999');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await expect(page.getByText(/temporariamente indisponíveis/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceitar e registrar contratação' })).toBeDisabled();
    await expect(page.getByRole('radio', { name: /Pix Automático/ })).toContainText('indisponível no momento');
    await expect(page.getByRole('radio', { name: /Saldo Mercado Pago/ })).toContainText('indisponível no momento');
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

  test('permite trocar plano e ciclo após contrato gerado quando não há autorização financeira', async ({ page }) => {
    const initialData = {
      restaurant_name: 'Bistrô das Flores',
      responsible_name: 'Carlos Lima',
      email: 'carlos@bistro.com',
      phone: '11988887777',
      plan: 'pro',
      billing_cycle: 'anual',
    };
    const receipt = {
      protocol: 'KOMA-CTR-20260913-9876543210AB',
      acceptedAtUtc: '2026-09-13T12:00:00Z',
      acceptedAtBrasilia: '2026-09-13T09:00:00-03:00',
      provider: { name: 'KÔMA', taxId: '00.000.000/0001-00', address: 'Rua Central, 100', location: 'São Paulo/SP' },
      contractingParty: {
        name: 'Carlos Lima ME',
        taxId: '12345678000195',
        taxIdKind: 'cnpj',
        restaurantName: 'Bistrô das Flores',
        email: 'carlos@bistro.com',
        phone: '11988887777',
      },
      representative: { name: 'Carlos Lima', taxId: '12345678901', role: 'Administrador', powersDeclared: true },
      commercial: {
        plan: 'pro',
        billingCycle: 'anual',
        fixedMonthlyPrice: '129.00',
        billingAmount: '1393.20',
        annualMonthlyEquivalent: '116.10',
        marketplaceRate: '0.005000',
        trialDays: 7,
        trialWaivesFixedFeeOnly: true,
      },
      documents: {
        version: '2.6',
        terms: { slug: 'termos', hash: 'h1' },
        commercial: { slug: 'planos', hash: 'h2' },
        dpa: { slug: 'dpa', hash: 'h3' },
        privacy: { slug: 'privacidade', hash: 'h4' },
        sourceCommit: 'test-commit',
        sourceBlobSha: 'test-sha',
      },
      evidence: {
        requestId: 'old-signup-id',
        sourceIp: '127.0.0.1',
        ipSource: 'header',
        sourceIpHash: 'ip-hash',
        userAgent: 'test-agent',
        userAgentHash: 'ua-hash',
      },
      provisioning: { status: 'ready', message: 'Aguardando pagamento' },
    };

    let postSignupCalled = false;
    let postSignupPayload: any = null;

    await page.route('**/api/contracts/payment-methods', route =>
      route.fulfill({ json: { credit_card: true, pix: false, pix_automatic: true, account_money: true, publicKey: 'TEST-public' } }),
    );
    await page.route('**/api/contracts/KOMA-CTR-20260913-9876543210AB/billing/status', route =>
      route.fulfill({
        json: {
          protocol: 'KOMA-CTR-20260913-9876543210AB',
          billingStatus: 'pending',
          provider: null,
          paymentMethodType: null,
          isActivated: false,
          restaurantId: null,
          slug: null,
        },
      }),
    );
    await page.route('**/api/signups', async route => {
      postSignupCalled = true;
      postSignupPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        json: { id: 'new-signup-id-uuid', token: 'new-resume-token', message: 'Nova inscrição recebida.' },
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem('koma_signup_resume', 'old-token');
    });

    await page.route('**/api/signups/current', route =>
      route.fulfill({
        json: {
          id: 'old-signup-id',
          data: initialData,
          receipt,
        },
      }),
    );

    await page.goto('/contratar/pro?cobranca=anual');
    await expect(page.getByText('Sua inscrição foi recuperada. Continue de onde parou.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trocar plano ou ciclo' })).toBeVisible();

    await page.getByRole('button', { name: 'Trocar plano ou ciclo' }).click();

    await expect(page.getByText(/Seus dados foram preservados\. Escolha outro plano ou ciclo\./)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Escolha o KÔMA certo para sua operação.' })).toBeVisible();

    await page.getByRole('radio', { name: /^Pocket\b/ }).click();
    await page.getByRole('radio', { name: /^Mensal\b/ }).click();

    await page.getByRole('button', { name: 'Continuar', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Vamos começar.' })).toBeVisible();
    await expect(page.getByLabel('Nome do restaurante', { exact: true })).toHaveValue('Bistrô das Flores');
    await expect(page.getByLabel('Seu nome', { exact: true })).toHaveValue('Carlos Lima');
    await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('carlos@bistro.com');
    await expect(page.getByLabel('WhatsApp', { exact: true })).toHaveValue('11988887777');

    await page.getByRole('button', { name: 'Salvar e continuar' }).click();

    expect(postSignupCalled).toBe(true);
    expect(postSignupPayload.plan).toBe('pocket');
    expect(postSignupPayload.billing_cycle).toBe('mensal');

    await expect(page.getByRole('heading', { name: 'Ative seu restaurante.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voltar para plano e cobrança' })).toBeVisible();
    await expect(page.getByLabel('Nome completo / Razão social', { exact: true })).toHaveValue('Carlos Lima ME');
    await expect(page.getByLabel('CPF / CNPJ', { exact: true })).toHaveValue('12345678000195');
    await expect(page.getByLabel('Declaro que as informações estão corretas', { exact: false })).not.toBeChecked();

    await expectNoHorizontalOverflow(page);
  });

  test('bloqueia troca de plano quando já existe autorização financeira em andamento', async ({ page }) => {
    const initialData = {
      restaurant_name: 'Bistrô Bloqueado',
      responsible_name: 'Marcos Souza',
      email: 'marcos@bistro.com',
      phone: '11977776666',
      plan: 'premium',
      billing_cycle: 'mensal',
    };
    const receipt = {
      protocol: 'KOMA-CTR-20260913-LOCKED123456',
      acceptedAtUtc: '2026-09-13T12:00:00Z',
      acceptedAtBrasilia: '2026-09-13T09:00:00-03:00',
      provider: { name: 'KÔMA', taxId: '00.000.000/0001-00', address: 'Rua Central, 100', location: 'São Paulo/SP' },
      contractingParty: {
        name: 'Marcos Souza',
        taxId: '12345678909',
        taxIdKind: 'cpf',
        restaurantName: 'Bistrô Bloqueado',
        email: 'marcos@bistro.com',
        phone: '11977776666',
      },
      representative: { name: 'Marcos Souza', taxId: '12345678909', role: 'Titular', powersDeclared: true },
      commercial: {
        plan: 'premium',
        billingCycle: 'mensal',
        fixedMonthlyPrice: '249.00',
        billingAmount: '249.00',
        annualMonthlyEquivalent: null,
        marketplaceRate: '0.002000',
        trialDays: 7,
        trialWaivesFixedFeeOnly: true,
      },
      documents: {
        version: '2.6',
        terms: { slug: 'termos', hash: 'h1' },
        commercial: { slug: 'planos', hash: 'h2' },
        dpa: { slug: 'dpa', hash: 'h3' },
        privacy: { slug: 'privacidade', hash: 'h4' },
        sourceCommit: 'test-commit',
        sourceBlobSha: 'test-sha',
      },
      evidence: {
        requestId: 'locked-signup-id',
        sourceIp: '127.0.0.1',
        ipSource: 'header',
        sourceIpHash: 'ip-hash',
        userAgent: 'test-agent',
        userAgentHash: 'ua-hash',
      },
      provisioning: { status: 'ready', message: 'Autorização em andamento' },
    };

    await page.route('**/api/contracts/payment-methods', route =>
      route.fulfill({ json: { credit_card: true, pix: false, pix_automatic: true, account_money: true, publicKey: 'TEST-public' } }),
    );
    await page.route('**/api/contracts/KOMA-CTR-20260913-LOCKED123456/billing/status', route =>
      route.fulfill({
        json: {
          protocol: 'KOMA-CTR-20260913-LOCKED123456',
          billingStatus: 'ready',
          provider: 'mercado_pago',
          paymentMethodType: 'pix_automatic',
          isActivated: false,
          restaurantId: null,
          slug: null,
        },
      }),
    );

    await page.addInitScript(() => {
      localStorage.setItem('koma_signup_resume', 'locked-token');
    });

    await page.route('**/api/signups/current', route =>
      route.fulfill({
        json: {
          id: 'locked-signup-id',
          data: initialData,
          receipt,
        },
      }),
    );

    await page.goto('/contratar/premium?cobranca=mensal');
    await expect(page.getByText('Sua inscrição foi recuperada. Continue de onde parou.')).toBeVisible();

    await page.getByRole('button', { name: 'Trocar plano ou ciclo' }).click();

    await expect(
      page.getByText('Esta contratação já possui uma autorização financeira em andamento. Conclua ou cancele essa autorização antes de alterar o plano.'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ative seu restaurante.' })).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });
});