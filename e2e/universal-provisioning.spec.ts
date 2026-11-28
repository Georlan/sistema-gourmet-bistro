import { expect, test } from '@playwright/test';

test.describe('Provisionamento autônomo /comecar', () => {
  test('cliente cria restaurante em preparação sem Super Admin no modo guiado', async ({ page }) => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    await page.route('**/api/provisioning/public/start', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      capturedBodies.push(body);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '42',
          name: String(body.name || 'Pizzaria Teste'),
          subdomain: 'pizzaria-teste',
          plan: 'pro',
          operationProfile: 'pizzaria',
          preparationMode: true,
          bootstrap: {
            categoriesCreated: 5,
            productsCreated: 2,
            orderTypes: ['delivery', 'retirada'],
            operatingHours: [{ days: 'Todos os dias', hours: '18:00 - 23:00' }],
          },
          paths: { cashier: '/?view=caixa', publicMenu: '/c/pizzaria-teste' },
          access_token: 'e2e-jwt-token',
          user: {
            id: 'usr-42',
            nome: String(body.admin_name || 'Lucas'),
            email: String(body.admin_email || 'lucas@teste.com'),
            role: 'admin',
            cargo: 'admin',
            restaurante_id: 42,
            status: 'ativo',
          },
        }),
      });
    });

    await page.goto('/comecar?plano=pro');
    await expect(page.getByRole('heading', { name: /Prepare seu restaurante/i })).toBeVisible();

    await page.getByLabel(/Nome do restaurante/i).fill('Pizzaria Teste E2E');
    await page.getByLabel(/Seu nome/i).fill('Lucas E2E');
    await page.getByLabel(/E-mail de acesso/i).fill('lucas@teste-e2e.com');
    await page.getByLabel(/Crie sua senha/i).fill('SenhaForte123!');

    await page.getByRole('button', { name: /Já tem horários, atendimento ou lista de itens/i }).click();
    await page.getByLabel(/Colar itens iniciais do cardápio/i).fill('Pizzas:\nCalabresa - R$ 49,90\nMarguerita - R$ 47,90');

    await page.getByRole('button', { name: /Criar restaurante em preparação/i }).click();

    await expect(page.getByText(/MODO PREPARAÇÃO · TENANT #42/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /Abrir meu painel agora/i })).toHaveAttribute('href', '/?view=caixa');

    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].name).toBe('Pizzaria Teste E2E');
    expect(capturedBodies[0].operation_profile).toBe('pizzaria');
    expect(capturedBodies[0].apply_segment_preset).toBe(true);
    expect(String(capturedBodies[0].menu_text || '')).toContain('Calabresa');

    const storedToken = await page.evaluate(() => sessionStorage.getItem('koma_caixa_token'));
    expect(storedToken).toBe('e2e-jwt-token');
  });

  test('modo expresso interpreta texto estruturado e envia campos sem invenção', async ({ page }) => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    await page.route('**/api/provisioning/public/start', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      capturedBodies.push(body);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '43',
          name: 'Pizzaria Don Romano',
          subdomain: 'pizzaria-don-romano',
          plan: 'pro',
          operationProfile: 'pizzaria',
          preparationMode: true,
          bootstrap: {
            categoriesCreated: 5,
            productsCreated: 3,
            orderTypes: ['delivery', 'retirada'],
            operatingHours: [{ days: 'Todos os dias', hours: '18:00 - 23:00' }],
          },
          paths: { cashier: '/?view=caixa', publicMenu: '/c/pizzaria-don-romano' },
          access_token: 'e2e-jwt-express',
          user: {
            id: 'usr-43',
            nome: String(body.admin_name || 'Don Romano'),
            email: String(body.admin_email || 'don@romano.com'),
            role: 'admin',
            cargo: 'admin',
            restaurante_id: 43,
            status: 'ativo',
          },
        }),
      });
    });

    await page.goto('/comecar');
    await page.getByRole('tab', { name: /Colar texto/i }).click();
    await page.getByRole('button', { name: /Inserir exemplo preenchido/i }).click();
    await expect(page.getByText(/Prévia interpretada: Pizzaria Don Romano/i)).toBeVisible();
    await expect(page.getByText(/3 item\(ns\)/i)).toBeVisible();

    await page.getByLabel(/Senha \(mín\. 8\)/i).fill('SenhaExpresso123');
    await page.getByRole('button', { name: /Criar restaurante em preparação/i }).click();

    await expect(page.getByText(/Pizzaria Don Romano está pronto para configurar/i)).toBeVisible();
    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].admin_email).toBe('joao@donromano.com.br');
  });

  test('vincular contrato (?vincular=1) preserva o mesmo tenant e chama /api/contracts/self-accept', async ({ page }) => {
    const selfAcceptCalls: Array<Record<string, unknown>> = [];

    await page.addInitScript(() => {
      const user = {
        id: 'usr-linked-77',
        nome: 'Roberto Dono',
        role: 'admin',
        cargo: 'admin',
        restaurante_id: 77,
      };
      const session = { token: 'linked-jwt-77', user, expiresAt: Date.now() + 3_600_000 };
      sessionStorage.setItem('koma_operator_session_caixa', JSON.stringify(session));
      sessionStorage.setItem('koma_active_operational_portal', 'caixa');
      sessionStorage.setItem('koma_caixa_token', 'linked-jwt-77');
      sessionStorage.setItem('koma_caixa_id', 'usr-linked-77');
      sessionStorage.setItem('koma_caixa_name', 'Roberto Dono');
      sessionStorage.setItem('koma_caixa_role', 'admin');
    });

    await page.route('**/api/contracts/payment-methods-v2', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ credit_card: false, pix: true, pixMode: 'manual_post_trial', publicKey: '' }),
      });
    });

    await page.route('**/api/onboarding/status', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          restaurant: { id: '77', name: 'Pizzaria Vinculada', slug: 'pizzaria-vinculada', plan: 'pro', operationProfile: 'pizzaria' },
          onboarding: { provisionalPreparation: true, contractLinked: false },
          steps: { profile: true, hours: true, catalog: true, operations: true },
        }),
      });
    });

    await page.route('**/api/contracts/self-accept', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      selfAcceptCalls.push(body);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          protocol: 'KOMA-CTR-20261128-ABCDEF123456',
          acceptedAt: new Date().toISOString(),
          status: 'ready',
          restaurantId: '77',
          restaurantName: 'Pizzaria Vinculada',
          slug: 'pizzaria-vinculada',
          trialStarted: true,
          message: 'Contrato vinculado e seus 7 dias grátis já começaram.',
          receipt: {
            protocol: 'KOMA-CTR-20261128-ABCDEF123456',
            acceptedAtBrasilia: '28/11/2026 01:00:00',
            contractingParty: { name: 'Roberto Dono', taxId: '52998224725', taxIdKind: 'cpf', restaurantName: 'Pizzaria Vinculada', email: 'roberto@vinculada.test', phone: '85988887777' },
            representative: { name: 'Roberto Dono', taxId: '52998224725', role: 'Titular da contratação' },
            commercial: { plan: 'pro', billingCycle: 'mensal', fixedMonthlyPrice: '197.00', marketplaceRate: '0.00' },
            documents: { version: '3.6', terms: { hash: 'a'.repeat(64) }, commercial: { hash: 'b'.repeat(64) } },
            evidence: { sourceIp: '127.0.0.1' },
          },
        }),
      });
    });

    await page.goto('/contratar/pro?vincular=1');
    await expect(page.getByText(/Vinculando contratação ao restaurante #77/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Ative Pizzaria Vinculada/i })).toBeVisible();

    await page.getByLabel(/CPF \/ CNPJ/i).fill('52998224725');
    await page.getByLabel(/^E-mail$/i).fill('roberto@vinculada.test');
    await page.getByLabel(/Telefone \/ WhatsApp/i).fill('85988887777');
    await page.getByLabel(/Declaro que as informações estão corretas/i).check();
    await page.getByRole('button', { name: /Aceitar e registrar contratação/i }).click();

    await expect(page.getByRole('link', { name: /Voltar ao meu painel operacional/i })).toHaveAttribute('href', '/?view=caixa');
    expect(selfAcceptCalls).toHaveLength(1);
    expect(selfAcceptCalls[0].payment_method_type).toBe('pix');
  });
});
