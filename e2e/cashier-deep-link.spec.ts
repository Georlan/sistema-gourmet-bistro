import { expect, test, type Page, type Route } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

const APP_ORIGIN = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;
const API_ORIGIN = 'http://127.0.0.1:8000';

async function installLoginAndCashierRoutes(
  page: Page,
  options: {
    role?: 'admin' | 'gerente' | 'caixa' | 'garcom';
    entitlements?: Record<string, boolean>;
    onboardingReleaseState?: 'configuring' | 'awaiting_koma' | 'released';
  } = {},
) {
  const role = options.role ?? 'admin';
  const releaseState = options.onboardingReleaseState ?? 'released';
  const entitlements = options.entitlements ?? {
    printing: true,
    kds: true,
    waiter_app: true,
    loyalty: false,
    coupons: false,
    courier_app: false,
    inventory: true,
    advanced_reports: true,
  };

  await page.routeWebSocket(/\/ws\//, socket => { socket.onMessage(() => {}); });
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === APP_ORIGIN) return route.continue();
    if (url.origin !== API_ORIGIN) return route.abort();

    const key = `${request.method()} ${url.pathname}`;
    if (key === 'POST /auth/login') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'e2e-deep-link-token',
          usuario: { id: `${role}-1`, nome: 'Operador E2E', role, cargo: role, restaurante_id: 99001 },
        }),
      });
      return;
    }

    let body: unknown = {};
    if (key === 'GET /api/onboarding/status') {
      body = {
        restaurant: { id: '99001', name: 'Restaurante Deep Link', slug: 'rest-dl', plan: 'pro', operationProfile: 'generic' },
        trial: { status: 'active', startsAt: null, endsAt: null, daysRemaining: 7 },
        trialCanStart: false,
        readyForRelease: false,
        onboarding: { mode: 'commercial', releaseState, operationReleased: releaseState === 'released', requiresKomaRelease: releaseState !== 'released' },
        payments: { mercadoPagoConnected: false, pixOnlineAvailable: false },
        counts: { products: 1, activeProducts: 1, orders: 0, tables: 0 },
        operations: { configured: true, ready: true, legacyPolicy: false, orderTypes: ['delivery'], tableMapEnabled: false, serviceChargeEnabled: false, serviceChargePercent: 0, blockers: [] },
        catalogAssistance: null,
        steps: { profile: true, hours: true, catalog: true, operations: true, mercadoPago: false, firstOrder: false },
        progress: { completed: 4, total: 4, percent: 100 },
        readiness: { configurationComplete: true, trialStarted: releaseState === 'released', operationReleased: releaseState === 'released', readyToOperate: true, blockers: [] },
      };
    } else if (key === 'GET /caixa/configuracoes') {
      body = { plano: 'pro', plano_efetivo: 'pro', entitlements, delivery_ativo: true, tipo_taxa_entrega: 'fixa', taxa_entrega_fixa: 5 };
    } else if (key === 'GET /cardapio-digital/config') {
      body = { id: 99001, nome: 'Restaurante Deep Link', slug: 'rest-dl', delivery_ativo: true, tipo_taxa_entrega: 'fixa', taxa_entrega_fixa: 5, horarios_funcionamento: [] };
    } else if (key === 'GET /produtos/catalogo') {
      body = { categorias: [], produtos: [] };
    } else if (key === 'GET /caixa/turno-atual') {
      body = null;
    } else if (key === 'GET /caixa/turno-atual/resumo') {
      body = { total_vendas: 0, comandas_abertas_count: 0 };
    } else if (key === 'GET /api/print-agents/monitor' || key === 'GET /printing/monitors/overview') {
      body = { summary: { online_agents: 0, active_agents: 0, pending: 0, claimed: 0, printing: 0, failed: 0, delayed: 0, ready_printers: 0, printer_ready: false }, agents: [], jobs: [], history_jobs: [], queue_jobs: [] };
    } else if (request.method() === 'GET') {
      body = [];
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('authenticated deep link opens Entrega directly and cleans ?go from URL', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);

  await page.goto('/?view=caixa&go=online_entrega');

  const nav = page.getByRole('navigation', { name: 'Telas desta área' });
  await expect(nav.getByRole('button', { name: 'Entrega', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page).not.toHaveURL(/[?&]go=/);
  expect(await page.evaluate(() => sessionStorage.getItem('koma_pending_go'))).toBeNull();
});

test('deep link preserves target across login and lands directly on Entrega', async ({ page }) => {
  await installLoginAndCashierRoutes(page, { role: 'admin', onboardingReleaseState: 'released' });

  await page.goto('/?view=operacional&go=online_entrega');
  await page.getByLabel('E-MAIL').fill('dono@koma.test');
  await page.getByLabel('Senha', { exact: true }).fill('senha-segura');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  const nav = page.getByRole('navigation', { name: 'Telas desta área' });
  await expect(nav.getByRole('button', { name: 'Entrega', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page).not.toHaveURL(/[?&]go=/);
});

test('invalid or unentitled deep link fails closed without leaving pending state', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);

  await page.goto('/?view=caixa&go=vendas_novo_pedido');
  const nav = page.getByRole('navigation', { name: 'Telas desta área' });
  await expect(nav.getByRole('button', { name: 'Pedidos', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page).not.toHaveURL(/[?&]go=/);
  await expect(page.getByPlaceholder('Buscar item, descrição ou código')).toHaveCount(0);
});

test('pending onboarding allows setup deep link like online_entrega directly in setup mode', async ({ page }) => {
  await installLoginAndCashierRoutes(page, { role: 'admin', onboardingReleaseState: 'configuring' });

  await page.goto('/?view=operacional&go=online_entrega');
  await page.getByLabel('E-MAIL').fill('dono@koma.test');
  await page.getByLabel('Senha', { exact: true }).fill('senha-segura');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  const nav = page.getByRole('navigation', { name: 'Telas desta área' });
  await expect(nav.getByRole('button', { name: 'Entrega', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page).not.toHaveURL(/[?&]go=/);
});
