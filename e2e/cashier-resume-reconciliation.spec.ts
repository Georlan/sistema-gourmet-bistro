import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const now = new Date().toISOString();

const onlineOrder = {
  id: 'c-online-resume',
  restaurante_id: 99001,
  mesa_id: null,
  garcom_id: 'caixa-e2e',
  tipo: 'Retirada',
  identificador: 'Cliente Retomada',
  numero_pedido: 8888,
  fechada: false,
  valor_pago: 0,
  criado_em: now,
  delivery_status: 'producao',
  delivery_telefone: '11988887777',
  delivery_endereco: null,
  delivery_taxa: 0,
  lancamentos: [{ id: 'l-online-resume', origem: 'cardapio', timestamp: now }],
  itens: [
    {
      id: 'i-online-resume',
      produto_id: '101',
      preco_unit: 45,
      observacao: '',
      cliente_nome: 'Cliente Retomada',
      status: 'preparando',
      pago: false,
      produto: { id: '101', nome: 'Hambúrguer Gourmet', preco: 45, ativo: true },
    },
  ],
};

const cashierConfig = {
  taxa_servico_ativa: true,
  taxa_servico_padrao: 10,
  unificar_vias_delivery: false,
  perm_garcom_delivery: true,
  perm_garcom_editar: true,
  perm_garcom_taxas: true,
  perm_garcom_cancelar: true,
  perm_garcom_status: true,
  perm_garcom_abrir_vazia: true,
  perm_garcom_print: true,
  perm_garcom_fechar: true,
  perm_garcom_desconto: true,
  perm_garcom_acrescimo: true,
  perm_garcom_pessoas: true,
  perm_garcom_transferir_mesa: true,
  perm_garcom_transferir_item: true,
  perm_garcom_chamar: true,
  perm_garcom_ociosas: true,
};

async function seedCashierSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('koma_caixa_token', 'playwright-e2e-token');
    localStorage.setItem('koma_caixa_id', 'caixa-e2e');
    localStorage.setItem('koma_caixa_name', 'Caixa E2E');
    localStorage.setItem('koma_caixa_role', 'caixa');
    localStorage.setItem('token', 'playwright-e2e-token');
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'pedidos');
  });
}

