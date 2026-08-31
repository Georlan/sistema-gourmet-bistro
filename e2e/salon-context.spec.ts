import { expect, test } from '@playwright/test';
import { openOperationalScenario } from './fixtures/operational';

test('Salão apresenta todas as comandas, pedidos e atendentes sem renomear a Mesa', async ({ page }, testInfo) => {
  await openOperationalScenario(page, { subtab: 'mesas', canonicalIdentity: true, secondCheck: true });
  const card = page.locator('article[data-table-status="occupied"]');
  await expect(card).toHaveAttribute('aria-label', /Mesa 7:/);
  await expect(card).not.toHaveAttribute('aria-label', /24-A|24-B|25-Z/);
  const context = card.getByLabel('Contexto da mesa');
  await expect(context).toContainText('Comandas: 2');
  for (const text of ['24-A', '24-B', '25-Z', 'Bruno', 'Operador Fase 7']) await expect(context).toContainText(text);
  await expect(card.getByLabel('Produção e serviço')).toContainText('1 em preparo · 1 pronto · 1 servido');
  await expect(card).toContainText(/R\$\s*172,00/);
  await expect(card).not.toContainText('Aguardando pagamento');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(element => element.clientWidth));
  if (process.env.KOMA_CAPTURE_UI) await page.screenshot({ path: testInfo.outputPath('cashier-salon-context.png'), fullPage: true });
  await card.getByRole('button', { name: 'Ver comanda', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Mesa 7', exact: true }).getByLabel('Contexto da mesa')).toContainText('25-Z');
});

test('atalho de transferência abre seleção e só envia a Comanda técnica após confirmar', async ({ page }) => {
  const state = await openOperationalScenario(page, { subtab: 'mesas', canonicalIdentity: true });
  await page.locator('article[data-table-status="occupied"]').getByRole('button', { name: 'Transferir…', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Mesa 7', exact: true });
  await expect(details.getByRole('combobox', { name: 'Mesa de destino' })).toBeFocused();
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
  await page.locator('article[data-table-status="occupied"]').getByRole('button', { name: 'Adicionar consumo', exact: true }).click();
  await expect(page.getByTitle('Adicionar Prato em preparo', { exact: true })).toBeVisible();
  await page.getByTitle('Adicionar Prato em preparo', { exact: true }).click();
  const cart = page.getByRole('button', { name: /^Carrinho \(/ });
  if (await cart.isVisible()) await cart.click();
  await expect(page.locator('#pdv-target-table')).toHaveValue('7');
  await page.getByRole('button', { name: 'Salão', exact: true }).click();
  await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
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
  await card.getByRole('button', { name: 'Receber', exact: true }).click();
  await expect(page.getByText('Receber Pagamento', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Digite qualquer valor para abater do saldo.' })).toHaveValue('160,00');
  expect(state.actions.filter(action => /pagar|status|transferir/.test(action.path))).toEqual([]);
});
