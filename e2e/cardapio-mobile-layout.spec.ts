import { expect, test } from '@playwright/test';

for (const [profile, category, product] of [
  ['generic', 'Pratos', 'Prato da casa'],
  ['marmitaria', 'Marmitas', 'Marmita média'],
  ['pizzaria', 'Pizzas', 'Pizza da casa'],
  ['acai', 'Açaí', 'Açaí 500 ml'],
  ['churrasco', 'Carnes', 'Espeto da casa'],
]) {
  test(`${profile}: vitrine, navegação e busca preservam layout e catálogo`, async ({ page }, testInfo) => {
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
    const popularMedia = page.locator('#popular-products-home .km-product-card__media img').first();
    await expect(popularMedia).toBeVisible();
    expect((await popularMedia.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(80);
    const popularName = page.locator('#popular-products-home .km-product-card__title').first();
    await expect(popularName).toBeVisible();
    await expect(page.locator('#brand-banner-hero')).toHaveCount(0);
    await expect(page.locator('#product-card-902')).toContainText('Hambúrguer artesanal');
    // Solid sticky nav: no catalog content should bleed through while scrolling.
    await expect(page.locator('#km-top')).toHaveCSS('backdrop-filter', 'none');
    const initialReads = { menuReads, rankingReads };
    const nav = page.getByRole('navigation', { name: 'Categorias do cardápio' });
    // Navigation forms one opaque, uncluttered visual system.
    await expect(nav).toHaveCSS('backdrop-filter', 'none');
    await expect(nav).toHaveCSS('background-color', /^rgb\(/);
    const activeChip = nav.locator('.km-cat-tab.is-active');
    await expect(activeChip).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(activeChip).toHaveCSS('border-radius', '0px');
    await expect(activeChip.locator('.km-cat-tab__bar')).toHaveCSS('height', '3px');
    await nav.getByRole('button', { name: category, exact: true }).click();
    await expect(nav).toBeVisible();
    await nav.getByRole('button', { name: 'Hambúrgueres', exact: true }).click();
    await expect(page.locator('#product-card-902')).toBeVisible();
    await nav.getByRole('button', { name: 'Início', exact: true }).click();
    await page.getByRole('searchbox').fill('produto que não existe');
    await expect(page.locator('#catalog-feed')).toContainText(/Nenhum/);
    await page.getByRole('searchbox').fill('');
    await expect(page.locator('#product-card-901')).toContainText(product);
    await expect(page.locator('#product-card-902')).toContainText('Hambúrguer artesanal');
    if (profile === 'generic' && testInfo.project.name === 'mobile-390') {
      const card = page.locator('#product-card-902');
      await card.getByRole('button', { name: 'Adicionar Hambúrguer artesanal à sacola' }).click();
      await expect(card.locator('#qty-902')).toHaveText('1');
      await card.getByRole('button', { name: 'Adicionar mais uma unidade de Hambúrguer artesanal' }).click();
      await expect(card.locator('#qty-902')).toHaveText('2');
      await card.getByRole('button', { name: 'Remover uma unidade de Hambúrguer artesanal' }).click();
      await expect(card.locator('#qty-902')).toHaveText('1');
      await card.getByRole('button', { name: 'Remover uma unidade de Hambúrguer artesanal' }).click();
      await expect(card.locator('#qty-902')).toHaveCount(0);
      await expect(card.getByRole('button', { name: 'Adicionar Hambúrguer artesanal à sacola' })).toBeVisible();
    }
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
  const whatsApp = page.getByRole('link', { name: /WhatsApp/i });
  const instagram = page.getByRole('link', { name: /Instagram/i });
  const shareMobile = page.locator('#btn-share-mobile');

  for (const width of [320, 390, 412]) {
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


test('vitrine padrão do JE mantém contato e compartilhar visíveis no mobile artístico', async ({ page }, testInfo) => {
  // This case already changes viewport through a full width matrix; run it
  // once rather than repeating the same matrix in all nine Playwright projects.
  test.skip(testInfo.project.name !== 'mobile-390', 'Width matrix covered by mobile-390');
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
  await expect(page.locator('#km-top')).toBeVisible();

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
    const socialLinks = page.getByRole('navigation', { name: 'Redes sociais do restaurante' });
    await expect(socialLinks).toBeVisible();
    expect(await socialLinks.evaluate(el => Boolean(el.closest('.km-store-identity')))).toBe(true);
    expect(await share.evaluate(el => Boolean(el.closest('.km-hero-topbar')))).toBe(true);
    for (const control of [whatsapp, instagram, share]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(40);
      expect(box!.height).toBeGreaterThanOrEqual(40);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(whatsapp).toHaveAttribute('href', 'https://wa.me/5588999112233');
  await expect(instagram).toHaveAttribute('href', 'https://instagram.com/loja_contatos');
  await share.click();
  await expect(page.locator('html')).toHaveAttribute('data-koma-share-invoked', 'true');

  await page.setViewportSize({ width: 768, height: 760 });
  await expect(page.getByRole('navigation', { name: 'Redes sociais do restaurante' })).toBeHidden();
  await expect(page.locator('#btn-whatsapp-header')).toBeVisible();
  await expect(page.locator('#btn-instagram-header')).toBeVisible();
  await expect(page.locator('#btn-share-header')).toBeVisible();
});


test('mobile resume never creates another catalog socket while reconnect is pending', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Deterministic lifecycle test runs once');
  let menuReads = 0;
  await page.addInitScript(() => {
    const sockets: any[] = [];
    (window as any).__catalogSockets = sockets;
    const NativeSocket = window.WebSocket;
    // Model a slow handshake, independently of network timing.
    window.WebSocket = new Proxy(NativeSocket, {
      construct(target, args) {
        if (!String(args[0]).includes('/ws/cliente?')) return Reflect.construct(target, args);
        const socket: any = {
          readyState: NativeSocket.CONNECTING,
          onopen: null, onmessage: null, onclose: null, onerror: null,
          open() {
            this.readyState = NativeSocket.OPEN;
            this.onopen?.(new Event('open'));
          },
          close() {
            this.readyState = NativeSocket.CLOSED;
            this.onclose?.(new Event('close'));
          },
          publish() {
            this.onmessage?.({ data: JSON.stringify({ event: 'catalog_updated' }) });
          },
        };
        sockets.push(socket);
        return socket;
      },
    });
  });
  await page.route('http://127.0.0.1:8000/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/cardapio-digital/public') {
      menuReads++;
      return route.fulfill({ json: {
        restaurante: { id: 906, nome: 'Loja Reconexão', slug: 'qa-reconnect',
          aceitando_pedidos: true, status_override: 'Forçado Aberto',
          delivery_ativo: false, formas_pagamento_aceitas: ['Dinheiro'] },
        categorias: [{ id: 1, nome: 'Lanches' }],
        produtos: [{ id: 906, nome: 'Pastel de teste', preco: 8, categoria_id: 1, grupos_modificadores: [] }],
      } });
    }
    if (path === '/api/cardapio-digital/populares') return route.fulfill({ json: { produtos: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/c/qa-reconnect');
  await expect(page.locator('#product-card-906')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__catalogSockets.length)).toBeGreaterThan(0);
  const initial = await page.evaluate(() => {
    const sockets = (window as any).__catalogSockets;
    const current = sockets[sockets.length - 1];
    const before = sockets.length;
    current.open();
    current.close(); // schedules a reconnect in two seconds
    document.dispatchEvent(new Event('visibilitychange')); // starts reconnect immediately
    return before + 1;
  });
  await expect.poll(() => page.evaluate(() => (window as any).__catalogSockets.length)).toBe(initial);
  // Keep the new handshake pending beyond the old retry deadline.
  await page.waitForTimeout(2300);
  expect(await page.evaluate(() => (window as any).__catalogSockets.length)).toBe(initial);
  await page.evaluate(() => {
    const sockets = (window as any).__catalogSockets;
    sockets[sockets.length - 1].open();
  });
  // A real event on the current transport must still trigger a refresh.
  const baseline = menuReads;
  await page.evaluate(() => {
    const sockets = (window as any).__catalogSockets;
    sockets[sockets.length - 1].publish();
  });
  await expect.poll(() => menuReads).toBeGreaterThan(baseline);
});
