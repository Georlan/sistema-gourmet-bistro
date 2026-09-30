import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('pausa e reativa complemento do dia, preservando estado em falha', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  const option = { id: 'protein-chicken', grupo_id: 'proteins', nome: 'Frango', preco_adicional: 0, ativo: true };
  let failNext = false;
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: [{
    id: 'proteins', nome: 'Proteínas', tipo: 'obrigatorio', min_selecoes: 1, max_selecoes: 1,
    opcoes: [option], produto_ids: [], categoria_ids: [],
  }] }));
  await page.route('**/cardapio/modificadores/categorias-hierarquia', route => route.fulfill({ json: [] }));
  await page.route('**/cardapio/modificadores/opcoes/protein-chicken/disponibilidade', async route => {
    expect(route.request().method()).toBe('PATCH');
    if (failNext) {
      failNext = false;
      await route.fulfill({ status: 503, json: { detail: 'Falha ao salvar disponibilidade.' } });
      return;
    }
    const body = route.request().postDataJSON();
    expect(Object.keys(body)).toEqual(['ativo']);
    option.ativo = body.ativo;
    await route.fulfill({ json: option });
  });
  await page.goto('/?view=caixa');
  await expect(page.locator('.cashier-sidebar:visible').or(page.getByRole('button', { name: 'Abrir menu principal' }))).toBeVisible();
  if (!await page.locator('.cashier-sidebar:visible').isVisible()) {
    await page.getByRole('button', { name: 'Abrir menu principal' }).click();
  }
  await page.locator('.cashier-sidebar:visible').getByRole('button', { name: /^Cardápio$/ }).click();
  await page.locator('.cashier-subnav').getByRole('button', { name: 'Complementos', exact: true }).click();
  await page.getByRole('button', { name: 'Pausar Frango', exact: true }).click();
  await expect(page.getByText('Pausado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reativar Frango', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pausar Frango', exact: true })).toBeEnabled();
  await expect(page.getByText('Pausado', { exact: true })).toHaveCount(0);
  failNext = true;
  await page.getByRole('button', { name: 'Pausar Frango', exact: true }).click();
  await expect(page.getByText('Falha ao salvar disponibilidade.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pausar Frango', exact: true })).toBeEnabled();
  await expect(page.getByText('Pausado', { exact: true })).toHaveCount(0);
});

test('dona configura nome, preço e limites por tamanho com grupos compartilhados', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  const groups = [{ id: 'proteins', nome: 'Proteínas', tipo: 'opcional', min_selecoes: 0, max_selecoes: 3,
    opcoes: ['Frango', 'Carne', 'Peixe'].map((nome, i) => ({ id: `protein-${i}`, grupo_id: 'proteins', nome, ativo: true, preco_adicional: 0 })), produto_ids: [], categoria_ids: [] }];
  let sizes: Array<Record<string, unknown>> = [];
  let failNext = false;
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: groups }));
  await page.route('**/cardapio/modificadores/categorias-hierarquia', route => route.fulfill({ json: [] }));
  await page.route('**/cardapio/marmitaria/tamanhos**', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { enabled: true, tamanhos: sizes } });
      return;
    }
    if (failNext) {
      failNext = false;
      await route.fulfill({ status: 409, json: { detail: 'Faltam opções disponíveis para a composição.' } });
      return;
    }
    const payload = route.request().postDataJSON();
    expect(Object.keys(payload).sort()).toEqual(['ativo', 'nome', 'preco', 'regras']);
    const id = route.request().method() === 'POST' ? `size-${sizes.length}` : route.request().url().split('/').at(-1);
    const saved = { ...payload, id, categoria_id: `category-${id}` };
    sizes = [...sizes.filter(size => size.id !== id), saved];
    await route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200, json: saved });
  });
  await page.goto('/?view=caixa');
  await expect(page.locator('.cashier-sidebar:visible').or(page.getByRole('button', { name: 'Abrir menu principal' }))).toBeVisible();
  if (!await page.locator('.cashier-sidebar:visible').isVisible()) await page.getByRole('button', { name: 'Abrir menu principal' }).click();
  await page.locator('.cashier-sidebar:visible').getByRole('button', { name: /^Cardápio$/ }).click();
  await page.locator('.cashier-subnav').getByRole('button', { name: 'Complementos', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Montagem por tamanho' });
  await expect(panel).toBeVisible();
  for (const [name, price, count] of [['Marmita média', '2000', 1], ['Marmita grande', '2800', 2]] as const) {
    await panel.getByRole('button', { name: 'Adicionar tamanho' }).click();
    await panel.getByLabel('Nome do tamanho').fill(name);
    await panel.getByLabel('Preço do tamanho').fill(price);
    await panel.getByRole('button', { name: 'Adicionar grupo de escolhas' }).click();
    await panel.getByLabel('Grupo 1', { exact: true }).selectOption('proteins');
    await panel.getByLabel('Contagem do grupo 1').selectOption(count === 1 ? 'porcoes' : 'tipos');
    await panel.getByLabel('Mínimo do grupo 1').fill(String(count));
    await panel.getByLabel('Máximo do grupo 1').fill(String(count));
    await panel.getByLabel('Disponível para venda').check();
    await panel.getByRole('button', { name: 'Salvar tamanho' }).click();
    await expect(panel.getByRole('form')).toHaveCount(0);
    await expect(panel.getByText(`Proteínas: escolha ${count} ${count === 1 ? "porções" : "tipos diferentes"}`, { exact: true })).toBeVisible();
  }
  expect(sizes.map(size => size.preco)).toEqual([20, 28]);
  await panel.getByRole('button', { name: 'Configurar Marmita grande' }).click();
  await panel.getByLabel('Preço do tamanho').fill('3000');
  failNext = true;
  await panel.getByRole('button', { name: 'Salvar tamanho' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Faltam opções disponíveis para a composição.');
  await expect(panel.getByRole('form')).toBeVisible();
  await panel.getByRole('button', { name: 'Salvar tamanho' }).click();
  await expect(panel.getByRole('form')).toHaveCount(0);
  expect(sizes.find(size => size.id === 'size-1')?.preco).toBe(30);
  const widths = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  expect(widths[1]).toBeLessThanOrEqual(widths[0] + 1);
});
