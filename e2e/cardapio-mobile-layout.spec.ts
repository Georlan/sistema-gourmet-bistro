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
    await page.goto(`/c/qa-${profile}`);
    await expect(page.locator('#popular-products-home')).toContainText(product);
    await expect(page.locator('#brand-banner-hero')).toHaveCount(0);
    await expect(page.locator('#product-card-902')).toContainText('Hambúrguer artesanal');
    const initialReads = { menuReads, rankingReads };
    const nav = page.getByRole('navigation', { name: 'Categorias do cardápio' });
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
