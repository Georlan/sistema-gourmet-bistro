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
    expect(await page.evaluate(() => (window as any).themeStarts)).toBe(mode === 'native' ? 1 : 0);
    expect(await page.evaluate(() => localStorage.getItem('@koma:theme'))).toBe('light');
    expect(scenario.actions).toHaveLength(0);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-koma-theme', 'light');
  });
}
