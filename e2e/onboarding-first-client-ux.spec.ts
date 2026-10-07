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
      access_token: `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, role: 'admin', restaurante_id: 5 })).toString('base64url')}.test`,
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

test('modalidades mostram confirmação persistida e KÔMA Pagamentos fica claramente opcional', async ({ page }) => {
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

  await page.getByRole('button', { name: /Modalidades Retirada Editar/ }).click();
  await expect(page.getByText('Modalidades salvas ✓: Retirada')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvo ✓' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pode configurar depois' })).toBeVisible();
  await expect(page.getByText('Nenhum provedor conectado — tudo bem por enquanto')).toBeVisible();
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


test('Pizzaria prioriza pendentes e recolhe preparação salva sem falsificar readiness', async ({ page }) => {
  const snapshot = baseSnapshot({ mode: 'commercial', operationsReady: true, orderTypes: ['retirada', 'consumo_local', 'delivery'], progress: 1 });
  Object.assign(snapshot.restaurant, { operationProfile: 'pizzaria', name: 'Pizzaria' });
  snapshot.counts.tables = 30;
  Object.assign(snapshot, { catalogAssistance: { id: 'menu-1', filename: 'cardapiopizza.webp', status: 'pending', createdAt: null, updatedAt: null } });
  await page.route('**/api/subscription', route => route.fulfill({ json: { subscription: null } }));
  await page.route('**/api/onboarding/status', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/cardapio-digital/config', route => route.fulfill({ json: { nome: 'Pizzaria', socials: {}, horarios_funcionamento: [] } }));
  await activate(page);
  await expect(page.getByRole('heading', { name: 'Faltam 3 essenciais para revisão' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Etapa atual do cadastro' })).toBeVisible();
  await expect(page.getByText('Falta pouco — 1 de 4 concluídos').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar tipo' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Salvar modalidades' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Completar mesas' })).toHaveCount(0);
  await expect(page.getByLabel('Arquivo do cardápio para implantação assistida')).toHaveCount(0);
  const nextY = await page.getByRole('region', { name: 'Etapa atual do cadastro' }).evaluate(el => el.getBoundingClientRect().top);
  const typeY = await page.getByRole('button', { name: /Tipo de operação Pizzaria Editar/ }).evaluate(el => el.getBoundingClientRect().top);
  expect(nextY).toBeLessThan(typeY);
  await page.getByRole('button', { name: /Salão 30 mesas cadastradas Editar/ }).click();
  await expect(page.getByRole('button', { name: 'Completar mesas' })).toBeVisible();
  await page.getByRole('button', { name: 'Substituir arquivo' }).click();
  await expect(page.getByLabel('Arquivo do cardápio para implantação assistida')).toBeAttached();
  await page.goto('/ativar?resume=1');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Completar mesas' })).toHaveCount(0);
  await expect(page.getByText('Ainda não iniciado', { exact: true })).toBeVisible();
});

test('quando só faltam modalidades o próximo passo leva ao formulário existente', async ({ page }) => {
  const snapshot = baseSnapshot({ mode: 'commercial', progress: 3 });
  Object.assign(snapshot.steps, { profile: true, hours: true, catalog: true });
  await page.route('**/api/subscription', route => route.fulfill({ json: { subscription: null } }));
  await page.route('**/api/onboarding/status', route => route.fulfill({ json: snapshot }));
  await activate(page);
  await expect(page.getByRole('heading', { name: 'Falta 1 essencial para revisão' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvar modalidades' })).toBeInViewport();
});


test('cadastro comercial salva dados e horários na própria tela e só avança com confirmação', async ({ page }) => {
  // All API requests are intercepted: this flow cannot write to a real tenant.
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  let snapshot = baseSnapshot({ mode: 'commercial', operationsReady: true, orderTypes: ['retirada'], progress: 1 });
  let config = { nome: '', endereco: '', socials: { whatsapp: '' }, horarios_funcionamento: [], status_override: 'Automático' };
  let failSave = true;
  let releaseFailedSave: (() => void) | undefined;
  let failValidation = false;
  let statusReads = 0;
  await page.route('**/api/onboarding/status', route => {
    statusReads++;
    return route.fulfill(failValidation ? { status: 503, json: {} } : { json: snapshot });
  });
  await page.route('**/api/cardapio-digital/config', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: config });
    if (failSave) {
      await new Promise<void>(resolve => { releaseFailedSave = resolve; });
      return route.fulfill({ status: 500, json: { detail: 'Falha simulada ao salvar' } });
    }
    config = { ...config, ...route.request().postDataJSON() };
    snapshot.steps.profile = true;
    snapshot.steps.hours = config.horarios_funcionamento.length > 0;
    return route.fulfill({ json: config });
  });
  await activate(page);
  const guided = page.getByRole('region', { name: 'Etapa atual do cadastro' });
  await guided.getByLabel('Nome público do restaurante', { exact: true }).fill('Restaurante simulado');
  await guided.getByLabel('WhatsApp', { exact: true }).fill('85999999999');
  await guided.getByLabel('Endereço físico', { exact: true }).fill('Rua de teste, 100');
  await guided.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Editar modalidades', exact: true })).toBeDisabled();
  await expect(guided.getByLabel('Nome público do restaurante', { exact: true })).toBeDisabled();
  releaseFailedSave!();
  await expect(guided.getByText('Falha simulada ao salvar')).toBeVisible();
  await expect(guided.getByLabel('Nome público do restaurante', { exact: true })).toHaveValue('Restaurante simulado');
  failSave = false;
  failValidation = true;
  await guided.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  await expect(guided.getByText(/Não foi possível confirmar o próximo passo/)).toBeVisible();
  failValidation = false;
  await guided.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  await expect(guided.getByRole('heading', { name: 'Horários do restaurante' })).toBeVisible();
  await expect(page).toHaveURL(/view=ativar/);
  await expect(guided.getByRole('heading', { name: 'Pedidos agendados' })).toHaveCount(0);
  await guided.getByRole('button', { name: 'Adicionar horário', exact: true }).click();
  await guided.getByLabel('Dias', { exact: true }).fill('Segunda a Sexta');
  await guided.getByLabel('Horário', { exact: true }).fill('18:00 - 01:00');
  await guided.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  await expect(guided).toHaveCount(0);
  await expect(page.getByText('Publique o primeiro produto', { exact: true })).toBeVisible();
  expect(snapshot.trial.startsAt).toBeNull();
  expect(snapshot.readyForRelease).toBe(false);
  expect(statusReads).toBe(5);
  await page.getByRole('button', { name: 'Revisar dados', exact: true }).click();
  await guided.getByLabel('Nome público do restaurante', { exact: true }).fill('Alteração não salva');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Revisar horários', exact: true }).click();
  await expect(guided.getByLabel('Nome público do restaurante', { exact: true })).toHaveValue('Alteração não salva');
  await guided.getByRole('button', { name: 'Salvar e continuar', exact: true }).click();
  snapshot = baseSnapshot({ mode: 'commercial', releaseState: 'awaiting_koma', progress: 4, operationsReady: true });
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(page.getByText('Sua parte está concluída ✓', { exact: true })).toBeVisible();
  await expect(page.getByText('Ainda não iniciado', { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/koma-guided-${test.info().project.name}.png`, fullPage: true });
});
