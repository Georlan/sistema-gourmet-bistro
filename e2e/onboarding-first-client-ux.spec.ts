import { expect, test, type Page } from '@playwright/test';

type SnapshotOverrides = {
  mode?: 'commercial' | 'administrative';
  releaseState?: 'configuring' | 'awaiting_koma' | 'released';
  operationReleased?: boolean;
  operationsReady?: boolean;
  orderTypes?: Array<'retirada' | 'consumo_local' | 'delivery'>;
  progress?: number;
};

const baseSnapshot = (overrides: SnapshotOverrides = {}) => {
  const completed = overrides.progress ?? (overrides.operationsReady ? 1 : 0);
  return {
    restaurant: { id: '5', name: 'KÔMA Primeiro Cliente - Homologação', slug: 'primeiro-cliente', plan: 'pocket' },
    trial: {
      status: overrides.mode === 'commercial' ? 'setup' : 'active',
      startsAt: null,
      endsAt: null,
      daysRemaining: 7,
    },
    trialCanStart: false,
    readyForRelease: overrides.releaseState === 'awaiting_koma',
    onboarding: {
      mode: overrides.mode || 'administrative',
      releaseState: overrides.releaseState || 'configuring',
      operationReleased: overrides.operationReleased ?? false,
      requiresKomaRelease: overrides.mode === 'commercial' && overrides.releaseState !== 'released',
    },
    payments: { mercadoPagoConnected: false, pixOnlineAvailable: false },
    counts: { products: 0, activeProducts: 0, orders: 0, tables: 0 },
    operations: {
      configured: Boolean(overrides.operationsReady),
      ready: Boolean(overrides.operationsReady),
      legacyPolicy: false,
      orderTypes: overrides.orderTypes || [],
      tableMapEnabled: false,
      serviceChargeEnabled: false,
      serviceChargePercent: 0,
      blockers: overrides.operationsReady ? [] : ['order_types'],
    },
    catalogAssistance: null,
    steps: {
      profile: completed >= 4,
      hours: completed >= 4,
      catalog: completed >= 4,
      operations: Boolean(overrides.operationsReady || completed >= 4),
      mercadoPago: false,
      firstOrder: false,
    },
    progress: { completed, total: 4, percent: Math.round((completed / 4) * 100) },
    readiness: {
      configurationComplete: completed >= 4,
      trialStarted: overrides.mode === 'commercial' && overrides.releaseState === 'released',
      operationReleased: overrides.operationReleased ?? false,
      readyToOperate: false,
      blockers: completed >= 4 ? (overrides.releaseState === 'awaiting_koma' ? ['trial'] : ['test_order']) : ['profile', 'hours', 'catalog', 'operations'],
    },
  };
};

async function activate(page: Page) {
  await page.route('**/auth/ativar', route => route.fulfill({
    json: {
      access_token: 'test-operator',
      usuario: { id: 'admin', cargo: 'admin', role: 'admin', nome: 'Ana', restaurante_id: 5 },
    },
  }));
  await page.goto('/?view=ativar#token=test-invitation');
  await page.getByLabel('E-mail de Login', { exact: true }).fill('ana@example.com');
  await page.getByLabel('Nova Senha', { exact: true }).fill('test-only-password');
  await page.getByLabel('Confirme a Senha', { exact: true }).fill('test-only-password');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\?view=ativar$/);
}

test('modalidades mostram confirmação persistida e Mercado Pago fica claramente opcional', async ({ page }) => {
  let snapshot = baseSnapshot();
  await page.route('**/api/subscription', route => route.fulfill({ json: { subscription: null } }));
  await page.route('**/api/onboarding/status', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/onboarding/operations', async route => {
    snapshot = baseSnapshot({ operationsReady: true, orderTypes: ['retirada'], progress: 1 });
    await route.fulfill({ json: snapshot });
  });

  await activate(page);

  await page.getByRole('button', { name: 'Retirada', exact: false }).click();
  await page.getByRole('button', { name: 'Salvar modalidades' }).click();

  await expect(page.getByText('Modalidades salvas ✓: Retirada')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvo ✓' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pode configurar depois' })).toBeVisible();
  await expect(page.getByText('Mercado Pago não conectado — tudo bem por enquanto')).toBeVisible();
});

test('onboarding comercial concluído deixa claro que a equipe KÔMA está liberando o acesso', async ({ page }) => {
  const snapshot = baseSnapshot({
    mode: 'commercial',
    releaseState: 'awaiting_koma',
    operationReleased: false,
    operationsReady: true,
    orderTypes: ['retirada'],
    progress: 4,
  });
  await page.route('**/api/subscription', route => route.fulfill({
    json: {
      subscription: {
        status: 'onboarding',
        billingCycle: 'monthly',
        paymentMethodType: 'credit_card',
        paidUntil: null,
        trialEndsAt: null,
        trialStartsAfterSetup: true,
        canCancel: true,
      },
    },
  }));
  await page.route('**/api/onboarding/status', route => route.fulfill({ json: snapshot }));

  await activate(page);

  await expect(page.getByText('Sua parte está concluída ✓')).toBeVisible();
  await expect(page.getByText(/você não precisa fazer mais nada agora/i)).toBeVisible();
  await expect(page.getByText(/status será atualizado automaticamente/i)).toBeVisible();
  await expect(page.getByText('Aguardando KÔMA')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pode configurar depois' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Entrar no KÔMA/i })).toHaveCount(0);
});
