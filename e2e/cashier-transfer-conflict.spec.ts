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
  await page.locator('article[data-table-status="occupied"]').getByRole('button', { name: 'Ver comanda' }).click();
  const details = page.getByRole('dialog', { name: /Mesa 0?7$/ });
  await details.getByRole('button', { name: 'Transferir', exact: true }).click();
  const target = details.getByRole('radio', { name: /^Mesa 8/ });
  await target.click();
  await details.getByRole('button', { name: 'Confirmar transferência' }).click();
  await expect(page.getByText('A mesa de destino está ocupada. Use Mesclar para unir os atendimentos.', { exact: true })).toBeVisible();
  await expect.poll(() => refreshesAfterConflict).toBeGreaterThan(0);
  await expect(details).toBeVisible();
  await expect(target).toHaveAttribute('aria-checked', 'false');
  await expect(details.getByRole('button', { name: 'Confirmar transferência' })).toBeDisabled();
  expect(rejectedTransfers).toBe(1);
});
