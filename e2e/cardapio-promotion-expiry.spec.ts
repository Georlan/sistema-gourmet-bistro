import { expect, test } from '@playwright/test';
import { publicMenuPayload } from './fixtures/menu-parity';
for (const variant of ['editorial', 'artistic-total']) {
  test(`${variant}: oferta expira sem recarregar o catálogo`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-23T15:00:00Z') });
    await page.routeWebSocket('**/ws/**', () => {});
    await page.route('http://127.0.0.1:8000/**', route => route.fulfill({json:
      new URL(route.request().url()).pathname.endsWith('/public')
        ? {...publicMenuPayload, promocoes: [{id:'expires',nome:'Oferta temporária',preco:60,
          componentes:[['101'],['201']],fim_em:'2026-10-23T15:01:00Z'}]}
        : {produtos:[]},
    }));
    await page.goto(`/cardapio?restaurante_id=2&vitrine=${variant}`);
    await expect(page.locator('#cardapio-promotions-home')).toBeVisible();
    await page.clock.fastForward(60_001);
    await expect(page.locator('#cardapio-promotions-home')).toHaveCount(0);
    await expect(page.locator('#product-card-101')).toBeVisible();
  });
}
