import { expect, test } from '@playwright/test';

test('liberação de homologação exige motivo, respeita duração e registra somente o restaurante escolhido', async ({ page }) => {
  const requests: unknown[] = [];
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-token'));
  await page.route('**/api/super-admin/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/operational-qa')) {
      requests.push({ path, ...route.request().postDataJSON() });
      return route.fulfill({ json: { qaActive: true, expiresAt: '2026-11-13T15:00:00Z' } });
    }
    if (path.endsWith('/restaurantes')) return route.fulfill({ json: [{ id: '961301', name: 'Restaurante QA', status: 'ACTIVE', plan: 'pocket' }] });
    if (path.endsWith('/contracts')) return route.fulfill({ json: { items: [], pendingCount: 0 } });
    if (path.endsWith('/trials') || path.endsWith('/incidents') || path.endsWith('/issues')) return route.fulfill({ json: [] });
    if (path.endsWith('/release')) return route.fulfill({ json: { restaurant: {}, subscription: null, steps: { profile: true, hours: true, catalog: true, operations: true }, onboarding: { mode: 'administrative' }, readyForRelease: false, trialStarted: false } });
    if (path.includes('/access/restaurantes/')) return route.fulfill({ json: { activeUsers: 1, activeAdmins: 1, users: [], diagnostics: [] } });
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { effective: {}, baseline: {}, overrides: {}, plan: 'pocket' } });
    return route.fulfill({ json: {} });
  });
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/super-admin');
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Abrir menu lateral' }).click();
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir 360°', exact: true }).click();
  await page.getByRole('button', { name: 'Implantação', exact: true }).click();
  await page.getByRole('button', { name: 'Preparar liberação de teste' }).click();
  const submit = page.getByRole('button', { name: 'Liberar para testes' });
  await expect(submit).toBeDisabled();
  await page.getByLabel('Motivo', { exact: true }).fill('Homologação autorizada pelo restaurante');
  await page.getByLabel('Duração em horas (1 a 72)').fill('73');
  await expect(submit).toBeDisabled();
  await page.getByLabel('Duração em horas (1 a 72)').fill('72');
  await submit.click();
  await expect(page.getByRole('status').filter({ hasText: 'Homologação liberada' })).toBeVisible();
  expect(requests).toEqual([{ path: '/api/super-admin/onboarding/restaurantes/961301/operational-qa', action: 'start', hours: 72, reason: 'Homologação autorizada pelo restaurante' }]);
});

test('Super Admin mobile/desktop exibe link QA, gera aceite com Pix e abre toolkit de links e investigação', async ({ page }) => {
  let qaActive = false;
  const inviteRequests: unknown[] = [];
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-token'));
  await page.route('**/api/super-admin/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/operational-qa')) {
      const payload = route.request().postDataJSON();
      qaActive = payload.action === 'start';
      if (qaActive) {
        return route.fulfill({
          json: {
            qaActive: true,
            expiresAt: '2026-11-26T18:00:00Z',
            qaAccessToken: '961301.token_e2e_secret_123456',
            qaMenuPath: '/c/restaurante-qa?qa_token=961301.token_e2e_secret_123456',
          },
        });
      }
      return route.fulfill({ json: { qaActive: false, expiresAt: '2026-11-25T20:00:00Z' } });
    }
    if (path.endsWith('/contracts/invite')) {
      const payload = route.request().postDataJSON();
      inviteRequests.push(payload);
      return route.fulfill({
        status: 201,
        json: {
          inviteUrl: 'https://app.komafood.com.br/aceitar-contrato?token=961301.invite_e2e',
          paymentMethodType: payload.payment_method_type,
          autoReleaseOnAccept: payload.auto_release_on_accept,
          expiresAt: '2026-11-28T20:00:00Z',
        },
      });
    }
    if (path.includes('/support/') && path.endsWith('/feedbacks')) {
      return route.fulfill({
        json: {
          tenantId: '961301',
          items: [
            {
              id: 'fb-1',
              kind: 'problem',
              message: 'Não imprime comanda na cozinha',
              pagePath: '/',
              createdAt: '2026-11-25T20:15:00Z',
              context: {
                last_support_code: 'sup9988aabb11',
                navigation_id: 'config_impressao',
                suspected_bug: true,
              },
            },
          ],
        },
      });
    }
    if (path.endsWith('/restaurantes')) return route.fulfill({ json: [{ id: '961301', name: 'Restaurante QA', status: 'ACTIVE', plan: 'pro' }] });
    if (path.endsWith('/contracts')) return route.fulfill({ json: { items: [], pendingCount: 0 } });
    if (path.endsWith('/trials') || path.endsWith('/incidents') || path.endsWith('/issues')) return route.fulfill({ json: [] });
    if (path.endsWith('/release')) {
      return route.fulfill({
        json: {
          restaurant: {},
          subscription: null,
          steps: { profile: true, hours: true, catalog: true, operations: true },
          onboarding: { mode: 'administrative' },
          operationalQa: qaActive
            ? { active: true, startedAt: '2026-11-25T18:00:00Z', expiresAt: '2026-11-26T18:00:00Z', hours: 12, hasToken: true }
            : { active: false, startedAt: null, expiresAt: null, hours: null, hasToken: false },
          readiness: { configurationComplete: true, trialStarted: false, blockers: [] },
          readyForRelease: false,
          trialStarted: false,
        },
      });
    }
    if (path.includes('/access/restaurantes/')) return route.fulfill({ json: { activeUsers: 1, activeAdmins: 1, users: [], diagnostics: [] } });
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { effective: {}, baseline: {}, overrides: {}, plan: 'pro' } });
    return route.fulfill({ json: {} });
  });
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/super-admin');
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Abrir menu lateral' }).click();
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir 360°', exact: true }).click();
  await page.getByRole('button', { name: 'Implantação', exact: true }).click();

  await page.getByRole('button', { name: 'Preparar liberação de teste' }).click();
  await page.getByLabel('Motivo', { exact: true }).fill('Homologar cardápio, caixa e aceite pós-teste');
  await page.getByRole('button', { name: 'Liberar para testes' }).click();
  await expect(page.getByLabel('Link de homologação QA')).toHaveValue(/qa_token=961301\.token_e2e_secret_123456/);
  await expect(page.getByRole('link', { name: 'Abrir cardápio QA' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Encerrar homologação' })).toBeVisible();

  await page.getByRole('button', { name: 'Gerar link único de aceite' }).click();
  await expect(page.getByLabel('Link único de aceite contratual')).toHaveValue(/aceitar-contrato\?token=/);
  expect(inviteRequests).toEqual([
    {
      restaurant_id: 961301,
      billing_cycle: 'mensal',
      expires_hours: 72,
      payment_method_type: 'pix',
      auto_release_on_accept: true,
      reason: 'Link único de aceite contratual gerado pela ficha Restaurante 360',
    },
  ]);

  await page.getByRole('button', { name: 'Links & Investigação' }).click();
  await page.getByLabel('Pesquisar deep links de suporte').fill('entrega');
  await expect(page.getByText('https://app.komafood.com.br/?go=online_entrega')).toBeVisible();
  await page.getByRole('button', { name: /Iniciar investigação/i }).click();
  await expect(page.getByText('Não imprime comanda na cozinha')).toBeVisible();
  await page.getByRole('button', { name: 'Usar no diagnóstico' }).click();
  await expect(page.getByText(/--support-code sup9988aabb11 --tenant 961301/).first()).toBeVisible();
});
