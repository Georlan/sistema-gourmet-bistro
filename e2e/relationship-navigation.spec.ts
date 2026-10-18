import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { cashierConfig, mockCashierBackend, seedCashierSession } from './fixtures/cashier';
import { expectRelationshipSelected, navigateRelationship } from './fixtures/relationshipNavigation';

const contract = JSON.parse(readFileSync(new URL('./fixtures/crm-api-contract.json', import.meta.url), 'utf8'));

async function setupRelationship(page: Page, loyalty: boolean, coupons: boolean) {
  await mockCashierBackend(page);
  await seedCashierSession(page, { preserveNavigationOnReload: true });
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.route('**/caixa/configuracoes', route => route.fulfill({
    json: {
      ...cashierConfig, plano: 'premium', plano_efetivo: 'premium',
      entitlements: { ...cashierConfig.entitlements, loyalty, coupons },
    },
  }));
  await page.route('**/fidelidade/clientes', route => route.fulfill({ json: contract.customers }));
  await page.route('**/fidelidade/crm/resumo**', route => route.fulfill({ json: contract.summary }));
  await page.route('**/caixa/cupons', route => route.fulfill({ json: [] }));
  // Match the backend economic recommendation contract used by the existing CRM browser suite.
  // A generic {} response would make the loyalty calculator render an invalid payload.
  await page.route('**/caixa/cupons/economia/recomendacao', route => route.fulfill({
    json: {
      mode: 'automatico', source: 'conservative_default',
      suggestion: { effective_reward_percent: 2, cashback_percent: 2, points_per_real: 1, point_value_brl: 0.02 },
      evidence: { lookback_days: 30, orders_analyzed: 0, cost_coverage_percent: 0, known_contribution_percent: null },
      warnings: [], message: 'Sugestão isolada de teste',
    },
  }));
  await page.route('**/fidelidade/config', route => route.fulfill({
    json: { ativo: true, tipo_recompensa: 'PONTOS', taxa_conversao: 1, valor_ponto_em_dinheiro: 0.05 },
  }));
}

async function openSidebar(page: Page) {
  if (await page.locator('.cashier-sidebar:visible').count()) return;
  const full = page.getByRole('button', { name: 'Abrir menu completo', exact: true });
  if (await full.isVisible()) await full.click();
  else await page.getByRole('button', { name: 'Abrir menu principal', exact: true }).click();
}

async function enterRelationship(page: Page) {
  await openSidebar(page);
  await page.locator('.cashier-sidebar:visible').getByRole('button', { name: /^Relacionamento(?: \d+)?$/ }).click();
}

