import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { publicMenuPayload } from './fixtures/menu-parity';

async function openMenu(page: Page, theme: 'dark' | 'light' = 'dark') {
  await page.routeWebSocket('**/ws/**', () => {});
  await page.route('http://127.0.0.1:8000/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith('/public') ? publicMenuPayload
      : path.endsWith('/populares') ? { produtos: [{ produto_id: '201', escolhas: 12 }] } : {} });
  });
  await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
  await expect(page.locator('#btn-hero-fast-add-201')).toBeVisible();
  // Public entry currently defaults to dark. Exercise the existing light CSS
  // compatibility contract without adding a customer-facing theme switch.
  await page.evaluate(value => {
    document.documentElement.dataset.komaTheme = value;
    document.documentElement.dataset.cardapioTone = value;
  }, theme);
  await expect(page.locator('#btn-hero-fast-add-201')).toHaveCSS('color',
    theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(7, 28, 23)');
}

async function capture(page: Page, info: TestInfo, name: string) {
  if (!process.env.KOMA_VISUAL_CAPTURE_DIR) return;
  const dir = process.env.KOMA_VISUAL_CAPTURE_DIR;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${info.project.name}-${name}.png`) });
}

async function contrast(button: Locator) {
  return button.evaluate(element => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const backgrounds = style.backgroundImage.match(/rgb\([^)]+\)/g) || [style.backgroundColor];
    const foreground = luminance(style.color);
    return Math.min(...backgrounds.map(color => {
      const background = luminance(color);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    }));
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`ações de compra mantêm contraste AA em ${theme}, inclusive hover e modal`, async ({ page }, info) => {
    await openMenu(page, theme);
    await capture(page, info, `${theme}-home`);
    const hero = page.locator('#btn-hero-fast-add-201');
    const homeContrast = await contrast(hero);
    const dockContrast = await contrast(page.locator('#mobile-nav-cart'));
    await hero.hover();
    await page.waitForTimeout(250); // Wait for the existing color transition to finish.
    const hoverContrast = await contrast(hero);
    await page.locator('#product-card-101').getByRole('button', { name: /ver detalhes/ }).click();
    await capture(page, info, `${theme}-modal`);
    const modalAction = page.locator('#btn-add-to-cart-action');
    const modalContrast = await contrast(modalAction);
    await modalAction.hover();
    await page.waitForTimeout(250);
    const modalHoverContrast = await contrast(modalAction);
    for (const [name, ratio] of Object.entries({ homeContrast, dockContrast, hoverContrast, modalContrast, modalHoverContrast })) {
      expect(ratio, `${theme}: ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

for (const theme of ['dark', 'light'] as const) test(`modal contém foco visível em ${theme}; Escape devolve ao acionador`, async ({ page }) => {
  await openMenu(page, theme);
  const trigger = page.locator('#product-card-101').getByRole('button', { name: /ver detalhes/ });
  await trigger.focus();
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Pizza Margherita Especial' });
  await expect(page.locator('#btn-close-modal')).toBeFocused();
  await expect(page.locator('#btn-close-modal')).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('#btn-close-modal')).toHaveCSS('outline-width', '3px');
  await expect(page.locator('#root')).toHaveJSProperty('inert', true);
  // A selection/re-render must keep focus where the customer is working.
  const option = dialog.getByRole('checkbox', { name: 'Selecionar Catupiry' });
  await option.focus();
  await page.keyboard.press('Space');
  await expect(option).toBeChecked();
  await expect(option).toBeFocused();
  await trigger.evaluate(node => (node as HTMLElement).focus());
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  const first = dialog.getByRole('button', { name: 'Compartilhar produto' });
  const last = dialog.locator('#btn-add-to-cart-action');
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  for (let index = 0; index < 16; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('#root')).toHaveJSProperty('inert', false);
  await expect(page.locator('#qty-101')).toHaveCount(0);
});

test('fechar e Voltar restauram o fundo; reabrir e editar na sacola preservam foco e montagem', async ({ page }) => {
  await openMenu(page);
  const trigger = page.locator('#product-card-101').getByRole('button', { name: /ver detalhes/ });
  await trigger.click();
  await page.locator('#btn-close-modal').click();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await expect(page.locator('#btn-close-modal')).toBeFocused();
  await page.goBack();
  await expect(page.locator('#product-details-modal')).toHaveCount(0);
  await expect(page.locator('#root')).toHaveJSProperty('inert', false);
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await page.getByRole('checkbox', { name: 'Selecionar Catupiry' }).check();
  await page.locator('#btn-add-to-cart-action').click();
  if (!await page.locator('#cart-drawer-container').isVisible()) await page.locator('#btn-cart-header').click();
  const edit = page.getByRole('button', { name: 'Editar montagem de Pizza Margherita Especial', exact: true });
  await edit.click();
  await expect(page.getByRole('checkbox', { name: 'Selecionar Catupiry' })).toBeChecked();
  await expect(page.locator('#btn-close-modal')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#cart-drawer-container')).toBeVisible();
  await expect(edit).toBeFocused();
});
