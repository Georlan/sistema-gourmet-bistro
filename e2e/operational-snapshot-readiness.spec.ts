import { expect, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const APP_ORIGIN = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;

test('bootstrap nunca projeta mesas livres antes do snapshot completo de comandas', async ({ page }) => {
  let releaseOrders!: () => void;
  const ordersGate = new Promise<void>(resolve => { releaseOrders = resolve; });
  let tableReads = 0;
  let orderReads = 0;

  await page.addInitScript(() => {
    localStorage.setItem('koma_waiter_token', 'snapshot-readiness-token');
    localStorage.setItem('koma_waiter_id', 'snapshot-readiness-waiter');
    localStorage.setItem('koma_waiter_name', 'Garçom Snapshot');
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

    if (request.method() !== 'GET') {
      await route.fulfill({ status: 501, contentType: 'application/json', body: '{}' });
      return;
    }

    if (url.pathname === '/mesas/') {
      tableReads += 1;
      // Reproduz o caso real: o catálogo de mesas chega primeiro e, isoladamente,
      // não pode ser interpretado como a verdade operacional do salão.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 7, nome: 'Mesa 7', capacidade: 4, status: 'livre' },
          { id: 8, nome: 'Mesa 8', capacidade: 4, status: 'livre' },
        ]),
      });
      return;
    }

    if (url.pathname === '/comandas/detalhes/todos') {
      orderReads += 1;
      await ordersGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'check-snapshot-readiness',
            restaurante_id: 99001,
            mesa_id: 7,
            garcom_id: 'snapshot-readiness-waiter',
            criada_por: { nome: 'Garçom Snapshot' },
            tipo: 'Consumo no Local',
            numero_pedido: 701,
            fechada: false,
            valor_pago: 0,
            criado_em: '2026-09-05T20:00:00.000Z',
            status_comanda: null,
            lancamentos: [{
              id: 'launch-snapshot-readiness',
              comanda_id: 'check-snapshot-readiness',
              origem: 'garcom',
              timestamp: '2026-09-05T20:00:00.000Z',
            }],
            itens: [{
              id: 'item-snapshot-readiness',
              lancamento_id: 'launch-snapshot-readiness',
              produto_id: 'product-snapshot-readiness',
              preco_unit: 39,
              status: 'preparando',
              pago: false,
              cliente_nome: 'Consumo Geral',
              observacao: '',
              produto: {
                id: 'product-snapshot-readiness',
                nome: 'Pedido real da Mesa 7',
                preco: 39,
                ativo: true,
              },
            }],
          },
        ]),
      });
      return;
    }

    if (url.pathname === '/produtos/catalogo') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          categorias: [{ id: 'snapshot-meals', nome: 'Pratos', destino_impressao: 'COZINHA' }],
          produtos: [{
            id: 'product-snapshot-readiness',
            nome: 'Pedido real da Mesa 7',
            preco: 39,
            ativo: true,
            categoria_id: 'snapshot-meals',
          }],
        }),
      });
      return;
    }

    if (url.pathname === '/caixa/configuracoes') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      });
      return;
    }

    await route.fulfill({
      status: 501,
      contentType: 'application/json',
      body: JSON.stringify({ detail: `fixture sem resposta para ${url.pathname}` }),
    });
  });

  await page.goto('/?view=garcom', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('operational-snapshot-loading')).toBeVisible();
  await expect(page.locator('[id^="mesa-card-"]')).toHaveCount(0);
  await expect(page.getByText('Nenhuma mesa encontrada neste status.')).toHaveCount(0);

  // O primeiro open do WebSocket não pode disparar uma segunda rodada de snapshot.
  await expect.poll(() => tableReads).toBe(1);
  await expect.poll(() => orderReads).toBe(1);

  releaseOrders();

  await expect(page.getByTestId('operational-snapshot-loading')).toHaveCount(0);
  await expect(page.locator('#mesa-card-7')).toBeVisible();
  await expect(page.locator('#mesa-card-7')).toContainText('Em preparo');
  await expect(page.locator('#mesa-card-8')).toContainText('Livre');
  await expect(page.getByRole('button', { name: /^Livres 1$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ocupadas 1$/ })).toBeVisible();

  await page.locator('#mesa-card-7').click();
  await expect(page.getByText('Pedido real da Mesa 7')).toBeVisible();

  expect(tableReads).toBe(1);
  expect(orderReads).toBe(1);
});
