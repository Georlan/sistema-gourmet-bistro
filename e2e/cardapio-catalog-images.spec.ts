import { expect, test } from '@playwright/test';

test('vitrines reutilizam foto cadastrada e recuperam imagem quebrada', async ({ page }) => {
  const photo = 'https://images.example.com/canonical.svg';
  await page.route('https://images.example.com/**', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="green"/></svg>',
  }));
  await page.route('http://127.0.0.1:8000/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/cardapio-digital/public') return route.fulfill({ json: {
      restaurante: { id: 6, nome: 'Restaurante de teste', status_override: 'Forçado Aberto',
        aceitando_pedidos: true, entrega_ativo: true, delivery_ativo: true, formas_pagamento_aceitas: ['Dinheiro'] },
      categorias: [{ id: 'special', nome: 'Especiais' }],
      produtos: [{ id: 'g', nome: 'Prato da casa', preco: 14, categoria_id: 'special', imagem_url: photo },
        { id: 'm', nome: 'Prato sem foto', preco: 10, categoria_id: 'special' }],
      promocoes: [{ id: 'offer', nome: 'Dois pratos', preco: 22, componentes: [['g'], ['m']] }],
    } });
    if (path === '/api/cardapio-digital/populares') return route.fulfill({ json: { produtos: [{ produto_id: 'g' }] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/cardapio?restaurante_id=6&vitrine=editorial');
  for (const selector of ['#cardapio-recommendations-home', '#cardapio-highlights-home',
    '#cardapio-promotions-home', '#popular-products-home', '#product-card-g']) {
    const img = page.locator(selector).locator('img').first();
    await img.scrollIntoViewIfNeeded();
    await expect(img).toHaveAttribute('src', photo);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  const photoCard = page.locator('#product-card-g img');
  await photoCard.evaluate((img: HTMLImageElement) => { img.src = 'http://127.0.0.1:8000/missing-photo'; });
  await expect(photoCard).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(page.locator('#product-card-m img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
});
