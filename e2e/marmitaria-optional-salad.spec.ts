import { expect, test } from '@playwright/test';

test('Marmitaria oferece Sem salada em qualquer tenant quando mínimo é zero, preservando tamanho e perfil', async ({ page }) => {
  const groups = (min: number) => [{
    id: 'salad-group', nome: 'Saladas/Verduras', min_selecoes: min, max_selecoes: 3,
    tipo: min ? 'obrigatorio' : 'opcional', modo_selecao: 'tipos',
    opcoes: [{ id: 'vinagrete', nome: 'Vinagrete', preco_adicional: 0, ativo: true },
            { id: 'alface', nome: 'Alface', preco_adicional: 0, ativo: true }],
  }];
  await page.route('http://127.0.0.1:8000/**', route => route.fulfill({ json:
    route.request().url().includes('/api/cardapio-digital/public') ? {
      restaurante: { id: 24, nome: 'Marmitaria de teste', aceitando_pedidos: true, delivery_ativo: true },
      categorias: [{ id: 'quentinhas', nome: 'Quentinhas' }],
      produtos: [
        { id: 'g', nome: 'Quentinha G', preco: 15, categoria_id: 'quentinhas', marmitaria: true, grupos_modificadores: groups(0) },
        { id: 'p', nome: 'Quentinha P', preco: 10, categoria_id: 'quentinhas', marmitaria: true, grupos_modificadores: groups(1) },
        { id: 'normal', nome: 'Prato comum', preco: 12, categoria_id: 'quentinhas', marmitaria: false, grupos_modificadores: groups(0) },
      ],
    } : {},
  }));
  await page.goto('/cardapio?restaurante_id=24');
  await page.getByRole('button', { name: 'Quentinha G, R$ 15,00, ver detalhes' }).click();
  const modal = page.locator('#product-details-modal');
  const none = modal.getByRole('button', { name: 'Sem salada', exact: true });
  await expect(none).toHaveAttribute('aria-pressed', 'true');
  await modal.getByRole('checkbox', { name: 'Selecionar Vinagrete' }).check();
  await expect(none).toHaveAttribute('aria-pressed', 'false');
  await none.click();
  await expect(none).toHaveAttribute('aria-pressed', 'true');
  await expect(modal.getByRole('checkbox', { name: 'Selecionar Vinagrete' })).not.toBeChecked();
  await expect(modal.locator('#btn-add-to-cart-action')).toContainText('15,00');
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal).toHaveCount(0);

  await page.getByRole('button', { name: 'Quentinha P, R$ 10,00, ver detalhes' }).click();
  await expect(modal.getByRole('button', { name: 'Sem salada', exact: true })).toHaveCount(0);
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal.getByRole('alert')).toContainText('Saladas/Verduras');
  await modal.getByRole('checkbox', { name: 'Selecionar Alface' }).check();
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal).toHaveCount(0);

  await page.getByRole('button', { name: 'Prato comum, R$ 12,00, ver detalhes' }).click();
  await expect(modal.getByRole('button', { name: 'Sem salada', exact: true })).toHaveCount(0);
});
