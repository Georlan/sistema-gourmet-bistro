import { expect, test } from '@playwright/test';

test('/contratar/pro avança da etapa 1 para 2 sem disparar validação HTML5 prematura', async ({ page }) => {
  let signupPosts = 0;
  await page.route('**/api/contracts/config/billing', route => route.fulfill({
    json: { credit_card: true, pix: true, pixMode: 'manual', publicKey: '' },
  }));
  await page.route('**/api/signups', async route => {
    signupPosts += 1;
    await route.fulfill({ status: 201, json: { id: 's-1', token: 'tok-1' } });
  });

  await page.goto('/contratar/pro');
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page.getByText('02 · SEU RESTAURANTE')).toBeVisible();
  const restaurantInput = page.getByLabel('Nome do restaurante');
  await expect(restaurantInput).toBeVisible();
  // Sem submissão acidental no clique de Continuar e sem caixa de erro exibida
  expect(signupPosts).toBe(0);
  await expect(page.locator('#koma-signup-form:invalid')).toHaveCount(1);
  // Nenhuma mensagem de erro de submit da etapa 2 deve aparecer antes de clicar em Salvar e continuar
  await expect(page.locator('.koma-sub-error')).toHaveCount(0);
});

test('cardápio digital calcula pizza meio a meio por maior valor e por média proporcional sem somar sabores', async ({ page }) => {
  await page.route('**/api/cardapio-digital/public**', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        restaurante: {
          id: 55,
          nome: 'Pizzaria Laboratório KÔMA',
          slug: 'pizzaria-lab',
          cor_primaria: '#10b981',
          cor_fundo: '#090a0f',
          status_override: 'Forçado Aberto',
          aceitando_pedidos: true,
          origem_disponibilidade: 'cash_open',
          formas_pagamento_aceitas: ['Pix', 'Dinheiro', 'Cartão de crédito'],
          horarios_funcionamento: [{ days: 'Segunda a Domingo', hours: '00:00 - 23:59' }],
          taxa_entrega_padrao: 5,
          tipo_taxa_entrega: 'fixa',
        },
        categorias: [
          { id: 'cat-pizzas', nome: 'Pizzas', ordem_exibicao: 1 },
        ],
        produtos: [
          {
            id: 'pizza-grande-max',
            nome: 'Pizza Grande (Maior Sabor)',
            descricao: 'Escolha até 2 sabores',
            preco: 10,
            categoria_id: 'cat-pizzas',
            imagem_url: '',
            imagens_galeria: [],
            grupos_modificadores: [
              {
                id: 'g-sabores-max',
                nome: 'Sabores',
                min_selecoes: 1,
                max_selecoes: 2,
                tipo: 'meio_a_meio',
                regra_preco_meio_a_meio: 'maior_preco',
                opcoes: [
                  { id: 's-cal', grupo_id: 'g-sabores-max', nome: 'Calabresa', preco_adicional: 42, ativo: true },
                  { id: 's-cam', grupo_id: 'g-sabores-max', nome: 'Camarão', preco_adicional: 68, ativo: true },
                ],
              },
              {
                id: 'g-borda',
                nome: 'Borda Recheada',
                min_selecoes: 0,
                max_selecoes: 1,
                tipo: 'opcional',
                opcoes: [
                  { id: 'b-cat', grupo_id: 'g-borda', nome: 'Catupiry', preco_adicional: 12, ativo: true },
                ],
              },
            ],
          },
          {
            id: 'pizza-grande-media',
            nome: 'Pizza Grande (Média)',
            descricao: 'Média proporcional dos sabores',
            preco: 10,
            categoria_id: 'cat-pizzas',
            imagem_url: '',
            imagens_galeria: [],
            grupos_modificadores: [
              {
                id: 'g-sabores-media',
                nome: 'Sabores',
                min_selecoes: 1,
                max_selecoes: 2,
                tipo: 'meio_a_meio',
                regra_preco_meio_a_meio: 'media',
                opcoes: [
                  { id: 's-cal-m', grupo_id: 'g-sabores-media', nome: 'Calabresa', preco_adicional: 42, ativo: true },
                  { id: 's-cam-m', grupo_id: 'g-sabores-media', nome: 'Camarão', preco_adicional: 68, ativo: true },
                ],
              },
            ],
          },
        ],
        produtos_promocionais: [],
        promocoes: [],
      }),
    });
  });
  await page.route('**/cardapio-digital/populares**', route => route.fulfill({ json: [] }));

  await page.goto('/c/pizzaria-lab');
  const maxCard = page.locator('#product-card-pizza-grande-max');
  const mediaCard = page.locator('#product-card-pizza-grande-media');
  await expect(maxCard).toBeVisible({ timeout: 15_000 });

  // 1. Maior valor: 10 + max(42, 68) + 12 = R$ 90,00
  await maxCard.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Maior valor entre os sabores/i)).toBeVisible();

  await dialog.getByLabel('Selecionar Calabresa').check({ force: true });
  await expect(dialog.getByText('Inteira')).toBeVisible();
  await dialog.getByLabel('Selecionar Camarão').check({ force: true });
  await expect(dialog.getByText('1/2')).toHaveCount(2);
  await dialog.getByLabel('Selecionar Catupiry').check({ force: true });

  await expect(dialog.getByRole('button', { name: /Adicionar.*90,00/i })).toBeVisible();
  await dialog.getByRole('button', { name: /Adicionar/i }).click();

  // No desktop a sacola abre automaticamente ao adicionar; fechamos para seguir no catálogo
  const cartOverlay = page.locator('#cart-overlay');
  if (await cartOverlay.isVisible()) {
    await expect(cartOverlay.getByText(/90,00/).first()).toBeVisible();
    await cartOverlay.getByRole('button', { name: /Fechar/i }).click();
    await expect(cartOverlay).toBeHidden();
  }

  // 2. Média proporcional: 10 + (42 + 68) / 2 = R$ 65,00
  await mediaCard.click();
  const dialogMedia = page.getByRole('dialog');
  await expect(dialogMedia.getByText('Escolha 1 a 2 · Média proporcional dos sabores')).toBeVisible();
  await dialogMedia.getByLabel('Selecionar Calabresa').check({ force: true });
  await dialogMedia.getByLabel('Selecionar Camarão').check({ force: true });
  await expect(dialogMedia.getByRole('button', { name: /Adicionar.*65,00/i })).toBeVisible();
  await dialogMedia.getByRole('button', { name: /Adicionar/i }).click();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
