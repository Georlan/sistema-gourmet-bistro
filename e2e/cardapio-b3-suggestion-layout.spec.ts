import { expect, test } from '@playwright/test';
import { publicMenuPayload } from './fixtures/menu-parity';

test('B3: sugestão de família conserva nome e valor legíveis e montagem com alvos úteis em 320–430px', async ({ page }) => {
  const payload: any = structuredClone(publicMenuPayload);
  payload.categorias.push({ id: 30, nome: 'Batatas Fritas' });
  payload.produtos.push(
    { id: 'batata-p', nome: 'Batata Frita Tradicional Pequena (200 g)', preco: 12,
      categoria_id: 30, imagem_url: '', familia_id: 'batata-tradicional',
      familia_nome: 'Batata Frita Tradicional com Molho Especial da Casa',
      familia_eixo: 'tamanho', variacao_rotulo: 'Pequena · 200 g', grupos_modificadores: [] },
    { id: 'batata-g', nome: 'Batata Frita Tradicional Grande (400 g)', preco: 18,
      categoria_id: 30, imagem_url: '', familia_id: 'batata-tradicional',
      familia_nome: 'Batata Frita Tradicional com Molho Especial da Casa',
      familia_eixo: 'tamanho', variacao_rotulo: 'Grande · 400 g', grupos_modificadores: [] },
  );
  await page.routeWebSocket('**/ws/**', () => {});
  await page.route('http://127.0.0.1:8000/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/public')) return route.fulfill({ json: payload });
    if (path.endsWith('/populares')) return route.fulfill({ json: { produtos: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
  const card = page.locator('#pairing-card-family-batata-tradicional');
  await expect(card).toBeVisible();
  await expect(card.locator('.koma-art-pebble-title')).toContainText('Batata Frita Tradicional com Molho Especial da Casa');
  await expect(card.locator('.koma-art-pebble-price-prefix')).toHaveText('A partir de');
  await expect(card.locator('.koma-art-pebble-price-amount')).toHaveText('R$ 12,00');

  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 740 });
    const metrics = await card.evaluate(el => {
      const title = el.querySelector('.koma-art-pebble-title') as HTMLElement;
      const amount = el.querySelector('.koma-art-pebble-price-amount') as HTMLElement;
      const footer = el.querySelector('.koma-art-pebble-footer') as HTMLElement;
      const titleRange = document.createRange();
      titleRange.selectNodeContents(title);
      const textBounds = titleRange.getBoundingClientRect();
      const titleBounds = title.getBoundingClientRect();
      return {
        scrollOverflow: document.documentElement.scrollWidth > innerWidth,
        cardOverflow: el.scrollWidth > el.clientWidth + 1,
        footerOverflow: footer.scrollWidth > footer.clientWidth + 1,
        amountOverflow: amount.scrollWidth > amount.clientWidth + 1,
        fullTitleVisible: textBounds.bottom <= titleBounds.bottom + 2,
      };
    });
    expect(metrics).toEqual({
      scrollOverflow: false, cardOverflow: false, footerOverflow: false,
      amountOverflow: false, fullTitleVisible: true,
    });
  }

  await card.click();
  await expect(page.locator('#product-details-modal')).toBeVisible();
  await page.locator('#variant-btn-batata-p').click();
  await page.locator('#btn-add-to-cart-action').click();
  await expect(page.locator('#product-details-modal')).toBeHidden();
  await expect(card.locator('#btn-pairing-edit-family-batata-tradicional')).toBeVisible();

  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 740 });
    const edit = card.locator('#btn-pairing-edit-family-batata-tradicional');
    const dimensions = await edit.boundingBox();
    expect(dimensions).not.toBeNull();
    expect(dimensions!.height).toBeGreaterThanOrEqual(44);
    expect(await card.locator('.koma-art-pebble-footer').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  await card.locator('#btn-pairing-edit-family-batata-tradicional').click();
  await expect(page.locator('#product-details-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#product-details-modal')).toBeHidden();
});

test('B3: navegação por etapas respeita movimento reduzido sem perder modalidade ou foco', async ({ page }) => {
  const payload: any = structuredClone(publicMenuPayload);
  payload.produtos.push({ id: 301, nome: 'Pizza de batata', preco: 40, categoria_id: 10, grupos_modificadores: [] });
  await page.routeWebSocket('**/ws/**', () => {});
  await page.route('http://127.0.0.1:8000/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/public')) return route.fulfill({ json: payload });
    if (path.endsWith('/populares')) return route.fulfill({ json: { produtos: [] } });
    return route.fulfill({ json: {} });
  });
  await page.setViewportSize({ width: 390, height: 740 });
  await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
  await page.locator('#btn-fast-add-301').click();
  await page.locator('#btn-cart-header').click();
  await expect(page.locator('#cart-drawer-container')).toBeVisible();
  await page.evaluate(() => {
    const original = Element.prototype.scrollIntoView;
    (window as Window & { b3ScrollModes?: string[] }).b3ScrollModes = [];
    Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
      if (this.id === 'cart-receive-methods' && typeof options === 'object') {
        (window as Window & { b3ScrollModes?: string[] }).b3ScrollModes?.push(options.behavior || 'auto');
      }
      return original.call(this, options);
    };
  });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#btn-confirm-order').click();
  await expect(page.locator('#cart-receive-methods-content')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { b3ScrollModes?: string[] }).b3ScrollModes?.at(-1))).toBe('smooth');

  await page.getByRole('button', { name: 'Itens', exact: true }).click();
  await expect(page.locator('#cart-items-content')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#btn-confirm-order').click();
  await expect(page.locator('#cart-receive-methods-content')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { b3ScrollModes?: string[] }).b3ScrollModes?.at(-1))).toBe('auto');
});
