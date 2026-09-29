import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('remove funcionário inativo e cadastra novo convite com o mesmo telefone', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  let members = [{ id: 'old-member', nome: 'Pessoa Antiga', telefone: '88999616937', cargo: 'cozinha', status: 'inativo' }];
  await page.route('**/caixa/funcionarios', async route => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      expect(payload.telefone).toBe('88999616937');
      expect(members).toHaveLength(0);
      members = [{ ...payload, id: 'new-member', status: 'pendente_ativacao' }];
      return route.fulfill({ status: 201, json: members[0] });
    }
    return route.fulfill({ json: members });
  });
  let removed = false;
  await page.route('**/auth/usuarios/old-member?remover_cadastro=true', async route => {
    expect(route.request().method()).toBe('DELETE');
    removed = true;
    members = [];
    await route.fulfill({ status: 204 });
  });
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  const sidebar = page.locator('.cashier-sidebar:visible');
  if (!await sidebar.isVisible()) await page.getByRole('button', { name: 'Abrir menu principal' }).click();
  await sidebar.getByRole('button', { name: /^Equipe(?: \d+)?$/ }).click();
  await expect(page.getByRole('heading', { name: 'Pessoa Antiga' })).toBeVisible();
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('telefone e o e-mail serão liberados'); await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Remover Pessoa Antiga da equipe' }).click();
  expect(removed).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Remover Pessoa Antiga da equipe' }).click();
  await expect(page.getByRole('heading', { name: 'Pessoa Antiga' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Convidar pessoa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Convidar para a equipe' });
  await dialog.getByLabel('Nome completo').fill('Pessoa Nova');
  await dialog.getByLabel('WhatsApp').fill('88999616937');
  await dialog.getByRole('button', { name: /^Cozinha/ }).click();
  await dialog.getByRole('button', { name: 'Cadastrar e enviar' }).click();
  await expect(page.getByRole('heading', { name: 'Pessoa Nova' })).toBeVisible();
  await expect(page.getByText('Aguardando ativação', { exact: true })).toBeVisible();
});
