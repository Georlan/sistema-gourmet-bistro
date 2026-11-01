import { expect, test } from '@playwright/test';
import { openOperationalScenario } from './fixtures/operational';

test('arrasto lateral mantém controles e evita leituras de estilo em cada movimento', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const scenario = await openOperationalScenario(page);
  const rail = page.getByRole('separator', { name: /Largura do menu/ });
  const box = (await rail.boundingBox())!;
  await page.evaluate(() => {
    const original = window.getComputedStyle;
    (window as any).__sidebarStyleReads = 0;
    window.getComputedStyle = function(element: Element, pseudo?: string | null) {
      if (element === document.documentElement || element.hasAttribute('data-sidebar-wrapper')) (window as any).__sidebarStyleReads++;
      return original.call(window, element, pseudo);
    };
  });
  await page.mouse.move(box.x + box.width / 2, 300);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x - i * 8, 302);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await expect(rail).toHaveAttribute('aria-valuenow', '0');
  const reads = await page.evaluate(() => (window as any).__sidebarStyleReads);
  console.log(`SIDEBAR_STYLE_READS ${reads}`);
  expect(reads).toBeLessThanOrEqual(3);
  expect(scenario.actions).toHaveLength(0);
});
