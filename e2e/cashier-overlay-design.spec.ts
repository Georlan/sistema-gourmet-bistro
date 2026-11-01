import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

for (const theme of ['dark', 'light']) {
  test(`pause/reopen uses the existing backend and keyboard return in ${theme}`, async ({ page, isMobile }) => {
    await mockCashierBackend(page); await seedCashierSession(page);
    await page.addInitScript(theme => localStorage.setItem('@koma:theme', theme), theme);
    let paused = false;
    const writes: unknown[] = [];
    const status = () => ({ paused, pause_reason: null, pause_until: null, max_active_orders: null, auto_pause: false,
      counts: { analise: 1, pendente: 0, producao: 3, pronto: 2, active: 6 }, level: paused ? 'paused' : 'normal' });
    await page.route('**/api/online-orders/control', route => route.fulfill({ json: status() }));
    await page.route('**/api/online-orders/pause', route => { writes.push(route.request().postDataJSON()); paused = true; return route.fulfill({ json: status() }); });
    await page.route('**/api/online-orders/resume', route => { writes.push(route.request().postDataJSON()); paused = false; return route.fulfill({ json: status() }); });
    await page.goto('/?view=caixa');
    await expect(page.locator('.orders-board')).toBeVisible();
    if (isMobile) await page.getByRole('button', { name: 'Abrir menu principal', exact: true }).click();
    await page.getByRole('button', { name: 'Pausar cardápio online', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Pausar cardápio online', exact: true });
    await expect(dialog.getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
    await expect(dialog.getByRole('heading')).toHaveText('Pausar cardápio online');
    await expect(dialog).toContainText('Pedidos recebidos e conversas continuam ativos.');
    const art = dialog.locator('.ko-overlay__art');
    await expect.poll(() => art.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await dialog.getByRole('button', { name: '30 min', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '30 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([]);
    await page.getByRole('button', { name: 'Pausar cardápio online', exact: true }).click();
    await dialog.getByRole('button', { name: 'Pausar cardápio online', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes[0]).toMatchObject({ reason: 'Cozinha lotada', duration_minutes: 30 });
    await page.getByRole('button', { name: 'Reabrir cardápio online', exact: true }).click();
    await page.getByRole('dialog', { name: 'Reabrir cardápio online', exact: true }).getByRole('button', { name: 'Reabrir cardápio online', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pausar cardápio online', exact: true })).toBeVisible();
    expect(writes).toHaveLength(2);
  });
}

test('chat distinguishes a failed list from an empty queue and quick replies focus the composer', async ({ page, isMobile }) => {
  await mockCashierBackend(page); await seedCashierSession(page);
  let fails = true;
  let sent = 0;
  await page.route('**/api/caixa/conversas', route => route.fulfill({ status: fails ? 503 : 200, json: fails ? { detail: 'Teste' } : [{
    id: 'chat-demo', pedido_id: 'order-demo', numero_pedido: 172, cliente_nome: 'Cliente de teste', tipo_pedido: 'Delivery', status_pedido: 'producao', total_pedido: 35,
    unread_count: 0, closed_at: null, updated_at: new Date().toISOString(), last_message: null,
  }] }));
  await page.route('**/api/caixa/conversas/chat-demo/feed**', route => route.fulfill({ json: { items: [], has_more: false, oldest_seq: null, latest_seq: null } }));
  await page.route('**/api/caixa/conversas/chat-demo/messages', route => { if (route.request().method() === 'POST') sent++; return route.fulfill({ json: [] }); });
  await page.goto('/?view=caixa');
  await page.locator('#btn-caixa-conversas-drawer').click();
  const dialog = page.getByRole('dialog', { name: 'Central de Mensagens dos Pedidos', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('Não foi possível atualizar');
  fails = false;
  await dialog.getByRole('button', { name: 'Atualizar conversas', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('searchbox', { name: 'Buscar conversas' }).fill('Entrega');
  await expect(dialog.getByRole('button', { name: /Pedido #172/ })).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Buscar conversas' }).fill('');
  if (isMobile) await dialog.getByRole('button', { name: /Pedido #172/ }).click();
  await dialog.getByRole('button', { name: 'Vou verificar', exact: true }).click();
  const response = dialog.getByRole('textbox', { name: 'Responder ao cliente', exact: true });
  await expect(response).toHaveValue('Certo, vamos verificar.');
  await expect(response).toBeFocused();
  expect(sent).toBe(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#btn-caixa-conversas-drawer')).toBeFocused();
});
