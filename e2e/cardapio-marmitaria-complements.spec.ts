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
