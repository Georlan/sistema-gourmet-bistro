import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

const publicMenuPayload = {
  restaurante: {
    id: 2,
    nome: 'Pizzeria Bella Italia',
    slug: 'bella-italia',
    logo_url: '',
    banner_url: '',
    subtitulo: 'Pizza artesanal no forno a lenha',
    sobre_nos: 'Pizzas artesanais preparadas na hora.',
    endereco: 'Av. Principal, 100 - Centro',
    google_maps_url: '',
    status_override: 'Forçado Aberto',
    delivery_ativo: true,
    pagamento_online_ativo: false,
    formas_pagamento_aceitas: ['Dinheiro', 'Cartão de crédito'],
  },
  categorias: [
    { id: 10, nome: 'Pizzas Especiais' },
    { id: 20, nome: 'Bebidas' },
  ],
  produtos: [
    {
      id: 101,
      nome: 'Pizza Margherita Especial',
      descricao: 'Molho San Marzano, muçarela de búfala fresca e manjericão.',
      preco: 48,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 10,
      grupos_modificadores: [
        {
          id: 'borda',
          nome: 'Borda',
          min_selecoes: 1,
          max_selecoes: 1,
          tipo: 'obrigatorio',
          opcoes: [
            {
              id: 'borda-catupiry',
              nome: 'Catupiry',
              preco_adicional: 5,
              ativo: true,
            },
          ],
        },
      ],
    },
    {
      id: 201,
      nome: 'Vinho Tinto Sangiovese (Taça)',
      descricao: 'Taça de vinho tinto seco da Toscana.',
      preco: 24,
      imagem_url: '',
      imagens_galeria: [],
      categoria_id: 20,
      grupos_modificadores: [],
    },
  ],
};

async function mockCardapio(page: Page) {
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (pathname === '/api/cardapio-digital/public') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(publicMenuPayload),
      });
      return;
    }

    if (pathname === '/api/cardapio-digital/populares') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          produtos: [{ produto_id: '101', escolhas: 7 }],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

async function modalSnapshot(page: Page, expectedProduct: string) {
  const modal = page.locator('#product-details-modal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#modal-product-name')).toHaveText(expectedProduct);
  return (await modal.innerText()).replace(/\s+/g, ' ').trim();
}

async function closeProductModal(page: Page) {
  await page.getByRole('button', { name: 'Fechar detalhes do produto' }).click();
  await expect(page.locator('#product-details-modal')).toHaveCount(0);
}

test('Mais escolhidos e Destaques abrem exatamente o mesmo modal canônico do card tradicional', async ({ page }) => {
  await mockCardapio(page);
  await page.goto('/cardapio?restaurante_id=2');

  const traditionalCard = page.locator('#product-card-101');
  const traditionalTrigger = traditionalCard.getByRole('button', {
    name: /Pizza Margherita Especial.*ver detalhes/,
  });

  await traditionalTrigger.click();
  const traditionalSnapshot = await modalSnapshot(page, 'Pizza Margherita Especial');
  await expect(page.locator('#product-details-modal')).toContainText('Borda');
  await expect(page.locator('#product-details-modal')).toContainText('Catupiry');
  await expect(page.locator('#product-details-modal')).toContainText(/R\$\s*5,00/);
  await closeProductModal(page);

  const popular = page.locator('#popular-products-home');
  await expect(popular).toBeVisible();
  await popular.getByRole('listitem', { name: 'Abrir Pizza Margherita Especial' }).click();
  const popularSnapshot = await modalSnapshot(page, 'Pizza Margherita Especial');
  expect(popularSnapshot).toBe(traditionalSnapshot);
  await closeProductModal(page);

  const highlights = page.locator('#cardapio-highlights-home');
  await expect(highlights).toBeVisible();
  await highlights.getByRole('listitem', { name: 'Abrir Pizza Margherita Especial' }).click();
  const highlightSnapshot = await modalSnapshot(page, 'Pizza Margherita Especial');
  expect(highlightSnapshot).toBe(traditionalSnapshot);
});

test('Complete seu pedido abre o mesmo modal canônico do produto recomendado', async ({ page }) => {
  await mockCardapio(page);
  await page.goto('/cardapio?restaurante_id=2');

  const traditionalCard = page.locator('#product-card-201');
  await traditionalCard.getByRole('button', {
    name: /Vinho Tinto Sangiovese \(Taça\).*ver detalhes/,
  }).click();
  const traditionalSnapshot = await modalSnapshot(page, 'Vinho Tinto Sangiovese (Taça)');
  await closeProductModal(page);

  const recommendations = page.locator('#cardapio-recommendations-home');
  await expect(recommendations).toBeVisible();
  await recommendations.getByRole('listitem', {
    name: 'Abrir bebida Vinho Tinto Sangiovese (Taça)',
  }).click();
  const recommendationSnapshot = await modalSnapshot(page, 'Vinho Tinto Sangiovese (Taça)');
  expect(recommendationSnapshot).toBe(traditionalSnapshot);
});
