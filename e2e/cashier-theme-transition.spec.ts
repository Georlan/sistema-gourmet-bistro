import { expect, test } from '@playwright/test';
import { openOperationalScenario } from './fixtures/operational';

for (const mode of ['native', 'reduced', 'unsupported', 'long-list']) {
  test(`cashier theme persists and preserves operations with ${mode} transition`, async ({ page }) => {
    if (mode === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(mode => {
      if (!localStorage.getItem('@koma:theme')) localStorage.setItem('@koma:theme', 'dark');
      Object.defineProperty(navigator, 'deviceMemory', { value: 8, configurable: true });
      Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true });
      const original = document.startViewTransition?.bind(document);
      (window as any).themeStarts = 0;
      if (mode === 'unsupported') Object.defineProperty(document, 'startViewTransition', { value: undefined, configurable: true });
      else if (original) document.startViewTransition = (...args: any[]) => {
        (window as any).themeStarts++;
        return (original as any)(...args);
      };
    }, mode);
    const scenario = await openOperationalScenario(page);
    if (mode === 'long-list') await page.evaluate(() => {
      for (let i = 0; i < 31; i++) { const node = document.createElement('div'); node.className = 'orders-card'; document.body.append(node); }
    });
    const themeButton = page.getByRole('button', { name: 'Usar tema claro', exact: true });
    await themeButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-koma-theme', 'light');
    await expect(page.locator('html')).not.toHaveAttribute('data-courier-theme-wipe');
    await expect(page.getByRole('button', { name: 'Usar tema escuro', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => (window as any).themeStarts)).toBe(mode === 'native' || mode === 'long-list' ? 1 : 0);
    expect(await page.evaluate(() => localStorage.getItem('@koma:theme'))).toBe('light');
    expect(scenario.actions).toHaveLength(0);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-koma-theme', 'light');
  });
}

test('mobile reveal avoids card transitions while keeping the full-screen animation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openOperationalScenario(page);
  await expect(page.locator('.cashier-shell .orders-card__action').first()).toBeAttached();
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const card = document.querySelector<HTMLElement>('.cashier-shell .orders-card__action');
    if (!card) throw new Error('Order action missing');
    const before = getComputedStyle(card).transitionDuration;
    root.setAttribute('data-courier-theme-wipe', 'test');
    const during = getComputedStyle(card).transitionDuration;
    const reveal = getComputedStyle(root, '::view-transition-new(root)').animationName;
    root.removeAttribute('data-courier-theme-wipe');
    return { before, during, reveal, after: getComputedStyle(card).transitionDuration };
  });
  expect(result.before).not.toBe('0s');
  expect(result.during).toBe('0s');
  expect(result.after).toBe(result.before);
  expect(result.reveal).toBe('courier-theme-fill');
});
