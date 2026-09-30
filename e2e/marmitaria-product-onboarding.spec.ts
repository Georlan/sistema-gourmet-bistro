import { expect, test } from '@playwright/test';
import { cashierConfig, mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('cadastre P, M e G na mesma categoria sem duplicar tamanhos existentes', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'produtos');
  });
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  const categories: Record<string, unknown>[] = [];
  const products: Record<string, unknown>[] = [];
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, nicho: 'marmitaria' } }));
  await page.route('**/produtos/catalogo', route => route.fulfill({ json: { categorias: categories, produtos: products } }));
  await page.route('**/produtos/categorias', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: categories });
      return;
    }
    const category = route.request().postDataJSON();
    categories.push(category);
    await route.fulfill({ status: 201, json: category });
  });
  await page.route('**/produtos/', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: products });
      return;
    }
    const product = route.request().postDataJSON();
    products.push(product);
    await route.fulfill({ status: 201, json: product });
  });
  await page.goto('/?view=caixa');
  const guide = page.getByRole('region', { name: 'Configurar Quentinhas P, M e G' });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('button', { name: /Quentinha P/ })).toBeDisabled();
  await guide.getByRole('button', { name: '1. Criar categoria Quentinhas' }).click();
  await expect(page.getByLabel('Nome da categoria')).toHaveValue('Quentinhas');
  await page.getByRole('button', { name: /Criar categoria|Salvar categoria/ }).last().click();
  await expect(guide.getByRole('button', { name: /Quentinha P/ })).toBeEnabled();
  for (const [size, price] of [['P', '12'], ['M', '16'], ['G', '20']]) {
    await guide.getByRole('button', { name: new RegExp(`Quentinha ${size}`) }).click();
    await expect(page.getByLabel('Nome do produto')).toHaveValue(`Quentinha ${size}`);
    await expect(page.getByLabel('Categoria', { exact: true })).toHaveValue(String(categories[0].id));
    await page.getByLabel('Preço deste tamanho').fill(price);
    await page.getByRole('button', { name: 'Criar produto', exact: true }).click();
    await expect(guide.getByRole('button', { name: new RegExp(`Quentinha ${size}`) })).toBeDisabled();
  }
  expect(categories).toHaveLength(1);
  expect(products.map(product => product.nome)).toEqual(['Quentinha P', 'Quentinha M', 'Quentinha G']);
  expect(new Set(products.map(product => product.categoria_id))).toEqual(new Set([categories[0].id]));
  expect(new Set(products.map(product => product.id)).size).toBe(3);
});