test('reconciliação ao retornar do background move card imediatamente', async ({ context, page }) => {
  let deliveryStatus = 'producao';
  let deliveryCalls = 0;

  await seedCashierSession(page);

  await page.route(`${API_ORIGIN}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    let body: unknown = {};

    if (pathname === '/comandas/delivery/ativos') {
      deliveryCalls += 1;
      body = [{ ...onlineOrder, delivery_status: deliveryStatus }];
    } else if (pathname === '/comandas/detalhes/todos') {
      body = [{ ...onlineOrder, delivery_status: deliveryStatus }];
    } else if (pathname === '/mesas/') {
      body = [];
    } else if (pathname === '/produtos/catalogo') {
      body = {
        categorias: [{ id: 'cat-1', nome: 'Burgers', destino_impressao: 'COZINHA' }],
        produtos: [{ id: '101', nome: 'Hambúrguer Gourmet', preco: 45, categoria_id: 'cat-1', ativo: true }],
      };
    } else if (pathname === '/caixa/configuracoes') {
      body = cashierConfig;
    } else if (pathname === '/caixa/turno/atual' || pathname === '/caixa/turno-atual/resumo') {
      body = {
        id: 501,
        turno_id: 501,
        status: 'aberto',
        aberto_por_id: 'caixa-e2e',
        aberto_em: now,
        operador_nome: 'Caixa E2E',
        saldo_inicial: 100,
        saldo_esperado_dinheiro: 100,
        total_vendas: 0,
        total_dinheiro: 0,
        total_pix: 0,
        total_cartao: 0,
        total_sangrias: 0,
        total_suprimentos: 0,
        total_pedidos_pagos: 0,
        movimentacoes: [],
        pagamentos: [],
        atividades_recentes: [],
      };
    } else if (
      pathname === '/caixa/pagamentos/pendentes' ||
      pathname === '/comandas/motoboys/lista' ||
      pathname === '/auth/usuarios'
    ) {
      body = [];
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  const viewport = page.viewportSize();
  const isMobile = viewport ? viewport.width < 1024 : false;

  await page.goto('/?view=caixa');

  if (isMobile) {
    await page.getByRole('tab', { name: /Balcão/ }).click();
  }

  // O card deve aparecer na coluna de Em Produção
  const card = page.locator('text=Cliente Retomada').first();
  await expect(card).toBeVisible({ timeout: 10000 });

  console.log('Initial delivery calls:', deliveryCalls);
  const initialCalls = deliveryCalls;

  // SIMULA BACKGROUND: abre outra aba
  const page2 = await context.newPage();
  await page2.goto('about:blank');

  // Enquanto a aba do Caixa estiver em background, o backend atualiza o status do pedido para 'pronto'
  deliveryStatus = 'pronto';

  // Volta para a aba do Caixa
  await page.bringToFront();

  // Aciona focus e visibilitychange para garantir disparo no navegador de teste
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });

  if (isMobile) {
    await expect(page.getByRole('tab', { name: /Concluir/ })).toContainText('1');
    await page.getByRole('tab', { name: /Concluir/ }).click();
  }

  // O card deve reconciliar IMEDIATAMENTE sem esperar 12 segundos
  // Status 'pronto' de Retirada exibe o rótulo "PRONTO PARA RETIRADA"
  await expect(page.getByText('PRONTO PARA RETIRADA')).toBeVisible({ timeout: 2000 });

  console.log('Calls after resume:', deliveryCalls);
  expect(deliveryCalls).toBeGreaterThan(initialCalls);
});

test('respostas fora de ordem não fazem o status regredir para trás', async ({ page }) => {
  await seedCashierSession(page);

  let deliveryStatus = 'producao';
  let holdNextRequest = false;
  let resolveHeldRequest: (() => void) | null = null;

  await page.route(`${API_ORIGIN}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    let body: unknown = {};

    if (pathname === '/comandas/delivery/ativos') {
      if (holdNextRequest) {
        holdNextRequest = false;
        await new Promise<void>(resolve => {
          resolveHeldRequest = resolve;
        });
      }
      body = [{ ...onlineOrder, delivery_status: deliveryStatus }];
    } else if (pathname === '/comandas/detalhes/todos') {
      body = [];
    } else if (pathname === '/mesas/') {
      body = [];
    } else if (pathname === '/produtos/catalogo') {
      body = {
        categorias: [{ id: 'cat-1', nome: 'Burgers', destino_impressao: 'COZINHA' }],
        produtos: [{ id: '101', nome: 'Hambúrguer Gourmet', preco: 45, categoria_id: 'cat-1', ativo: true }],
      };
    } else if (pathname === '/caixa/configuracoes') {
      body = cashierConfig;
    } else if (pathname === '/caixa/turno/atual' || pathname === '/caixa/turno-atual/resumo') {
      body = {
        id: 501,
        turno_id: 501,
        status: 'aberto',
        aberto_por_id: 'caixa-e2e',
        aberto_em: now,
        operador_nome: 'Caixa E2E',
        saldo_inicial: 100,
        saldo_esperado_dinheiro: 100,
        total_vendas: 0,
        total_dinheiro: 0,
        total_pix: 0,
        total_cartao: 0,
        total_sangrias: 0,
        total_suprimentos: 0,
        total_pedidos_pagos: 0,
        movimentacoes: [],
        pagamentos: [],
        atividades_recentes: [],
      };
    } else if (
      pathname === '/caixa/pagamentos/pendentes' ||
      pathname === '/comandas/motoboys/lista' ||
      pathname === '/auth/usuarios'
    ) {
      body = [];
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  const viewport = page.viewportSize();
  const isMobile = viewport ? viewport.width < 1024 : false;

  await page.goto('/?view=caixa');

  if (isMobile) {
    await page.getByRole('tab', { name: /Balcão/ }).click();
  }

  await expect(page.locator('text=Cliente Retomada').first()).toBeVisible();

  // Arma a próxima requisição para ficar retida na rede com status 'producao'
  holdNextRequest = true;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('koma_orders_updated'));
  });

  // Aguarda 50ms para garantir que a requisição lenta entrou em processamento
  await page.waitForTimeout(50);

  // Enquanto a requisição antiga está presa, o backend avança para 'pronto'
  deliveryStatus = 'pronto';

  // Agora simula retomada do Caixa, que dispara fetchDeliveryOrders imediatamente
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });

  if (isMobile) {
    await expect(page.getByRole('tab', { name: /Concluir/ })).toContainText('1');
    await page.getByRole('tab', { name: /Concluir/ }).click();
  }

  // A requisição de retomada (rápida) deve atualizar para "PRONTO PARA RETIRADA"
  await expect(page.getByText('PRONTO PARA RETIRADA')).toBeVisible({ timeout: 2000 });

  // Agora a requisição antiga (lenta, com status antigo 'producao') finalmente responde!
  if (resolveHeldRequest) {
    resolveHeldRequest();
  }

  // Espera um instante para ver se a resposta lenta sobrescreveria o estado
  await page.waitForTimeout(300);

  // O card NÃO DEVE regredir para trás ("EM PREPARO")! Deve continuar "PRONTO PARA RETIRADA"!
  await expect(page.getByText('PRONTO PARA RETIRADA')).toBeVisible();
  await expect(page.locator('.orders-card__chip:text-is("EM PREPARO")')).toHaveCount(0);
});

