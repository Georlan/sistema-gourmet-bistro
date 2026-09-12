import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { mockCashierBackend } from './fixtures/cashier';

async function setupWaiter(page: Page) {
  await mockCashierBackend(page);
  await page.routeWebSocket(/\/ws\//, (socket: WebSocketRoute) => {
    socket.onMessage(() => {});
  });
  await page.addInitScript(() => {
    localStorage.setItem('koma_waiter_token', 'waiter-drawer-token');
    localStorage.setItem('koma_waiter_id', 'waiter-drawer');
    localStorage.setItem('koma_waiter_name', 'Garçom Drawer');
    localStorage.setItem('koma_drafts_vFinal_v3', JSON.stringify({
      10: [{
        id: 'draft-drawer-10',
        produtoId: '101',
        nome: 'Risoto da casa',
        preco: 40,
        observacao: '',
        clienteNome: '',
        quantidade: 2,
      }],
    }));
  });
}

test('drawer do garçom filtra o salão e retoma rascunho em um toque', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupWaiter(page);
  await page.goto('/?view=garcom');

  await page.locator('#open-sidebar-btn').click();
  await expect(page.getByText('Salão agora', { exact: true })).toBeVisible();
  await page.locator('#drawer-show-ready-tables').click();
  await expect(page.locator('#waiter-filter-prontas')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#open-sidebar-btn').click();
  await expect(page.locator('#drawer-resume-draft-10')).toContainText('2 itens aguardando lançamento');
  await page.locator('#drawer-resume-draft-10').click();
  await expect(page.getByText('Mesa 10', { exact: false }).first()).toBeVisible();
});
