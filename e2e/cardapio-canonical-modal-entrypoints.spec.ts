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
    aceitando_pedidos: true,
    delivery_ativo: true,
    pagamento_online_ativo: false,
    formas_pagamento_aceitas: ['Dinheiro', 'Cartão de crédito'],
  },
  categorias: [
    { id: 10, nome: 'Destaques' },
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

for (const mode of ['tipos', 'porcoes'] as const) {
test(`marmita grande respeita contagem por ${mode} e limita a duas escolhas`, async ({ page }) => {
  await mockCardapio(page);
  await page.route('**/api/cardapio-digital/public?**', route => route.fulfill({ json: {
    ...publicMenuPayload,
    produtos: [{ ...publicMenuPayload.produtos[0], nome: 'Marmita grande', grupos_modificadores: [{
      id: 'proteins', nome: 'Proteínas', min_selecoes: 2, max_selecoes: 2, tipo: 'obrigatorio', modo_selecao: mode,
      opcoes: ['Frango', 'Carne', 'Peixe'].map((nome, index) => ({ id: `protein-${index}`, nome, ativo: true, preco_adicional: 0 })),
    }] }],
  } }));
  await page.goto('/cardapio?restaurante_id=2');
  await page.locator('#product-card-101').getByRole('button', { name: /Marmita grande.*ver detalhes/ }).click();
  const modal = page.locator('#product-details-modal');
  await modal.getByRole(mode === 'tipos' ? 'checkbox' : 'button', { name: mode === 'tipos' ? 'Selecionar Frango' : 'Adicionar uma unidade de Frango', exact: true }).click();
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal.getByText('Confira as escolhas em Proteínas antes de adicionar.', { exact: true })).toBeVisible();
  if (mode === 'tipos') await expect(modal.getByRole('checkbox', { name: 'Selecionar Frango', exact: true })).toBeChecked();
  await modal.getByRole(mode === 'tipos' ? 'checkbox' : 'button', { name: mode === 'tipos' ? 'Selecionar Carne' : 'Adicionar uma unidade de Frango', exact: true }).click();
  await expect(modal.getByRole(mode === 'tipos' ? 'checkbox' : 'button', { name: mode === 'tipos' ? 'Selecionar Peixe' : 'Adicionar uma unidade de Peixe', exact: true })).toBeDisabled();
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal).toHaveCount(0);
});

}


test('editar montagem preserva quantidade e contato; cancelar não altera a sacola', async ({ page }) => {
  await mockCardapio(page);
  await page.route('**/api/cardapio-digital/public?**', route => route.fulfill({ json: {
    ...publicMenuPayload,
    produtos: [{ ...publicMenuPayload.produtos[0], nome: 'Quentinha G', marmitaria: true,
      grupos_modificadores: [{ id: 'proteins', nome: 'Proteínas', min_selecoes: 0, max_selecoes: 2,
        modo_selecao: 'porcoes', tipo: 'opcional', opcoes: [
          { id: 'chicken', nome: 'Frango', ativo: true, preco_adicional: 0 },
          { id: 'egg', nome: 'Ovo', ativo: true, preco_adicional: 2 },
        ] }],
    }],
  } }));
  await page.goto('/cardapio?restaurante_id=2');
  await page.locator('#product-card-101').getByRole('button', { name: /ver detalhes/ }).click();
  const modal = page.locator('#product-details-modal');
  await modal.getByRole('button', { name: 'Adicionar uma unidade de Frango', exact: true }).click();
  await modal.locator('#btn-qty-plus').click();
  await modal.locator('#btn-qty-plus').click();
  await expect(modal.locator('#btn-add-to-cart-action')).toHaveAccessibleName(/Adicionar 3 × Quentinha G/);
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal).toHaveCount(0);
  if (!await page.locator('#cart-drawer-container').isVisible()) await page.locator('#btn-cart-header').click();
  const cart = page.locator('#cart-drawer-container');
  await cart.getByRole('button', { name: 'Contato', exact: true }).click();
  await cart.locator('#input-guest-name').fill('Cliente local');
  await cart.getByRole('button', { name: 'Itens', exact: true }).click();
  await cart.getByRole('button', { name: 'Editar montagem de Quentinha G', exact: true }).click();
  await expect(modal.locator('#btn-add-to-cart-action')).toHaveAccessibleName(/Salvar 3 × Quentinha G/);
  await modal.getByRole('button', { name: 'Adicionar uma unidade de Ovo', exact: true }).click();
  await modal.getByRole('button', { name: 'Fechar detalhes do produto' }).click();
  await expect(cart.locator('#cart-items')).not.toContainText('Ovo');
  await expect(cart.locator('#input-guest-name')).toHaveValue('Cliente local');
  await cart.getByRole('button', { name: 'Editar montagem de Quentinha G', exact: true }).click();
  await modal.getByRole('button', { name: 'Adicionar uma unidade de Ovo', exact: true }).click();
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(cart.locator('#cart-items')).toContainText('3× Quentinha G');
  await expect(cart.locator('#cart-items')).toContainText('PROTEÍNAS: Frango, Ovo');
  await expect(cart.locator('#cart-items')).toContainText(/R\$\s*150,00/);
  await expect(cart.locator('#input-guest-name')).toHaveValue('Cliente local');
  await expect(cart.locator('[id^="cart-item-"]')).toHaveCount(1);
  await cart.locator('#btn-confirm-order').click();
  await expect(cart.locator('#cart-receive-methods-content')).toBeVisible();
  await expect(cart.locator('#cart-items-content')).toBeHidden();
  await cart.locator('#btn-confirm-order').click();
  await expect(cart.locator('#cart-payment-methods-content')).toBeVisible();
  await cart.locator('#btn-confirm-order').click();
  await expect(cart.locator('#cart-identification-content')).toBeVisible();
  await cart.getByRole('button', { name: 'Itens', exact: true }).click();
  await expect(cart.locator('#input-guest-name')).toHaveValue('Cliente local');
  await cart.locator('#cart-items').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
});
