import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const DESKTOP_BREAKPOINT = 1024;

const now = new Date().toISOString();

const onlineOrder = {
  id: 'c-online-e2e',
  restaurante_id: 99001,
  mesa_id: null,
  garcom_id: 'caixa-e2e',
  tipo: 'Retirada',
  identificador: 'Ana Teste',
  numero_pedido: 4321,
  fechada: false,
  valor_pago: 0,
  criado_em: now,
  delivery_status: 'pendente',
  delivery_telefone: '85999999999',
  delivery_endereco: null,
  delivery_taxa: 0,
  lancamentos: [
    {
      id: 'l-online-e2e',
      origem: 'cardapio',
      timestamp: now,
    },
  ],
  itens: [
    {
      id: 'i-online-e2e',
      produto_id: '101',
      preco_unit: 48,
      observacao: 'Sem cebola',
      cliente_nome: 'Ana Teste',
      status: 'preparando',
      pago: false,
      produto: {
        id: '101',
        nome: 'Pizza Margherita',
        preco: 48,
        ativo: true,
      },
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

async function mockCashierWithOnlineOrder(page: Page) {
  let deliveryStatus = 'pendente';
  let acceptCalls = 0;

  await page.route(`${API_ORIGIN}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    let body: unknown = {};

    if (pathname === '/comandas/delivery/ativos' || pathname === '/comandas/detalhes/todos') {
      body = [{ ...onlineOrder, delivery_status: deliveryStatus }];
    } else if (pathname === '/comandas/c-online-e2e/delivery/status' && request.method() === 'PUT') {
      const next = url.searchParams.get('status_novo') || deliveryStatus;
      if (next === 'producao') acceptCalls += 1;
      deliveryStatus = next;
      body = { ...onlineOrder, delivery_status: deliveryStatus };
    } else if (pathname === '/mesas/') {
      body = [];
    } else if (pathname === '/produtos/catalogo') {
      body = {
        categorias: [{ id: 'cat-pizza', nome: 'Pizzas', destino_impressao: 'COZINHA' }],
        produtos: [{ id: '101', nome: 'Pizza Margherita', preco: 48, categoria_id: 'cat-pizza', ativo: true }],
      };
    } else if (pathname === '/caixa/configuracoes') {
      body = cashierConfig;
    } else if (pathname === '/caixa/turno/atual') {
      body = {
        id: 501,
        aberto_por_id: 'caixa-e2e',
        aberto_em: now,
        saldo_inicial: 100,
        status: 'aberto',
        movimentacoes: [],
        pagamentos: [],
      };
    } else if (pathname === '/caixa/turno-atual/resumo') {
      body = {
        turno_id: 501,
        status: 'aberto',
        operador_id: 'caixa-e2e',
        operador_nome: 'Caixa E2E',
        aberto_em: now,
        tempo_aberto_minutos: 5,
        saldo_inicial: 100,
        total_vendas: 0,
        total_dinheiro: 0,
        total_pix: 0,
        total_cartao: 0,
        total_sangrias: 0,
        total_suprimentos: 0,
        saldo_esperado_dinheiro: 100,
        total_pedidos_pagos: 0,
        atividades_recentes: [],
      };
    } else if (
      pathname === '/caixa/pagamentos/pendentes'
      || pathname === '/comandas/motoboys/lista'
      || pathname === '/auth/usuarios'
    ) {
      body = [];
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  return {
    getAcceptCalls: () => acceptCalls,
  };
}

test('pedido do cardápio é aceito uma vez e surge no kanban com contexto útil', async ({ page }) => {
  await seedCashierSession(page);
  const state = await mockCashierWithOnlineOrder(page);

  await page.goto('/?view=caixa');

  await expect(page.locator('.orders-board')).toBeVisible();

  const pendingButton = page.getByRole('button', { name: /Aguardando aceite/i });
  await expect(pendingButton).toBeVisible();
  await pendingButton.click();

  const pendingCard = page.locator('.orders-pending-card').filter({ hasText: 'Ana Teste' });
  await expect(pendingCard).toBeVisible();
  await expect(pendingCard).toContainText('Retirada');
  await expect(pendingCard).toContainText('85999999999');
  await expect(pendingCard).toContainText('Pizza Margherita');
  await expect(pendingCard).toContainText(/R\$\s*48,00/);

  await pendingCard.getByRole('button', { name: /Aceitar/i }).click();

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport não configurado.');
  if (viewport.width < DESKTOP_BREAKPOINT) {
    const digitalStageTab = page.getByRole('tab', { name: /Balcão/ });
    await expect(digitalStageTab).toBeVisible();
    await digitalStageTab.tap();
    await expect(digitalStageTab).toHaveAttribute('aria-selected', 'true');
  }

  const digitalColumn = page.locator('.orders-column--digital');
  await expect(digitalColumn).toBeVisible();
  await expect(digitalColumn).toContainText('Ana Teste');
  await expect(digitalColumn).toContainText('Retirada');
  await expect(digitalColumn).toContainText('85999999999');
  await expect(digitalColumn).toContainText('Pizza Margherita');
  await expect(digitalColumn).toContainText('Cardápio online');
  await expect(digitalColumn).toContainText(/R\$\s*48,00/);
  await expect(digitalColumn).toContainText(/EM PREPARO/i);

  expect(state.getAcceptCalls()).toBe(1);

  // Clica em 'Pronto para retirada' na coluna 02
  await digitalColumn.getByRole('button', { name: /Pronto para retirada/i }).click();

  if (viewport.width < DESKTOP_BREAKPOINT) {
    const closingStageTab = page.getByRole('tab', { name: /Concluir/ });
    await expect(closingStageTab).toBeVisible();
    await closingStageTab.tap();
    await expect(closingStageTab).toHaveAttribute('aria-selected', 'true');
  }

  // Pedido agora reside na coluna 03 (FECHAMENTO) e NÃO desaparece
  const closingColumn = page.locator('.orders-column--closing');
  await expect(closingColumn).toBeVisible();
  await expect(closingColumn).toContainText('Ana Teste');
  await expect(closingColumn).toContainText(/PRONTO PARA RETIRADA/i);
  const checkoutButton = closingColumn.getByRole('button', { name: /Receber e finalizar/i });
  await expect(checkoutButton).toBeVisible();

  // Ao abrir o checkout, o item não fica travado em 'em preparo' e permite baixa
  await checkoutButton.click();
  await expect(page.getByText('CHECKOUT / CAIXA')).toBeVisible();
  await expect(page.getByText('Pizza Margherita', { exact: true })).toBeVisible();
  await expect(page.getByText(/Em preparo · avance na cozinha/i)).not.toBeVisible();
  await expect(page.getByRole('button', { name: /(Receber itens selecionados|Lançar pagamento)/i })).toBeEnabled();
});
