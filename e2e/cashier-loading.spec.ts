import { expect, type Page, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';
async function navigate(page: Page, label: string) {
  const targetLabel = label === 'Vendas' ? 'Vender' : label === 'Relatórios' ? 'Resultados' : label;
  const gestaoItems = ['Caixa', 'Estoque', 'Clientes', 'Equipe'];

  if (gestaoItems.includes(label)) {
    const subButton = page.getByRole('button', { name: new RegExp(`^${label}(?: \\d+)?$`) });
    if (!await subButton.isVisible()) {
      const openMenu = page.getByRole('button', { name: 'Abrir menu principal' });
      if (await openMenu.isVisible()) await openMenu.click();
      const gestaoButton = page.getByRole('button', { name: 'Gestão' });
      if (await gestaoButton.isVisible()) await gestaoButton.click();
    }
  }

  const button = page.getByRole('button', { name: new RegExp(`^(?:${targetLabel}|${label})(?: \\d+)?$`) });
  if (!await button.isVisible()) {
    const openMenu = page.getByRole('button', { name: 'Abrir menu principal' });
    if (await openMenu.isVisible()) await openMenu.click();
  }
  await button.click();
}

async function open(page: Page) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
}

async function showCart(page: Page) {
  const cart = page.getByRole('button', { name: /^Carrinho \(/ });
  if (await cart.isVisible()) await cart.click();
  await expect(page.locator('#pdv-submit-btn')).toBeVisible();
}

test('abertura não baixa módulos administrativos e atraso de módulo não bloqueia Pedidos', async ({ page }, testInfo) => {
  const scripts: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname); });
  await open(page);
  expect(scripts.filter(path => /\/Cashier(Inventory|Catalog|Customers|Settings|OnlineMenu|Team|Reports|PdvView)/.test(path))).toEqual([]);
  await testInfo.attach('initial-script-resources.json', {
    body: JSON.stringify(await page.evaluate(() => performance.getEntriesByType('resource')
      .filter(entry => /\.js(?:\?|$)/.test(entry.name)).map(entry => ({
        url: new URL(entry.name).pathname,
        bytes: (entry as PerformanceResourceTiming).encodedBodySize,
        duration: entry.duration,
      }))), null, 2), contentType: 'application/json',
  });

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/*CashierTeam*', async route => { await gate; await route.continue(); });
  try {
    await navigate(page, 'Equipe');
    await expect(page.getByRole('status').filter({ hasText: 'Carregando Equipe' })).toBeVisible();
    await navigate(page, 'Vendas');
    await expect(page.locator('.orders-board')).toBeVisible();
    release();
    await navigate(page, 'Equipe');
    await expect(page.getByLabel('Buscar pessoa')).toBeVisible();
    expect(scripts.some(path => path.includes('CashierTeam'))).toBe(true);
    expect(scripts.filter(path => /\/Cashier(Inventory|Catalog|Customers|Settings|OnlineMenu|Reports)/.test(path))).toEqual([]);
  } finally { release(); }
});

test('rascunho administrativo e carrinho sobrevivem à navegação entre módulos', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await page.getByTitle('Adicionar Risoto da casa', { exact: true }).click();
  await showCart(page);
  await page.locator('#pdv-customer-name-input').fill('Cliente do rascunho');
  await navigate(page, 'Cardápio');
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo produto', exact: true });
  await dialog.getByLabel('Nome do produto').fill('Produto ainda não salvo');
  // Existing operator shortcut can change the page while a form is open.
  await page.evaluate(() => window.dispatchEvent(new Event('koma-open-impressoras')));
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Mesas', exact: true })).toBeVisible();
  await navigate(page, 'Cardápio');
  await expect(dialog.getByLabel('Nome do produto')).toHaveValue('Produto ainda não salvo');
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await navigate(page, 'Vendas');
  await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await showCart(page);
  await expect(page.locator('#pdv-customer-name-input')).toHaveValue('Cliente do rascunho');
  await expect(page.locator('#pdv-submit-btn').locator('..').getByText('R$ 42,00', { exact: true })).toBeVisible();
});

test('falha ao carregar relatórios fica isolada e preserva o carrinho', async ({ page }) => {
  await page.route('**/*CashierReports*', route => route.abort('failed'), { times: 1 });
  await open(page);
  await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await page.getByTitle('Adicionar Risoto da casa', { exact: true }).click();
  await navigate(page, 'Relatórios');
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível abrir Relatórios' })).toBeVisible();
  await navigate(page, 'Vendas');
  await expect(page.locator('.orders-board')).toBeVisible();
  await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await showCart(page);
  await expect(page.locator('#pdv-submit-btn').locator('..').getByText('R$ 42,00', { exact: true })).toBeVisible();
  await navigate(page, 'Relatórios');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Recarregar página' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível abrir Relatórios' })).toBeVisible();
  await navigate(page, 'Vendas');
  await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await showCart(page);
  await expect(page.locator('#pdv-submit-btn').locator('..').getByText('R$ 42,00', { exact: true })).toBeVisible();
  await navigate(page, 'Relatórios');
  // Reload is an explicit user decision after acknowledging the unsaved draft.
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Recarregar página' }).click();
  await expect(page.locator('.orders-board')).toBeVisible();
  await navigate(page, 'Relatórios');
  await expect(page.getByText('Pagamentos aprovados menos estornos', { exact: true })).toBeVisible();
});

test('PDV preserva tentativa e carrinho após falha mesmo fora da tela', async ({ page }) => {
  const sales: { body: unknown; key: unknown }[] = [];
  await open(page);
  await page.route('**/comandas/venda-direta', async route => {
    const body = route.request().postDataJSON();
    sales.push({ body, key: body.idempotency_key });
    await route.fulfill({ status: sales.length === 1 ? 503 : 200, contentType: 'application/json',
      body: JSON.stringify(sales.length === 1 ? { detail: 'Falha controlada' } : { id: 'sale-confirmed' }) });
  });
  await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await page.getByTitle('Adicionar Risoto da casa', { exact: true }).click();
  await showCart(page);
  await page.getByRole('button', { name: 'Mesa', exact: true }).click();
  await page.locator('#pdv-target-table').selectOption('10');
  await page.locator('#pdv-submit-btn').click();
  await expect(page.locator('.orders-board')).toBeVisible();
  await expect(page.getByText('Erro ao registrar venda: Falha controlada')).toBeVisible();
  expect(sales).toHaveLength(1);
  await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await showCart(page);
  await expect(page.locator('#pdv-target-table')).toHaveValue('10');
  await expect(page.locator('#pdv-submit-btn').locator('..').getByText('R$ 42,00', { exact: true })).toBeVisible();
  await page.locator('#pdv-submit-btn').click();
  await expect(page.getByText('Pedido confirmado e enviado à cozinha.', { exact: true })).toBeVisible();
  expect(sales).toHaveLength(2);
  expect(sales[1]).toEqual(sales[0]);
});
