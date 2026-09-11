import { expect, Page, test } from '@playwright/test';

import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function rect(page: Page, selector: string): Promise<Rect> {
  return page.locator(selector).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
    };
  });
}

function intersects(a: Rect, b: Rect) {
  return a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
}

async function openCashier(page: Page, theme: 'dark' | 'light') {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript((nextTheme) => {
    localStorage.setItem('@koma:theme', nextTheme);
  }, theme);
  await page.goto('/?view=caixa');
  await expect(page.locator('html')).toHaveAttribute('data-koma-theme', theme);
  await expect(page.locator('.cashier-topbar')).toBeVisible();
}

async function navigate(page: Page, label: string) {
  const sidebar = page.locator('.cashier-sidebar:visible');
  if (!await sidebar.isVisible()) {
    await page.getByRole('button', { name: 'Abrir menu principal' }).click();
    await expect(page.locator('.cashier-sidebar:visible')).toBeVisible();
  }
  await page.locator('.cashier-sidebar:visible').getByRole('button', { name: new RegExp(`^${label}(?: \\d+)?$`) }).first().click();
  await expect(page.locator('#mobile-caixa-sidebar')).not.toBeVisible();
}

const mobileViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
] as const;

for (const theme of ['dark', 'light'] as const) {
  for (const viewport of mobileViewports) {
    test(`topbar mobile não colide em ${viewport.width}x${viewport.height} no tema ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openCashier(page, theme);

      const menu = page.locator('#btn-mobile-caixa-sidebar-open');
      const chat = page.locator('#btn-caixa-conversas-drawer');
      const fullscreen = page.locator('#btn-modo-pdv-fullscreen');
      const title = page.locator('.cashier-topbar h2');

      await expect(menu).toBeVisible();
      await expect(chat).toBeVisible();
      await expect(fullscreen).toBeVisible();
      await expect(title).toHaveText('Vendas');

      const [menuBox, titleBox, chatBox, fullscreenBox] = await Promise.all([
        rect(page, '#btn-mobile-caixa-sidebar-open'),
        rect(page, '.cashier-topbar h2'),
        rect(page, '#btn-caixa-conversas-drawer'),
        rect(page, '#btn-modo-pdv-fullscreen'),
      ]);

      for (const target of [menuBox, chatBox, fullscreenBox]) {
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
      expect(titleBox.width).toBeGreaterThan(20);
      expect(intersects(menuBox, titleBox)).toBe(false);
      expect(intersects(titleBox, chatBox)).toBe(false);
      expect(intersects(chatBox, fullscreenBox)).toBe(false);

      const chatBadge = page.locator('#btn-caixa-conversas-drawer [role="status"]');
      if (await chatBadge.count() > 0) {
        await expect(chatBadge).toBeVisible();
        const badgeBox = await chatBadge.boundingBox();
        expect(badgeBox).not.toBeNull();
        if (badgeBox) {
          expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(fullscreenBox.left);
        }
      }

      const subnavButtons = page.locator('.cashier-subnav__button');
      await expect(subnavButtons).toHaveCount(5);
      for (const button of await subnavButtons.all()) {
        const buttonBox = await button.boundingBox();
        expect(buttonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      await expectNoHorizontalOverflow(page);
    });
  }
}

test('topbar acomoda títulos longos de outras áreas sem colisão nem overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openCashier(page, 'light');

  const longTitleAreas = [
    { nav: 'Cardápio online', expectedHeading: /Configurações do cardápio online/i },
    { nav: 'Conta & assinatura', expectedHeading: /Planos de Assinatura e Recebimento Pix/i },
    { nav: 'Configurações', expectedHeading: /Configurações/i },
    { nav: 'Relatórios', expectedHeading: /Relatórios/i },
    { nav: 'Estoque & compras', expectedHeading: /Estoque/i },
    { nav: 'Clientes', expectedHeading: /Clientes/i },
    { nav: 'Equipe', expectedHeading: /Equipe/i },
  ];

  for (const area of longTitleAreas) {
    await navigate(page, area.nav);
    const title = page.locator('.cashier-topbar h2');
    await expect(title).toBeVisible();
    await expect(title).toHaveText(area.expectedHeading);

    const [menuBox, titleBox, chatBox, fullscreenBox] = await Promise.all([
      rect(page, '#btn-mobile-caixa-sidebar-open'),
      rect(page, '.cashier-topbar h2'),
      rect(page, '#btn-caixa-conversas-drawer'),
      rect(page, '#btn-modo-pdv-fullscreen'),
    ]);

    expect(menuBox.width).toBeGreaterThanOrEqual(44);
    expect(menuBox.height).toBeGreaterThanOrEqual(44);
    expect(chatBox.width).toBeGreaterThanOrEqual(44);
    expect(chatBox.height).toBeGreaterThanOrEqual(44);
    expect(fullscreenBox.width).toBeGreaterThanOrEqual(44);
    expect(fullscreenBox.height).toBeGreaterThanOrEqual(44);

    expect(intersects(menuBox, titleBox)).toBe(false);
    expect(intersects(titleBox, chatBox)).toBe(false);
    expect(intersects(chatBox, fullscreenBox)).toBe(false);

    expect(menuBox.right).toBeLessThanOrEqual(titleBox.left + 0.5);
    expect(titleBox.right).toBeLessThanOrEqual(chatBox.left + 0.5);
    expect(chatBox.right).toBeLessThanOrEqual(fullscreenBox.left + 0.5);

    await expectNoHorizontalOverflow(page);
  }
});

test('interação real mobile: abre e fecha menu principal e conversas sem quebras', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openCashier(page, 'light');

  // 1. Abrir e fechar Menu Mobile
  const menuButton = page.locator('#btn-mobile-caixa-sidebar-open');
  await menuButton.click();
  const mobileSidebar = page.locator('#mobile-caixa-sidebar');
  await expect(mobileSidebar).toBeVisible();

  // Fecha menu
  const closeSidebarBtn = page.getByRole('button', { name: 'Fechar menu' });
  await closeSidebarBtn.click();
  await expect(mobileSidebar).not.toBeVisible();

  // 2. Abrir e fechar Gaveta de Conversas
  const chatButton = page.locator('#btn-caixa-conversas-drawer');
  await chatButton.click();
  const chatPanel = page.locator('#cashier-chat-panel');
  await expect(chatPanel).toBeVisible();

  // Fecha conversas
  const closeChatBtn = page.getByRole('button', { name: 'Fechar conversas' });
  await closeChatBtn.click();
  await expect(chatPanel).not.toBeVisible();

  // 3. Navegar nas subtabs de Vendas
  for (const label of ['Novo pedido', 'Salão', 'Cozinha', 'Entregas', 'Pedidos']) {
    const tabBtn = page.locator('.cashier-subnav__button', { hasText: label });
    await tabBtn.click();
    await expect(tabBtn).toHaveClass(/is-active/);
    await expectNoHorizontalOverflow(page);
  }
});

test('configurações do caixa cobrem todas as áreas com ergonomia mobile e contraste no modo claro', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openCashier(page, 'light');
  await navigate(page, 'Configurações');

  await expect(page.getByRole('heading', { name: 'Configurações do Caixa' })).toBeVisible();
  const settingsTabs = page.locator('.cashier-settings-tab');
  await expect(settingsTabs).toHaveCount(5);

  for (const tab of await settingsTabs.all()) {
    const tabBox = await tab.boundingBox();
    expect(tabBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  // 1. Área Aparência: alternar tema e tamanho do texto
  const darkThemeBtn = page.getByRole('button', { name: /Escuro/ });
  await darkThemeBtn.click();
  await expect(page.locator('html')).toHaveAttribute('data-koma-theme', 'dark');

  const lightThemeBtn = page.getByRole('button', { name: /Claro/ });
  await lightThemeBtn.click();
  await expect(page.locator('html')).toHaveAttribute('data-koma-theme', 'light');

  // Tamanho do texto
  const bigFontBtn = page.getByRole('button', { name: /^A\+ Grande/ });
  await bigFontBtn.click();
  const storedFont = await page.evaluate(() => localStorage.getItem('koma_font_size'));
  expect(storedFont).toBe('grande');

  const defaultFontBtn = page.getByRole('button', { name: /^A Padrão/ });
  await defaultFontBtn.click();
  const resetFont = await page.evaluate(() => localStorage.getItem('koma_font_size'));
  expect(resetFont).toBe('padrao');

  // 2. Área Impressão
  await page.getByRole('button', { name: /^Impressão/ }).click();
  await expect(page.getByText('Personalização do cupom')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 3. Área Mesas
  await page.getByRole('button', { name: /^Mesas/ }).click();
  await expect(page.getByText('Configuração das mesas')).toBeVisible();
  const addTableBtn = page.getByRole('button', { name: /Adicionar mesa/i });
  await expect(addTableBtn).toBeVisible();
  const addTableBox = await addTableBtn.boundingBox();
  expect(addTableBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  // Abrir modal de adicionar mesa e fechar
  await addTableBtn.click();
  await expect(page.getByRole('heading', { name: 'Adicionar mesa' })).toBeVisible();
  const cancelBtn = page.getByRole('button', { name: 'Cancelar' });
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();
  await expect(page.getByRole('heading', { name: 'Adicionar mesa' })).not.toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 4. Área App do Garçom
  await page.getByRole('button', { name: /^App do Garçom/ }).click();
  await expect(page.getByText('Permissões do App do Garçom')).toBeVisible();
  for (const sub of ['1. Pedido', '2. Fechamento de Conta', '3. Atendimento']) {
    const subBtn = page.getByRole('button', { name: sub });
    await expect(subBtn).toBeVisible();
    await subBtn.click();
  }
  await expectNoHorizontalOverflow(page);

  // 5. Área Taxa de Serviço
  await page.getByRole('button', { name: /^Taxa de Serviço/ }).click();
  await expect(page.getByText('Taxa de Serviço do Salão')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 6. Área Integrações (via menu lateral do caixa)
  await navigate(page, 'Integrações');
  await expect(page.getByRole('heading', { name: 'Pagamentos e serviços externos' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mercado Pago' })).toBeVisible();
  await expect(page.getByText('Conectado')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Validação de contraste das cores do topbar no modo claro
  const topbarStyles = await page.locator('.cashier-topbar').evaluate((element) => {
    const styles = getComputedStyle(element);
    const title = element.querySelector('h2');
    return {
      background: styles.backgroundColor,
      border: styles.borderBottomColor,
      titleColor: title ? getComputedStyle(title).color : '',
    };
  });
  expect(topbarStyles.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(topbarStyles.titleColor).not.toBe(topbarStyles.background);
  expect(topbarStyles.border).not.toBe(topbarStyles.background);
});

