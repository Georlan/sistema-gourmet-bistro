import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';

async function mockClosedStore(page: Page) {
  await page.route(`${API_ORIGIN}/**`, async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (pathname === '/api/cardapio-digital/public') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          restaurante: {
            id: 2,
            nome: 'Loja Fechada Diagnostico',
            slug: 'loja-fechada-diagnostico',
            logo_url: '',
            banner_url: '',
            subtitulo: 'Fechado agora',
            sobre_nos: '',
            endereco: 'Av. Principal, 100',
            google_maps_url: '',
            status_override: 'Forçado Fechado',
            socials: {},
            horarios_funcionamento: [],
            formas_pagamento_aceitas: ['Pix'],
            cor_primaria: '#00b894',
            cor_fundo: '#090a0f',
          },
          categorias: [{ id: 10, nome: 'Pizzas' }],
          produtos: [{
            id: 101,
            nome: 'Pizza Fechada',
            descricao: 'Produto ainda navegável com loja fechada.',
            preco: 48,
            imagem_url: '',
            imagens_galeria: [],
            categoria_id: 10,
          }],
        }),
      });
      return;
    }

    if (pathname === '/cardapio/clientes/otp/solicitar') {
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    if (pathname === '/cardapio/pedidos' && request.method() === 'POST') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'O restaurante está fechado para novos pedidos online no momento.' }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
}

test('diagnostico: loja fechada continua permitindo montar sacola e iniciar checkout', async ({ page }) => {
  await mockClosedStore(page);
  await page.goto('/cardapio?restaurante_id=2');

  await expect(page.getByText('Estabelecimento Fechado', { exact: true })).toBeVisible();
  const addButton = page.locator('#btn-fast-add-101');
  await expect(addButton).toBeVisible();
  await expect(addButton).toBeEnabled();
  await addButton.click();

  const viewportWidth = page.viewportSize()?.width ?? 0;
  if (viewportWidth >= 1024) {
    await expect(page.locator('#desktop-shopping-cart-sidebar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar e Enviar Pedido', exact: true })).toBeEnabled();
  } else {
    const bag = page.locator('#floating-cart-trigger');
    await expect(bag).toBeVisible();
    await expect(bag).toBeEnabled();
    await bag.click();
    await expect(page.getByRole('button', { name: /Continuar com celular/ })).toBeEnabled();
  }
});
