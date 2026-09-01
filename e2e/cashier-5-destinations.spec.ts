import { expect, type Page, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function openCaixa(page: Page, initialTab?: string, initialSubTab?: string) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  if (initialTab) {
    await page.addInitScript(({ tab, subtab }) => {
      sessionStorage.setItem('koma_active_tab', tab);
      if (subtab) sessionStorage.setItem('koma_active_subtab', subtab);
    }, { tab: initialTab, subtab: initialSubTab || '' });
  }
  await page.goto('/?view=caixa');
}

async function clickSidebarItem(page: Page, label: string) {
  const viewport = page.viewportSize();
  const isMobile = (viewport?.width ?? 1366) < 1024;

  if (isMobile) {
    const mobileSidebar = page.locator('#mobile-caixa-sidebar');
    if (!await mobileSidebar.isVisible()) {
      await page.getByRole('button', { name: 'Abrir menu principal' }).click();
      await expect(mobileSidebar).toBeVisible();
    }
    const button = mobileSidebar.getByRole('button', { name: new RegExp(`^${label}(?: \\d+)?$`) });
    await expect(button).toBeVisible();
    await button.click();
  } else {
    const desktopSidebar = page.locator('.cashier-sidebar:not(.cashier-sidebar--mobile)');
    const button = desktopSidebar.getByRole('button', { name: new RegExp(`^${label}(?: \\d+)?$`) });
    await expect(button).toBeVisible();
    await button.click();
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test.describe('Navegação 5 Destinos KÔMA', () => {
  test('A. Agora: Carrega painel operacional inicial sem erros', async ({ page }) => {
    await openCaixa(page, 'agora', 'agora');
    await expect(page.locator('#agora-panel-container')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Painel Agora' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('B. Vender: Navega entre Pedidos, Balcão e Salão', async ({ page }) => {
    await openCaixa(page, 'operacao', 'pedidos');
    await expect(page.locator('.orders-board')).toBeVisible();

    // Balcão (Novo pedido)
    await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
    await expect(page.getByPlaceholder('Buscar item, descrição ou código')).toBeVisible();

    // Salão (Mesas)
    await page.getByRole('button', { name: 'Salão', exact: true }).click();
    await expect(page.locator('[data-table-status="free"]').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('C. Cardápio: Navega entre Produtos, Complementos e Categorias', async ({ page }) => {
    await openCaixa(page, 'cardapio', 'produtos');
    await expect(page.getByLabel('Buscar produtos')).toBeVisible();

    // Complementos
    await page.getByRole('button', { name: 'Complementos', exact: true }).click();
    await expect(page.getByText('Grupos de Complementos & Adicionais')).toBeVisible();

    // Preparo e impressão (Categorias)
    await page.getByRole('button', { name: 'Preparo e impressão', exact: true }).click();
    await expect(page.getByLabel('Buscar categorias')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('D. Gestão: Hub expansível acessa Caixa, Estoque, Clientes e Equipe', async ({ page }) => {
    await openCaixa(page, 'agora', 'agora');

    // Expand Gestão hub
    await clickSidebarItem(page, 'Gestão');

    // 1. Caixa (Turno Atual)
    await clickSidebarItem(page, 'Caixa');
    await expect(page.getByText('Vendas recebidas', { exact: true })).toBeVisible();

    // 2. Estoque (Ingredientes)
    await clickSidebarItem(page, 'Estoque');
    await expect(page.getByLabel('Buscar ingredientes')).toBeVisible();

    // 3. Clientes
    await clickSidebarItem(page, 'Clientes');
    await expect(page.getByLabel('Buscar clientes')).toBeVisible();

    // 4. Equipe (Pessoas)
    await clickSidebarItem(page, 'Equipe');
    await expect(page.getByLabel('Buscar pessoa')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('E. Resultados: Navega entre Visão Geral, Financeiro, Produtos e Equipe', async ({ page }) => {
    await openCaixa(page, 'relatorios', 'visao_geral');
    await expect(page.getByText('Pagamentos aprovados menos estornos', { exact: true })).toBeVisible();

    // Financeiro
    await page.getByRole('button', { name: 'Financeiro', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Recebimentos por meio' })).toBeVisible();

    // Produtos
    await page.getByRole('button', { name: 'Produtos', exact: true }).click();
    await expect(page.getByText('Consumo não é faturamento.', { exact: true })).toBeVisible();

    // Equipe
    await page.locator('#relatorios-subtab-equipe').click();
    await expect(page.getByText('Desempenho por Funcionário', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('F. Secundários: Configurações, Cardápio Online e Assinatura acessíveis no rodapé', async ({ page }) => {
    await openCaixa(page);

    // Configurações (Impressoras)
    await clickSidebarItem(page, 'Configurações');
    await expect(page.getByRole('button', { name: 'Mesas', exact: true })).toBeVisible();

    // Assinatura e planos
    await clickSidebarItem(page, 'Assinatura e planos');
    await expect(page.getByRole('button', { name: 'Meu Plano' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
