import { expect, test } from '@playwright/test';
import { API_ORIGIN, openOperationalScenario } from './fixtures/operational';

test('pagamento misto não duplica retry e espera saldo confirmado pelo servidor', async ({ page }) => {
  await openOperationalScenario(page, { subtab: 'mesas', canonicalIdentity: true, statuses: ['entregue', 'entregue'] });
  const attempts: { valor: number; metodo: string; idempotency_key: string; item_ids: unknown }[] = [];
  let firstAttemptFails = true;
  await page.route(`${API_ORIGIN}/caixa/mesas/7/pagar`, async route => {
    const body = route.request().postDataJSON();
    attempts.push(body);
    if (firstAttemptFails) {
      firstAttemptFails = false;
      await route.fulfill({ status: 503, json: { detail: 'Tente novamente' } });
      return;
    }
    await route.fulfill({ json: { valor: body.valor, status: 'aprovado' } });
  });

  const card = page.locator('article[data-table-status="occupied"]');
  await card.getByRole('button', { name: 'Ver comanda', exact: true }).click();
  await page.getByRole('dialog', { name: 'Consumo local · Mesa 07', exact: true })
    .getByRole('button', { name: 'Receber', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Dividir pagamento' }).check();
  const value = page.getByRole('textbox', { name: /valor/i });
  await expect(value).toHaveValue('');
  await page.getByRole('button', { name: 'Pix', exact: true }).click();
  await value.fill('200,00');
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  await expect(page.getByText('Informe o valor desta parte, maior que zero e até o saldo restante.', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(0);

  await value.fill('50,00');
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  await expect(page.getByText('Tente novamente', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toMatchObject({ valor: 50, metodo: 'pix', item_ids: null });
  expect(attempts[0].idempotency_key).toBe(attempts[1].idempotency_key);

  // The fixture intentionally does not mutate the backend order projection.
  // A second charge must remain blocked until a new canonical paid balance arrives.
  await expect(page.getByText(/Conferindo o saldo atualizado com o servidor/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Sincronizando saldo/ })).toBeDisabled();
  expect(attempts).toHaveLength(2);
});
