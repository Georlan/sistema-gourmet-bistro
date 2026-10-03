import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

for (const status of [503, 422, 502]) {
  test(`PDV preserves cart and retry key after ${status}`, async ({ page }) => {
    await mockCashierBackend(page);
    await seedCashierSession(page);
    const requests: { key: string; body: unknown }[] = [];
    await page.route('**/cardapio/modificadores/venda-direta', async route => {
      const body = route.request().postDataJSON();
      requests.push({ key: body.idempotency_key, body });
      await route.fulfill({
        status: requests.length === 1 ? status : 200,
        contentType: requests.length === 1 && status === 502 ? 'text/html' : 'application/json',
        body: requests.length > 1 ? JSON.stringify({ id: 'sale-confirmed' })
          : status === 502 ? '<html>Bad gateway</html>'
          : status === 503 ? JSON.stringify({ detail: 'Falha controlada' })
          : JSON.stringify({ detail: [
            { loc: ['body', 'itens', 0, 'modificador_ids', 0], type: 'string_type', input: 'private-id' },
            { loc: ['body', 'identificador'], type: 'missing' },
          ] }),
      });
    });
    await page.goto('/?view=caixa');
    await expect(page.locator('.orders-board')).toBeVisible();
    const newOrder = () => page.locator('.cashier-subnav').getByRole('button', { name: 'Novo pedido', exact: true })
      .or(page.getByRole('navigation', { name: 'Navegação móvel principal' }).getByRole('button', { name: '+ Pedido', exact: true }))
      .filter({ visible: true });
    const showCart = async () => {
      const cart = page.getByRole('button', { name: /^Carrinho \(/ });
      if (await cart.isVisible()) await cart.click();
      await expect(page.locator('#pdv-submit-btn')).toBeVisible();
    };
    await newOrder().click();
    await page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente', exact: true }).click();
    await showCart();
    await page.getByRole('button', { name: 'Consumo local', exact: true }).click();
    await page.locator('#pdv-target-table').selectOption('10');
    await page.locator('#pdv-submit-btn').click();
    const message = status === 502 ? 'Falha no servidor. Tente novamente.'
      : status === 503 ? 'Falha controlada'
      : 'Revise os dados do pedido: Item 1 — Complementos: valor inválido. Nome: campo obrigatório.';
    await expect(page.getByText(`Erro ao registrar venda: ${message}`, { exact: true })).toBeVisible();
    await expect(page.getByText('[object Object]', { exact: false })).toHaveCount(0);
    await expect(page.getByText('private-id', { exact: false })).toHaveCount(0);
    await expect(page.getByText('A rede falhou.', { exact: false })).toHaveCount(0);
    expect(requests).toHaveLength(1);
    await newOrder().click();
    await showCart();
    await expect(page.locator('#pdv-target-table')).toHaveValue('10');
    await expect(page.locator('#pdv-submit-btn').locator('..').getByText('R$ 42,00', { exact: true })).toBeVisible();
    await page.locator('#pdv-submit-btn').click();
    await expect(page.getByText('Pedido confirmado e enviado à cozinha.', { exact: true })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });
}