test('five destinations, benefit tabs, legacy restoration and module return share one active location', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await setupRelationship(page, true, true);
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  await enterRelationship(page);
  await expectRelationshipSelected(page, 'oportunidades');

  // Both presentations consume the same destinations: on desktop the expanded
  // sidebar and the horizontal strip are intentionally redundant, like Vendas.
  const horizontal = page.locator('#clientes-subtab-oportunidades:visible');
  await expect(horizontal).toBeVisible();
  await expect(page.locator('.cashier-subnav__button:visible')).toHaveCount(5);
  await expect(page.getByLabel('Localização no Relacionamento')).toHaveCount(0);
  const visibleSidebarChildren = page.locator('.cashier-sidebar:visible .cashier-nav-child:visible');
  if (await visibleSidebarChildren.count()) {
    await expect(visibleSidebarChildren).toHaveCount(5);
    await expect(visibleSidebarChildren.first()).toHaveAttribute('aria-current', 'page');
  }
  // Edge controls keep a stable slot so showing an arrow cannot resize
  // the scroller and pull the selected tab back during a swipe.
  const navLeft = await page.getByRole('navigation', { name: 'Telas desta área' })
    .evaluate(element => element.getBoundingClientRect().left);
  const firstTabLeft = await horizontal.evaluate(element => element.getBoundingClientRect().left);
  expect(firstTabLeft - navLeft).toBeLessThanOrEqual(68);

  for (const target of ['clientes', 'campanhas', 'beneficios', 'resultados', 'oportunidades'] as const) {
    await navigateRelationship(page, target);
    await expectRelationshipSelected(page, target);
  }

  await navigateRelationship(page, 'campanhas');
  const campaignDraft = page.getByLabel('Identificação da campanha');
  await campaignDraft.fill('Rascunho preservado entre áreas');
  await navigateRelationship(page, 'clientes');
  await navigateRelationship(page, 'campanhas');
  await expect(campaignDraft).toHaveValue('Rascunho preservado entre áreas');

  await navigateRelationship(page, 'beneficios');
  await expect(page.getByRole('tablist', { name: 'Tipos de benefícios' })).toBeVisible();
  const fidelity = page.getByRole('tab', { name: 'Fidelidade', exact: true });
  await fidelity.focus();
  await fidelity.press('ArrowRight');
  await expectRelationshipSelected(page, 'cupons');
  await expect(page.getByRole('tabpanel', { name: 'Cupons' })).toBeVisible();
  await navigateRelationship(page, 'resultados');
  await navigateRelationship(page, 'beneficios');
  await expectRelationshipSelected(page, 'cupons');

  await navigateRelationship(page, 'resultados');
  await page.screenshot({ path: testInfo.outputPath('relationship-navigation.png'), animations: 'disabled', fullPage: true });
  await openSidebar(page);
  await page.locator('.cashier-sidebar:visible .cashier-nav-item[title="Vendas"]').click({ timeout: 10000 });
  await enterRelationship(page);
  await expectRelationshipSelected(page, 'resultados');
  await navigateRelationship(page, 'campanhas');
  await expect(campaignDraft).toHaveValue('Rascunho preservado entre áreas');
  await navigateRelationship(page, 'resultados');
  await page.reload();
  await expectRelationshipSelected(page, 'resultados');

  // Old persisted destinations remain valid after a full document reload.
  await page.evaluate(() => {
    sessionStorage.setItem('koma_active_tab', 'clientes');
    sessionStorage.setItem('koma_active_subtab', 'cupons');
  });
  await page.reload();
  await expectRelationshipSelected(page, 'cupons');
  expect(errors).toEqual([]);
});

for (const [loyalty, coupons] of [[true, false], [false, true], [false, false]] as const) {
  test(`benefit navigation respects isolated entitlements: loyalty=${loyalty}, coupons=${coupons}`, async ({ page }) => {
  
  await setupRelationship(page, loyalty, coupons);
    await page.goto('/?view=caixa');
    await expect(page.locator('.orders-board')).toBeVisible();
    await enterRelationship(page);
    const visibleChildren = page.locator('#clientes-subtab-oportunidades:visible').isVisible()
      .then(async topVisible => topVisible
        ? page.locator('.cashier-subnav__button:visible')
        : page.locator('.cashier-sidebar:visible .cashier-nav-child:visible'));
    const children = await visibleChildren;
    await expect(children).toHaveCount(loyalty || coupons ? 5 : 4);
    if (loyalty || coupons) {
      await navigateRelationship(page, 'beneficios');
      await expectRelationshipSelected(page, 'beneficios');
      await expect(page.getByRole('tablist', { name: 'Tipos de benefícios' })).toHaveCount(0);
      await expect(page.getByRole('tabpanel', { name: loyalty ? 'Fidelidade' : 'Cupons' })).toBeVisible();
      await expect(page.getByRole('tabpanel', { name: loyalty ? 'Cupons' : 'Fidelidade' })).toHaveCount(0);
    } else {
      await expect(page.locator('#clientes-subtab-beneficios:visible')).toHaveCount(0);
      await expect(page.locator('.cashier-sidebar:visible .cashier-nav-child').filter({ hasText: 'Benefícios' })).toHaveCount(0);
    }
  });
}
