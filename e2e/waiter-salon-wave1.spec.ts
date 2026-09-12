import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const APP_ORIGIN = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;
const NOW = new Date('2026-08-30T15:00:00.000Z');

const mockTables = [
  { id: 1, nome: 'Mesa 1', capacidade: 4, status: 'livre' },
  { id: 2, nome: 'Mesa 2', capacidade: 4, status: 'ocupada' },
  { id: 3, nome: 'Mesa 3', capacidade: 4, status: 'ocupada' },
  { id: 4, nome: 'Mesa 4', capacidade: 2, status: 'ocupada' }, // mesclada para Mesa 2
  { id: 5, nome: 'Varanda Nobre', capacidade: 6, status: 'livre' },
];

const mockOrders = [
  // Mesa 2: Ocupada normal (preparando)
  {
    id: 'check-mesa-2',
    restaurante_id: 99001,
    mesa_id: 2,
    garcom_id: 'waiter-phase7',
    criada_por: { nome: 'Garçom Teste' },
    tipo: 'Consumo no Local',
    numero_pedido: 102,
    fechada: false,
    valor_pago: 0,
    criado_em: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    status_comanda: null,
    itens: [
      {
        id: 'item-2-1',
        lancamento_id: 'launch-2-1',
        produto_id: 'prod-1',
        preco_unit: 45,
        status: 'preparando',
        pago: false,
        cliente_nome: 'Consumo Geral',
        produto: { id: 'prod-1', nome: 'Hambúrguer Gourmet', preco: 45, ativo: true },
      },
    ],
  },
  // Mesa 3: Ocupada com itens prontos
  {
    id: 'check-mesa-3',
    restaurante_id: 99001,
    mesa_id: 3,
    garcom_id: 'waiter-phase7',
    criada_por: { nome: 'Garçom Teste' },
    tipo: 'Consumo no Local',
    numero_pedido: 103,
    fechada: false,
    valor_pago: 0,
    criado_em: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    status_comanda: null,
    itens: [
      {
        id: 'item-3-1',
        lancamento_id: 'launch-3-1',
        produto_id: 'prod-2',
        preco_unit: 30,
        status: 'pronto',
        pago: false,
        cliente_nome: 'Consumo Geral',
        produto: { id: 'prod-2', nome: 'Porção Batata Frita', preco: 30, ativo: true },
      },
    ],
  },
  // Mesa 4: Mesclada para Mesa 2 (mesa_origem_id: 4, mesa_id: 2)
  {
    id: 'check-mesa-4-merged',
    restaurante_id: 99001,
    mesa_id: 2,
    mesa_origem_id: 4,
    garcom_id: 'waiter-phase7',
    criada_por: { nome: 'Garçom Teste' },
    tipo: 'Consumo no Local',
    numero_pedido: 104,
    fechada: false,
    valor_pago: 0,
    criado_em: new Date(NOW.getTime() - 15 * 60_000).toISOString(),
    status_comanda: null,
    itens: [
      {
        id: 'item-4-1',
        lancamento_id: 'launch-4-1',
        produto_id: 'prod-3',
        preco_unit: 25,
        status: 'entregue',
        pago: false,
        cliente_nome: 'Consumo Geral',
        produto: { id: 'prod-3', nome: 'Sobremesa Pudim', preco: 25, ativo: true },
      },
    ],
  },
];

async function setupWaiterWave1(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    localStorage.setItem('koma_waiter_token', 'waiter-wave1-test-token');
    localStorage.setItem('koma_waiter_id', 'waiter-phase7');
    localStorage.setItem('koma_waiter_name', 'Garçom Wave 1');
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
    const method = request.method();

    if (method === 'GET' && path === '/mesas/') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockTables) });
    } else if (method === 'GET' && path === '/comandas/detalhes/todos') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockOrders) });
    } else if (method === 'GET' && path.startsWith('/comandas/check-')) {
      const order = mockOrders.find(o => o.id === path.split('/')[2]);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order || mockOrders[0]) });
    } else if (method === 'GET' && path.startsWith('/atendimentos/mesas/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ familias: [] }) });
    } else if (method === 'GET' && (path === '/produtos/catalogo' || path === '/produtos/categorias')) {
      if (path === '/produtos/categorias') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'cat-1', nome: 'Geral', destino_impressao: 'COZINHA' }]) });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            categorias: [{ id: 'cat-1', nome: 'Geral', destino_impressao: 'COZINHA' }],
            produtos: [
              { id: 'prod-1', nome: 'Hambúrguer Gourmet', preco: 45, ativo: true, categoria_id: 'cat-1' },
              { id: 'prod-2', nome: 'Porção Batata Frita', preco: 30, ativo: true, categoria_id: 'cat-1' },
              { id: 'prod-3', nome: 'Sobremesa Pudim', preco: 25, ativo: true, categoria_id: 'cat-1' },
            ],
          }),
        });
      }
    } else if (method === 'GET' && path === '/caixa/configuracoes') {
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
    } else if (method === 'GET' && path === '/caixa/pagamentos/pendentes') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });

  await page.goto('/?view=garcom');
  await expect(page.locator('#mesa-card-1')).toBeVisible({ timeout: 10000 });
}

