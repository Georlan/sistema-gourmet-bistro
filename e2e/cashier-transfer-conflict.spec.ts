import { expect, test } from '@playwright/test';
import { API_ORIGIN, openOperationalScenario } from './fixtures/operational';

test('conflito de transferência atualiza as mesas e exige nova seleção sem repetir a mutação', async ({ page }) => {
  await openOperationalScenario(page, { subtab: 'mesas' });
  let rejectedTransfers = 0;
  let refreshesAfterConflict = 0;
  await page.route(`${API_ORIGIN}/comandas/check-phase7-24/transferir/8`, async route => {
    rejectedTransfers += 1;
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({
      detail: 'A mesa de destino está ocupada. Use Mesclar para unir os atendimentos.',
    }) });
  });
  page.on('request', request => {
    if (rejectedTransfers && new URL(request.url()).pathname === '/comandas/detalhes/todos') refreshesAfterConflict += 1;
  });
  await page.locator('article[data-table-status="occupied"]').getByRole('button', { name: 'Ver comanda', exact: true }).click();
  const details = page.getByRole('dialog', { name: /Mesa 0?7$/ });
  const target = details.getByRole('combobox', { name: 'Mesa de destino' });
  await target.selectOption('8');
  await details.getByRole('button', { name: 'Transferir', exact: true }).click();
  await expect(page.getByText('A mesa de destino está ocupada. Use Mesclar para unir os atendimentos.', { exact: true })).toBeVisible();
  await expect.poll(() => refreshesAfterConflict).toBeGreaterThan(0);
  await expect(details).toBeVisible();
  await expect(target).toHaveValue('');
  await expect(details.getByRole('button', { name: 'Transferir', exact: true })).toBeDisabled();
  expect(rejectedTransfers).toBe(1);
});
