import { expect, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const APP_ORIGIN = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`garçom sai do loading silencioso quando mesas travam no ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(() => {
      localStorage.setItem('koma_waiter_token', 'waiter-timeout-token');
      localStorage.setItem('koma_waiter_id', 'waiter-timeout');
      localStorage.setItem('koma_waiter_name', 'Garçom Timeout');
      localStorage.setItem('koma_user_role', 'garcom');
    });

    await page.routeWebSocket(/\/ws\//, socket => {
      socket.onMessage(() => {});
    });

    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN) {
        await route.continue();
        return;
      }
      if (url.origin !== API_ORIGIN) {
        await route.abort();
        return;
      }

      if (request.method() === 'GET' && url.pathname === '/mesas/') {
        await new Promise(resolve => setTimeout(resolve, 12_000));
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
        return;
      }

      let body: unknown = [];
      if (request.method() === 'GET' && url.pathname === '/produtos/catalogo') {
        body = { categorias: [], produtos: [] };
      } else if (request.method() === 'GET' && url.pathname === '/caixa/configuracoes') {
        body = {
          taxa_servico_ativa: false,
          taxa_servico_padrao: 0,
          perm_garcom_status: true,
          perm_garcom_print: true,
          perm_garcom_fechar: false,
          perm_garcom_editar: true,
          perm_garcom_cancelar_item: true,
          perm_garcom_transferir_mesa: true,
          perm_garcom_transferir_item: true,
          perm_garcom_delivery: false,
        };
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });

    await page.goto('/?view=garcom');
    await expect(page.getByTestId('operational-snapshot-loading')).toBeVisible();
    await expect(page.getByText('Carregando o estado real de mesas e comandas antes de liberar a operação.')).toBeVisible();
    await expect(page.getByText('Ainda não foi possível obter um snapshot operacional válido. O KÔMA tentará novamente sem assumir mesas livres ou pedidos vazios.')).toBeVisible({ timeout: 7_500 });
  });
}
