import { expect, test } from '@playwright/test';

for (const marmitaria of [true, false]) {
  test(`free garnishes are scoped to Marmitaria: ${marmitaria}`, async ({ page }) => {
    await page.route('http://127.0.0.1:8000/**', route => route.fulfill({ json:
      route.request().url().includes('/api/cardapio-digital/public') ? {
        restaurante: { id: 6, nome: 'Restaurante de teste', aceitando_pedidos: true, delivery_ativo: true },
        categorias: [{ id: 'food', nome: 'Produtos' }],
        produtos: [{ id: 'g', nome: 'Produto de teste', preco: 10, categoria_id: 'food', marmitaria,
          grupos_modificadores: ['Guarnições', 'Adicionais pagos'].map((nome, index) => ({
            id: `group-${index}`, nome, min_selecoes: 0, max_selecoes: 20, modo_selecao: 'porcoes', tipo: 'opcional',
            opcoes: [{ id: `option-${index}`, nome: index ? 'Ovo adicional' : 'Arroz', preco_adicional: index ? 2 : 0, ativo: true }],
          })),
        }],
      } : {},
    }));
    await page.goto('/cardapio?restaurante_id=6');
    await page.getByRole('button', { name: 'Produto de teste, R$ 10,00, ver detalhes' }).click();
    const sections = page.locator('#product-details-modal section');
    await expect(sections.nth(0)).toContainText(marmitaria ? 'Escolha à vontade' : 'Escolha até 20 porções');
    await expect(sections.nth(1)).toContainText('Escolha até 20 porções');
    await expect(sections.nth(1)).not.toContainText('Livre');
    const extras = sections.nth(1).getByRole('button', { name: /Adicionais pagos/ });
    await expect(extras).toHaveAttribute('aria-expanded', 'false');
    await extras.click();
    await page.getByRole('button', { name: 'Adicionar uma unidade de Ovo adicional', exact: true }).click();
    await page.getByRole('button', { name: 'Adicionar uma unidade de Ovo adicional', exact: true }).click();
    await expect(page.locator('#btn-add-to-cart-action')).toContainText('14,00');
    await expect(sections.nth(1)).toContainText('2/20');
    await extras.click();
    await expect(extras).toContainText('2 adicionais · + R$ 4,00 por item');
    await expect(page.getByRole('button', { name: 'Adicionar uma unidade de Ovo adicional', exact: true })).toBeHidden();
    await extras.click();
    await expect(page.getByLabel('2 unidade(s) de Ovo adicional', { exact: true })).toBeVisible();
  });
}
