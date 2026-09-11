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
  }
  await sidebar.getByRole('button', { name: new RegExp(`^${label}(?: \\d+)?$`) }).click();
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

test('configurações do caixa ficam utilizáveis no mobile e permitem validar tema claro', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCashier(page, 'dark');
  await navigate(page, 'Configurações');

  await expect(page.getByRole('heading', { name: 'Configurações do Caixa' })).toBeVisible();
  const settingsTabs = page.getByRole('tablist', { name: 'Configurações do caixa' }).getByRole('tab');
  await expect(settingsTabs).toHaveCount(5);

  for (const tab of await settingsTabs.all()) {
    const tabBox = await tab.boundingBox();
    expect(tabBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const lightTheme = page.getByRole('button', { name: /Claro/ });
  await lightTheme.click();
  await expect(page.locator('html')).toHaveAttribute('data-koma-theme', 'light');
  await expect(lightTheme).toHaveAttribute('aria-pressed', 'true');

  for (const name of ['Impressão', 'Mesas', 'App do Garçom', 'Taxa de Serviço', 'Aparência']) {
    await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
    await expect(page.getByRole('tab', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-selected', 'true');
    await expectNoHorizontalOverflow(page);
  }

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

  await expectNoHorizontalOverflow(page);
});
