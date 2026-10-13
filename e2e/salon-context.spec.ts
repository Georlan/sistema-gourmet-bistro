import { expect, test } from '@playwright/test';
import { API_ORIGIN, openOperationalScenario } from './fixtures/operational';

test('Salão compacto preserva todas as comandas nos detalhes e no recebimento', async ({ page }, testInfo) => {
  const state = await openOperationalScenario(page, { subtab: 'mesas', canonicalIdentity: true, secondCheck: true, transferredSecondCheck: true });
  const card = page.locator('article[data-table-status="occupied"]');
  await expect(card).toHaveAttribute('aria-label', /Mesa 7:/);
  await expect(card).not.toHaveAttribute('aria-label', /24-A|24-B|25-Z/);
  await expect(card.getByLabel('Contexto da mesa')).toHaveCount(0);
  await expect(card.getByRole('button')).toHaveCount(1);
  await expect(card).toContainText(/R\$\s*172,00/);
  await expect(card).not.toContainText('Aguardando pagamento');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(element => element.clientWidth));
  if (process.env.KOMA_CAPTURE_UI) await page.screenshot({ path: testInfo.outputPath('cashier-salon-context.png'), fullPage: true });
  await card.getByRole('button', { name: 'Ver comanda', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Consumo local · Mesa 07', exact: true });
  const context = details.getByLabel('Contexto da mesa');
  await expect(context).toContainText('Comandas: 2');
  for (const text of ['24-A', '24-B', '25-Z', 'Bruno', 'Operador Fase 7']) await expect(context).toContainText(text);
  await expect(details).toContainText('Consumo transferido de: Mesa 9.');
  await expect(details).not.toContainText('🔄');
  await expect(details).not.toContainText('🔗');
  await expect(details).toContainText(/R\$\s*172,00/);
  await details.getByRole('button', { name: 'Receber', exact: true }).click();
  await expect(details).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Digite qualquer valor para abater do saldo.' })).toHaveValue('172,00');
  expect(state.actions.filter(action => /pagar|transferir/.test(action.path))).toEqual([]);
});

test('transferência nos detalhes só envia a Comanda técnica após confirmar', async ({ page }) => {
  const state = await openOperationalScenario(page, { subtab: 'mesas', canonicalIdentity: true });
  await page.locator('article[data-table-status="occupied"]').getByRole('button', { name: 'Ver comanda', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Consumo local · Mesa 07', exact: true });
  expect(state.actions.filter(action => action.path.includes('/transferir/'))).toEqual([]);
  await expect(details.getByRole('button', { name: 'Transferir', exact: true })).toBeDisabled();
  await details.getByRole('combobox', { name: 'Mesa de destino' }).selectOption('8');
  expect(state.actions.filter(action => action.path.includes('/transferir/'))).toEqual([]);
  await details.getByRole('button', { name: 'Transferir', exact: true }).click();
  await expect.poll(() => state.actions.filter(action => action.path.includes('/transferir/'))).toEqual([
    { path: '/comandas/check-phase7-24/transferir/8', query: '', method: 'POST', body: null },
  ]);
  await expect(details).toBeHidden();
});

test('adicionar consumo abre o PDV na mesa correta e mantém o carrinho ao voltar ao Salão', async ({ page }) => {
  const state = await openOperationalScenario(page, { subtab: 'mesas' });
  await page.locator('article[data-table-status="occupied"]').getByRole('button', { name: 'Ver comanda', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Consumo local · Mesa 07', exact: true });
  await details.getByRole('button', { name: 'Adicionar consumo', exact: true }).click();
  await expect(details).toBeHidden();
  const preparedDishButton = page.getByRole('button', { name: 'Adicionar Prato em preparo rapidamente', exact: true });
  await expect(preparedDishButton).toBeVisible();
  await preparedDishButton.click();
  const cart = page.getByRole('button', { name: /^Carrinho \(/ });
  if (await cart.isVisible()) await cart.click();
  await expect(page.locator('#pdv-target-table')).toHaveValue('7');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Salão', exact: true }).click();
  if ((page.viewportSize()?.width ?? 1366) < 1024) await page.locator('.cashier-mobile-bottom-bar').getByRole('button', { name: '+ Pedido', exact: true }).click();
  else await main.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  if (await cart.isVisible()) await cart.click();
  await expect(page.locator('#pdv-target-table')).toHaveValue('7');
  await expect(page.locator('#pdv-submit-btn').locator('..')).toContainText('112,00');
  expect(state.actions.filter(action => /lancamentos|pagar|transferir/.test(action.path))).toEqual([]);
});

test('receber fica disponível para a mesa sem transformar itens servidos em conta pedida', async ({ page }) => {
  const state = await openOperationalScenario(page, { subtab: 'mesas', statuses: ['entregue', 'entregue'] });
  const card = page.locator('article[data-table-status="occupied"]');
  await expect(card).toContainText('Itens servidos');
  await expect(card).not.toContainText('Aguardando pagamento');
  await card.getByRole('button', { name: 'Ver comanda', exact: true }).click();
  await page.getByRole('dialog', { name: 'Consumo local · Mesa 07', exact: true }).getByRole('button', { name: 'Receber', exact: true }).click();
  await expect(page.getByText('Receber Pagamento', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Digite qualquer valor para abater do saldo.' })).toHaveValue('160,00');
  expect(state.actions.filter(action => /pagar|status|transferir/.test(action.path))).toEqual([]);
});

test('desktop 1366x768 compacta banners e libera a área operacional', async ({ page }) => {
  const viewport = page.viewportSize();
  test.skip(!viewport || viewport.width < 1024 || viewport.height > 820, 'Regra de densidade para desktop baixo.');

  await openOperationalScenario(page, { subtab: 'pedidos' });

  await expect(page.locator('.orders-hero')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ver resumo da tela' })).toBeVisible();

  const sidebar = page.locator('.cashier-sidebar:visible');
  await expect(sidebar.locator('.cashier-display-controls')).toBeHidden();
  await expect(sidebar.locator('.cashier-operator')).toBeHidden();

  const board = page.locator('.orders-board');
  await expect(board).toBeVisible();
  const boardBox = await board.boundingBox();
  expect(boardBox).not.toBeNull();
  expect(boardBox!.y).toBeLessThan(280);

  const main = page.getByRole('main');
  if ((page.viewportSize()?.width ?? 1366) < 1024) await page.locator('.cashier-mobile-bottom-bar').getByRole('button', { name: '+ Pedido', exact: true }).click();
  else await main.getByRole('button', { name: 'Novo pedido', exact: true }).click();

  await expect(page.locator('.orders-hero')).toHaveCount(0);
  await expect(page.locator('#counter-heading')).toHaveText('Novo pedido');
  await expect(page.getByRole('button', { name: 'Ver resumo da tela' })).toBeVisible();

  const productSearch = page.getByPlaceholder('Buscar item, descrição ou código');
  await expect(productSearch).toBeVisible();
  const searchBox = await productSearch.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(searchBox!.y).toBeLessThan(240);
});


test('Novo pedido preserva o carrinho e adapta os dados operacionais por modalidade', async ({ page }, testInfo) => {
  await openOperationalScenario(page, { subtab: 'pedidos' });

  const main = page.getByRole('main');
  if ((page.viewportSize()?.width ?? 1366) < 1024) await page.locator('.cashier-mobile-bottom-bar').getByRole('button', { name: '+ Pedido', exact: true }).click();
  else await main.getByRole('button', { name: 'Novo pedido', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar Prato em preparo rapidamente', exact: true }).click();

  const cartToggle = page.getByRole('button', { name: /^Carrinho \(/ });
  if (await cartToggle.isVisible()) await cartToggle.click();

  const panel = page.locator('.cashier-pdv-cart');
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Resumo do pedido')).toContainText('Retirada');
  await expect(panel.getByText('Identificação do cliente', { exact: true })).toBeVisible();
  await expect(panel.locator('#pdv-customer-phone-input')).toBeHidden();
  const customerDetails = panel.locator('details').filter({ hasText: 'Identificação do cliente' });
  await expect(customerDetails.getByText('Adicionar', { exact: true })).toBeVisible();
  await customerDetails.locator('summary').click();
  await expect(customerDetails.getByText('Fechar', { exact: true })).toBeVisible();
  await customerDetails.locator('summary').click();

  await expect(panel.getByText(/Pagamento \(opcional agora\)/)).toBeVisible();
  const paymentDetails = panel.locator('details').filter({ hasText: 'Pagamento' });
  await expect(paymentDetails.getByText('Adicionar', { exact: true })).toBeVisible();
  await paymentDetails.locator('summary').click();
  await expect(paymentDetails.getByText('Fechar', { exact: true })).toBeVisible();
  await paymentDetails.locator('summary').click();
  await expect(panel.getByRole('button', { name: 'Lançar Pedido', exact: false })).toBeEnabled();

  await panel.getByRole('button', { name: 'Delivery', exact: true }).click();
  await expect(panel.locator('#pdv-customer-phone-input')).toBeVisible();
  await expect(panel.locator('#pdv-customer-name-input')).toBeVisible();
  await expect(panel.getByText('Editar entrega', { exact: true })).toBeVisible();
  await expect(panel.locator('#pdv-delivery-address-logradouro')).toBeHidden();
  const deliveryDetails = panel.locator('details').filter({ hasText: 'Entrega' });
  await deliveryDetails.locator('summary').click();
  await expect(deliveryDetails.getByText('Fechar', { exact: true })).toBeVisible();
  await expect(panel.locator('#pdv-delivery-address-logradouro')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Lançar Pedido', exact: false })).toBeVisible();

  await panel.getByRole('button', { name: 'Consumo local', exact: true }).click();
  await expect(panel.locator('#pdv-target-table')).toBeVisible();
  await expect(panel.locator('#pdv-customer-phone-input')).toHaveCount(0);
  await expect(panel.getByText(/Pagamento \(opcional agora\)/)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Lançar Pedido', exact: false })).toBeVisible();

  if (process.env.KOMA_CAPTURE_UI) {
    await page.screenshot({ path: testInfo.outputPath('cashier-pdv-operational-ux.png'), fullPage: true });
  }
});

test('transferência do Caixa identifica destinos ocupados sem itens e livres', async ({ page }) => {
  const state = await openOperationalScenario(page, { subtab: 'mesas' });
  await page.route(`${API_ORIGIN}/mesas/`, route => route.fulfill({ json: [
    { id: 7, nome: 'Mesa 7', capacidade: 4, status: 'ocupada' },
    { id: 8, nome: 'Varanda', capacidade: 4, status: 'ocupada' },
    { id: 9, nome: 'Mesa 9', capacidade: 4, status: 'livre' },
  ] }));
  await page.reload();
  await page.getByRole('button', { name: 'Ver comanda', exact: true }).first().click();
  const select = page.getByRole('combobox', { name: 'Mesa de destino' });
  await expect(select.locator('option[value="8"]')).toHaveText('● Mesa 8 · Varanda · EM ATENDIMENTO');
  await expect(select.locator('option[value="9"]')).toHaveText('○ Mesa 9 · livre');
  await expect(select.locator('option[value="7"]')).toHaveCount(0);
  await select.selectOption('8');
  expect(state.actions.filter(action => action.path.includes('/transferir/'))).toEqual([]);
});
