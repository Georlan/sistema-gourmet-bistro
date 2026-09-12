import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const APP_ORIGIN = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;

async function openWaiterTable(page: Page) {
  const createdAt = '2026-09-12T08:00:00.000Z';
  const check = {
    id: 'check-waiter-escape',
    restaurante_id: 99001,
    mesa_id: 7,
    garcom_id: 'waiter-escape',
    criada_por: { nome: 'Garçom Escape' },
    tipo: 'Consumo no Local',
    numero_pedido: 77,
    fechada: false,
    valor_pago: 0,
    criado_em: createdAt,
    status_comanda: null,
    lancamentos: [{
      id: 'launch-waiter-escape',
      comanda_id: 'check-waiter-escape',
      origem: 'garcom',
      timestamp: createdAt,
    }],
    itens: [{
      id: 'item-waiter-escape',
      lancamento_id: 'launch-waiter-escape',
      produto_id: 'product-waiter-escape',
      preco_unit: 25,
      status: 'preparando',
      pago: false,
      cliente_nome: 'Consumo Geral',
      observacao: '',
      produto: {
        id: 'product-waiter-escape',
        nome: 'Produto Escape',
        preco: 25,
        ativo: true,
      },
    }],
  };

  await page.addInitScript(() => {
    localStorage.setItem('koma_waiter_token', 'waiter-escape-token');
    localStorage.setItem('koma_waiter_id', 'waiter-escape');
    localStorage.setItem('koma_waiter_name', 'Garçom Escape');
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

    const path = url.pathname;
    let body: unknown = [];
    if (request.method() === 'GET' && path === '/mesas/') {
      body = [{ id: 7, nome: 'Mesa 7', capacidade: 4, status: 'ocupada' }];
    } else if (request.method() === 'GET' && path === '/comandas/detalhes/todos') {
      body = [check];
    } else if (request.method() === 'GET' && path === '/comandas/check-waiter-escape') {
      body = check;
    } else if (request.method() === 'GET' && path === '/atendimentos/mesas/7') {
      body = {
        familias: [{
          numero_conta: 77,
          lancamentos: [{
            lancamento_id: 'launch-waiter-escape',
            pedido_id: '77-A',
            sequencia: 1,
          }],
        }],
      };
    } else if (request.method() === 'GET' && path === '/produtos/catalogo') {
      body = {
        categorias: [{ id: 'cat-escape', nome: 'Pratos', destino_impressao: 'COZINHA' }],
        produtos: [{
          id: 'product-waiter-escape',
          nome: 'Produto Escape',
          preco: 25,
          ativo: true,
          categoria_id: 'cat-escape',
        }],
      };
    } else if (request.method() === 'GET' && path === '/caixa/configuracoes') {
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
    } else if (request.method() === 'GET' && path === '/caixa/pagamentos/pendentes') {
      body = [];
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto('/?view=garcom');
  await expect(page.locator('#mesa-card-7')).toBeVisible();
  await page.locator('#mesa-card-7').click();
  await expect(page.locator('#modal-outer-overlay')).toBeVisible();
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`detalhes da mesa fecham por Escape no ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openWaiterTable(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-outer-overlay')).toHaveCount(0);
  });
}
