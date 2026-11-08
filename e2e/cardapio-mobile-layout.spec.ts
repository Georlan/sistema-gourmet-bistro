import { expect, test } from '@playwright/test';

for (const [profile, category, product] of [
  ['generic', 'Pratos', 'Prato da casa'],
  ['marmitaria', 'Marmitas', 'Marmita média'],
  ['pizzaria', 'Pizzas', 'Pizza da casa'],
  ['acai', 'Açaí', 'Açaí 500 ml'],
  ['churrasco', 'Carnes', 'Espeto da casa'],
]) {
  test(`${profile}: vitrine, navegação e busca preservam layout e catálogo`, async ({ page }) => {
    let menuReads = 0;
    let rankingReads = 0;
    await page.route('http://127.0.0.1:8000/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/cardapio-digital/public') {
        menuReads += 1;
        return route.fulfill({ json: {
          restaurante: { id: 902, nome: `Loja ${profile}`, slug: `qa-${profile}`,
            perfil_operacao: profile, aceitando_pedidos: true, status_override: 'Forçado Aberto',
            delivery_ativo: false, formas_pagamento_aceitas: ['Dinheiro'],
            cor_fundo: profile === 'acai' ? '#ffffff' : '#090a0f',
          },
          categorias: [
            { id: 1, nome: category },
            { id: 2, nome: 'Hambúrgueres' },
          ],
          produtos: [
            { id: 901, nome: product, descricao: 'Preparado na hora.', preco: 20, categoria_id: 1,
              marmitaria: profile === 'marmitaria', grupos_modificadores: [] },
            // O tipo operacional não restringe o catálogo: um restaurante pode vender outra linha.
            { id: 902, nome: 'Hambúrguer artesanal', descricao: 'Linha adicional.', preco: 29, categoria_id: 2,
              grupos_modificadores: [] },
          ],
        } });
      }
      if (path === '/api/cardapio-digital/populares') {
        rankingReads += 1;
        return route.fulfill({ json: { produtos: [{ produto_id: '901', escolhas: 5 }] } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto(`/c/qa-${profile}?vitrine=editorial`);
    await expect(page.locator('#popular-products-home')).toContainText(product);
    // Ranked products are image-led, unlike the editorial recommendation list.
    // Both must stay readable without fabricating photos, prices or review scores.
    const popularMedia = page.locator('#popular-products-home .cardapio-popular-card__image').first();
    await expect(popularMedia).toBeVisible();
    expect((await popularMedia.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(100);
    const popularName = page.locator('#popular-products-home .cardapio-popular-card__name').first();
    await expect(popularName).toHaveCSS('text-overflow', 'clip');
    const editorialMedia = page.locator('#cardapio-recommendations-home .cardapio-editorial-card__image').first();
    await expect(editorialMedia).toBeVisible();
    expect((await editorialMedia.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(100);
    await expect(page.locator('#brand-banner-hero')).toHaveCount(0);
    await expect(page.locator('#product-card-902')).toContainText('Hambúrguer artesanal');
    // Solid sticky header: no catalog content should bleed through while scrolling.
    await expect(page.locator('#app-header')).toHaveCSS('backdrop-filter', 'none');
    await expect(page.locator('#app-header')).toHaveCSS('background-color', /^rgb\(/);
    const initialReads = { menuReads, rankingReads };
    const nav = page.getByRole('navigation', { name: 'Categorias do cardápio' });
    // Navigation and header form one opaque, uncluttered visual system.
    await expect(nav).toHaveCSS('backdrop-filter', 'none');
    await expect(nav).toHaveCSS('border-radius', '0px');
    await expect(nav).toHaveCSS('background-color', /^rgb\(/);
    const activeChip = nav.locator('.cardapio-category-chip.is-active');
    await expect(activeChip).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(activeChip).toHaveCSS('border-radius', '0px');
    await expect.poll(() => activeChip.evaluate((element) =>
      getComputedStyle(element, '::after').height,
    )).toBe('3px');
    await nav.getByRole('button', { name: category, exact: true }).click();
    await expect.poll(async () => page.locator('#category-nav-container').evaluate(el =>
      el.getBoundingClientRect().top >= document.querySelector('#app-header')!.getBoundingClientRect().bottom - 1,
    )).toBe(true);
    await nav.getByRole('button', { name: 'Hambúrgueres', exact: true }).click();
    await expect(page.locator('#product-card-902')).toBeVisible();
    await nav.getByRole('button', { name: 'Destaques', exact: true }).click();
    await page.getByRole('searchbox').fill('produto que não existe');
    await expect(page.locator('#catalog-feed')).toContainText(/Nenhum/);
    await page.getByRole('searchbox').fill('');
    await expect(page.locator('#product-card-901')).toContainText(product);
    await expect(page.locator('#product-card-902')).toContainText('Hambúrguer artesanal');
    expect({ menuReads, rankingReads }).toEqual(initialReads);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}


test('contato, Instagram e compartilhar permanecem acessíveis no cabeçalho mobile', async ({ page }) => {
  await page.route('http://127.0.0.1:8000/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/cardapio-digital/public') {
      return route.fulfill({ json: {
        restaurante: {
          id: 905, nome: 'Loja Contatos', slug: 'qa-contatos',
          aceitando_pedidos: true, status_override: 'Forçado Aberto',
          delivery_ativo: false, formas_pagamento_aceitas: ['Dinheiro'],
          socials: JSON.stringify({ whatsapp: '+55 (88) 99911-2233', instagram: '@loja_contatos' }),
        },
        categorias: [{ id: 1, nome: 'Lanches' }],
        produtos: [{ id: 901, nome: 'Pastel da casa', preco: 8, categoria_id: 1, grupos_modificadores: [] }],
      } });
    }
    if (path === '/api/cardapio-digital/populares') return route.fulfill({ json: { produtos: [] } });
    return route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/c/qa-contatos?vitrine=editorial');
  const whatsApp = page.getByRole('link', { name: 'WhatsApp', exact: true });
  const instagram = page.getByRole('link', { name: 'Instagram', exact: true });
  const shareMobile = page.locator('#btn-share-mobile');

  for (const width of [320, 390, 412, 768]) {
    await page.setViewportSize({ width, height: 760 });
    await expect(whatsApp).toBeVisible();
    await expect(instagram).toBeVisible();
    await expect(shareMobile).toBeVisible();
    await expect(page.locator('#btn-share-header')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(whatsApp).toHaveAttribute('href', 'https://wa.me/5588999112233');
  await expect(instagram).toHaveAttribute('href', 'https://instagram.com/loja_contatos');
  await expect(whatsApp).toHaveCount(1);
  await expect(instagram).toHaveCount(1);
  await expect(shareMobile).toHaveAttribute('aria-label', 'Compartilhar cardápio');

  // Wide header retains its existing actions; mobile share isn't duplicated.
  await page.setViewportSize({ width: 1366, height: 850 });
  await expect(whatsApp).toBeVisible();
  await expect(instagram).toBeVisible();
  await expect(shareMobile).toBeHidden();
  await expect(page.locator('#btn-share-header')).toBeVisible();
});


test('vitrine padrão do JE mantém contato e compartilhar visíveis no mobile artístico', async ({ page }) => {
  await page.routeWebSocket('**/ws/**', () => {});
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => { document.documentElement.dataset.komaShareInvoked = 'true'; },
    });
  });
  await page.route('http://127.0.0.1:8000/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/cardapio-digital/public') {
      return route.fulfill({ json: {
        restaurante: {
          id: 905, nome: 'JE LANCHES QA', slug: 'qa-je-mobile',
          aceitando_pedidos: true, status_override: 'Forçado Aberto',
          delivery_ativo: false, formas_pagamento_aceitas: ['Dinheiro'],
          socials: { whatsapp: '5588999112233', instagram: 'loja_contatos' },
        },
        categorias: [{ id: 1, nome: 'Pastéis' }],
        produtos: [{ id: 901, nome: 'Pastel Médio de Carne Moída', preco: 7,
          categoria_id: 1, grupos_modificadores: [] }],
      } });
    }
    if (path === '/api/cardapio-digital/populares') return route.fulfill({ json: { produtos: [] } });
    return route.fulfill({ json: {} });
  });

  // No ?vitrine=editorial override: match the real /c/je-lanches default.
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/c/qa-je-mobile');
  await expect(page.locator('#koma-artistic-canopy')).toBeVisible();

  const whatsapp = page.locator('#btn-whatsapp-mobile');
  const instagram = page.locator('#btn-instagram-mobile');
  const share = page.locator('#btn-share-mobile');
  for (const width of [320, 390, 412, 600, 767]) {
    await page.setViewportSize({ width, height: 760 });
    await expect(whatsapp).toBeVisible();
    await expect(instagram).toBeVisible();
    await expect(share).toBeVisible();
    await expect(page.locator('#btn-whatsapp-header')).toBeHidden();
    await expect(page.locator('#btn-share-header')).toBeHidden();
    const row = page.getByRole('navigation', { name: 'Contato e compartilhamento' });
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(whatsapp).toHaveAttribute('href', 'https://wa.me/5588999112233');
  await expect(instagram).toHaveAttribute('href', 'https://instagram.com/loja_contatos');
  await share.click();
  await expect(page.locator('html')).toHaveAttribute('data-koma-share-invoked', 'true');

  await page.setViewportSize({ width: 768, height: 760 });
  await expect(page.getByRole('navigation', { name: 'Contato e compartilhamento' })).toBeHidden();
  await expect(page.locator('#btn-whatsapp-header')).toBeVisible();
  await expect(page.locator('#btn-instagram-header')).toBeVisible();
  await expect(page.locator('#btn-share-header')).toBeVisible();
});
