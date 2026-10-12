import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function openFiscal(page: Page) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.route('**/api/onboarding/fiscal/profile', route => route.fulfill({ json: { status: 'draft', enabled: false } }));
  await page.route('**/api/onboarding/fiscal/municipalities?*', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/onboarding/fiscal/preflight?*', route => route.fulfill({ json: {
    ready: false, mode: 'foundation', profileReady: false, referencesReady: false,
    issues: [], warnings: [], references: [], complianceBaseline: [],
  } }));
  await page.goto('/?view=caixa&pagbank=cancelled');
  await page.getByRole('tab', { name: 'Fiscal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ver preparação dos produtos' })).toBeVisible();
}

test('preparação é sob demanda, reflete preço e novos produtos sem escrever ou ativar emissão', async ({ page }) => {
  const writes: string[] = [];
  let reads = 0;
  page.on('request', request => {
    if (request.url().includes('/onboarding/fiscal/') && request.method() !== 'GET') writes.push(request.url());
  });
  await openFiscal(page);
  await page.route('**/api/onboarding/fiscal/products?*', route => {
    reads++;
    return route.fulfill({ json: { total: reads === 1 ? 1 : 2, hasMore: false, items: [
      { productId: 'burger', name: 'Hambúrguer', currentPrice: reads === 1 ? '25.00' : '28.00', active: true, preparationStatus: 'pending', ncm: null, commercialUnit: null },
      ...(reads === 1 ? [] : [{ productId: 'juice', name: 'Suco novo', currentPrice: '8.00', active: true, preparationStatus: 'pending', ncm: null, commercialUnit: null }]),
    ] } });
  });
  expect(reads).toBe(0);
  await page.getByRole('button', { name: 'Ver preparação dos produtos' }).click();
  const panel = page.getByRole('region', { name: 'Preparação fiscal dos produtos' });
  await expect(panel.getByText(/25,00/)).toBeVisible();
  await expect(panel.getByText('Dados fiscais pendentes')).toBeVisible();
  await panel.getByRole('button', { name: 'Atualizar produtos' }).click();
  await expect(panel.getByText(/28,00/)).toBeVisible();
  await expect(panel.getByText('Suco novo')).toBeVisible();
  expect(writes).toEqual([]);
  expect(reads).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.screenshot({ path: test.info().outputPath('produtos-fiscais.png') });
});

test('falha de leitura não mostra cadastro aprovado e permite tentar novamente', async ({ page }) => {
  let fail = true;
  await openFiscal(page);
  await page.route('**/api/onboarding/fiscal/products?*', route => route.fulfill(fail
    ? { status: 503, json: { detail: 'indisponível' } }
    : { json: { items: [], total: 0, hasMore: false } }));
  await page.getByRole('button', { name: 'Ver preparação dos produtos' }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar os produtos fiscais');
  await expect(page.getByText('Cadastro revisado', { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Atualizar produtos' }).click();
  await expect(page.getByText(/Nenhum produto nesta página/)).toBeVisible();
});

test('resposta incompatível fica restrita ao painel e não derruba configurações', async ({ page }) => {
  await openFiscal(page);
  await page.route('**/api/onboarding/fiscal/products?*', route => route.fulfill({ json: {} }));
  await page.getByRole('button', { name: 'Ver preparação dos produtos' }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar os produtos fiscais');
  await expect(page.getByRole('heading', { name: /^(Estabelecimento fiscal|Dados da empresa)$/ })).toBeVisible();
  await expect(page.getByText(/Não foi possível abrir Configurações/)).toHaveCount(0);
});