test.describe('App do Garçom - Salão Onda 1', () => {
  test('Top do Salão ocupa menos espaço e não repete contagens já presentes nos filtros', async ({ page }) => {
    await setupWaiterWave1(page);

    const stage = page.locator('.waiter-salon-stage');
    await expect(stage).toBeVisible();

    // Valida título do Salão
    await expect(stage.getByRole('heading', { name: 'Salão' })).toBeVisible();

    // Valida texto orientativo
    await expect(stage).toContainText('Mesa livre abre um novo pedido. Mesa ocupada abre o consumo; itens prontos aparecem no filtro abaixo.');

    // Valida que exibe apenas a contagem total de mesas no topo
    await expect(stage).toContainText('5 mesas');

    // Valida que NÃO existem os cards grandes com contagens repetidas (Livres, Ocupadas, Prontas) no topo
    await expect(stage.locator('.grid.grid-cols-3')).toHaveCount(0);
    await expect(stage.getByText('SALÃO', { exact: true })).toHaveCount(0);
  });

  test('Ações nos cards ficam óbvias antes do clique para livres, ocupadas, itens prontos e mescladas', async ({ page }) => {
    await setupWaiterWave1(page);

    // 1. Mesa Livre (Mesa 1): Ação deve ser "Novo pedido"
    const card1 = page.locator('#mesa-card-1');
    await expect(card1).toBeVisible();
    await expect(card1).toHaveAttribute('data-waiter-action', 'Novo pedido');
    await expect(card1.getByText('Novo pedido', { exact: true })).toBeVisible();
    await expect(card1.getByRole('button')).toHaveAttribute('aria-label', /Novo pedido na Mesa 1/i);

    // 2. Mesa Ocupada (Mesa 2): Ação deve ser "Ver consumo"
    const card2 = page.locator('#mesa-card-2');
    await expect(card2).toBeVisible();
    await expect(card2).toHaveAttribute('data-waiter-action', 'Ver consumo');
    await expect(card2.getByText('Ver consumo', { exact: true })).toBeVisible();
    await expect(card2.getByRole('button')).toHaveAttribute('aria-label', /Ver consumo na Mesa 2/i);

    // 3. Mesa com Itens Prontos (Mesa 3): Ação deve ser "Ver itens prontos"
    const card3 = page.locator('#mesa-card-3');
    await expect(card3).toBeVisible();
    await expect(card3).toHaveAttribute('data-waiter-action', 'Ver itens prontos');
    await expect(card3.getByText('Ver itens prontos', { exact: true })).toBeVisible();
    await expect(card3.getByRole('button')).toHaveAttribute('aria-label', /Ver itens prontos na Mesa 3/i);

    // 4. Mesa Mesclada (Mesa 4): Ação deve ser "Ver atendimento"
    const card4 = page.locator('#mesa-card-4');
    await expect(card4).toBeVisible();
    await expect(card4).toHaveAttribute('data-waiter-action', 'Ver atendimento');
    await expect(card4.getByText('Ver atendimento', { exact: true })).toBeVisible();
    await expect(card4.getByRole('button')).toHaveAttribute('aria-label', /Ver atendimento na Mesa 4/i);

    if (page.viewportSize()?.width === 390) {
      await page.screenshot({ path: '/home/testuser/.gemini/antigravity/brain/7af21423-1a1c-472c-912d-77c093671571/waiter_salon_mobile_overview.png' });
    } else if (page.viewportSize()?.width === 1024) {
      await page.screenshot({ path: '/home/testuser/.gemini/antigravity/brain/7af21423-1a1c-472c-912d-77c093671571/waiter_salon_desktop_overview.png' });
    }
  });

  test('Filtros filtram corretamente mesas livres, ocupadas e prontas', async ({ page }) => {
    await setupWaiterWave1(page);

    const filterGroup = page.getByRole('group', { name: 'Filtrar mesas por status' });

    // Filtro Todas
    await expect(filterGroup.getByRole('button', { name: /^Todas/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#mesa-card-1')).toBeVisible();
    await expect(page.locator('#mesa-card-2')).toBeVisible();
    await expect(page.locator('#mesa-card-3')).toBeVisible();
    await expect(page.locator('#mesa-card-4')).toBeVisible();
    await expect(page.locator('#mesa-card-5')).toBeVisible();

    // Filtro Livres: deve mostrar Mesa 1 e Mesa 5 (Varanda Nobre)
    await filterGroup.getByRole('button', { name: /^Livres/ }).click();
    await expect(page.locator('#mesa-card-1')).toBeVisible();
    await expect(page.locator('#mesa-card-5')).toBeVisible();
    await expect(page.locator('#mesa-card-2')).toHaveCount(0);
    await expect(page.locator('#mesa-card-3')).toHaveCount(0);
    await expect(page.locator('#mesa-card-4')).toHaveCount(0);

    // Filtro Ocupadas: deve mostrar Mesa 2, Mesa 3
    await filterGroup.getByRole('button', { name: /^Ocupadas/ }).click();
    await expect(page.locator('#mesa-card-2')).toBeVisible();
    await expect(page.locator('#mesa-card-3')).toBeVisible();
    await expect(page.locator('#mesa-card-1')).toHaveCount(0);
    await expect(page.locator('#mesa-card-5')).toHaveCount(0);

    // Filtro Prontas: deve mostrar Mesa 3
    await filterGroup.getByRole('button', { name: /^Prontas/ }).click();
    await expect(page.locator('#mesa-card-3')).toBeVisible();
    await expect(page.locator('#mesa-card-1')).toHaveCount(0);
    await expect(page.locator('#mesa-card-2')).toHaveCount(0);
    await expect(page.locator('#mesa-card-4')).toHaveCount(0);
    await expect(page.locator('#mesa-card-5')).toHaveCount(0);
  });

  test('Busca por número e nome filtra e tecla Enter abre a mesa', async ({ page }) => {
    await setupWaiterWave1(page);

    // Abre a busca
    await page.locator('#waiter-table-search-toggle').click();
    const input = page.locator('#waiter-table-search-input');
    await expect(input).toBeVisible();

    // Busca por número "3"
    await input.fill('3');
    await expect(page.locator('#mesa-card-3')).toBeVisible();
    await expect(page.locator('#mesa-card-1')).toHaveCount(0);
    await expect(page.locator('#mesa-card-2')).toHaveCount(0);

    // Pressiona Enter para abrir
    await input.press('Enter');
    await expect(page.locator('#modal-outer-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Mesa 3/ })).toBeVisible();

    // Fecha o modal
    await page.locator('#close-mesa-modal-btn').click();
    await expect(page.locator('#modal-outer-overlay')).toHaveCount(0);

    // Reabre busca e busca por nome "Varanda"
    await page.locator('#waiter-table-search-toggle').click();
    const input2 = page.locator('#waiter-table-search-input');
    await input2.fill('Varanda');
    await expect(page.locator('#mesa-card-5')).toBeVisible();
    await expect(page.locator('#mesa-card-1')).toHaveCount(0);

    // Pressiona Enter para abrir a mesa encontrada por nome
    await input2.press('Enter');
    await expect(page.locator('#modal-outer-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Mesa 5/ })).toBeVisible();

    await page.locator('#close-mesa-modal-btn').click();
    await expect(page.locator('#modal-outer-overlay')).toHaveCount(0);
  });

  test('Abertura de cada tipo de mesa direciona para o fluxo canônico correto', async ({ page }) => {
    await setupWaiterWave1(page);

    // 1. Clique em Mesa Livre (Mesa 1) -> deve abrir direto na aba de Cardápio / Lançamento
    await page.locator('#mesa-card-1').click();
    await expect(page.locator('#modal-outer-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Mesa 1/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Cardápio|Novo Pedido/i })).toHaveAttribute('aria-selected', 'true');
    await page.locator('#close-mesa-modal-btn').click();
    await expect(page.locator('#modal-outer-overlay')).toHaveCount(0);

    // 2. Clique em Mesa Ocupada (Mesa 2) -> deve abrir na aba de Consumo
    await page.locator('#mesa-card-2').click();
    await expect(page.locator('#modal-outer-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Mesa 2/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Consumo/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Hambúrguer Gourmet')).toBeVisible();
    await page.locator('#close-mesa-modal-btn').click();
    await expect(page.locator('#modal-outer-overlay')).toHaveCount(0);

    // 3. Clique em Mesa com Item Pronto (Mesa 3) -> abre consumo destacando item pronto
    await page.locator('#mesa-card-3').click();
    await expect(page.locator('#modal-outer-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Mesa 3/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Consumo/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Porção Batata Frita')).toBeVisible();
    await expect(page.getByText('Pronto!')).toBeVisible();
    await page.locator('#close-mesa-modal-btn').click();
    await expect(page.locator('#modal-outer-overlay')).toHaveCount(0);

    // 4. Clique em Mesa Mesclada (Mesa 4 mesclada para Mesa 2) -> deve abrir a Mesa 2 (destino da mesclagem)
    await page.locator('#mesa-card-4').click();
    await expect(page.locator('#modal-outer-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Mesa 2/ })).toBeVisible();
    await expect(page.getByText(/Mesclado da Mesa 4/i)).toBeVisible();
    await page.locator('#close-mesa-modal-btn').click();
    await expect(page.locator('#modal-outer-overlay')).toHaveCount(0);
  });
});
