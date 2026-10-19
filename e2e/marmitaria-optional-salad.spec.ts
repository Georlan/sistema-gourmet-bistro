import { expect, test } from '@playwright/test';

test('Marmitaria oferece Sem salada em qualquer tenant quando mínimo é zero, preservando tamanho e perfil', async ({ page }) => {
  const groups = (min: number, mode: 'tipos' | 'porcoes' = 'tipos') => [{
    id: 'salad-group', nome: 'Saladas/Verduras', min_selecoes: min, max_selecoes: 3,
    tipo: min ? 'obrigatorio' : 'opcional', modo_selecao: mode,
    opcoes: [{ id: 'vinagrete', nome: 'Vinagrete', preco_adicional: 0, ativo: true },
            { id: 'alface', nome: 'Alface', preco_adicional: 0, ativo: true }],
  }];
  await page.route('http://127.0.0.1:8000/**', route => route.fulfill({ json:
    route.request().url().includes('/api/cardapio-digital/public') ? {
      restaurante: { id: 24, nome: 'Marmitaria de teste', aceitando_pedidos: true, delivery_ativo: true },
      categorias: [{ id: 'quentinhas', nome: 'Quentinhas' }],
      produtos: [
        { id: 'g', nome: 'Quentinha G', preco: 15, categoria_id: 'quentinhas', marmitaria: true, grupos_modificadores: groups(0, 'porcoes') },
        { id: 'p', nome: 'Quentinha P', preco: 10, categoria_id: 'quentinhas', marmitaria: true, grupos_modificadores: groups(1) },
        { id: 'm', nome: 'Quentinha M', preco: 12, categoria_id: 'quentinhas', marmitaria: true, grupos_modificadores: groups(0) },
        { id: 'normal', nome: 'Prato comum', preco: 12, categoria_id: 'quentinhas', marmitaria: false, grupos_modificadores: groups(0) },
      ],
    } : {},
  }));
  await page.goto('/cardapio?restaurante_id=24');
  await page.getByRole('button', { name: 'Quentinha G, R$ 15,00, ver detalhes' }).click();
  const modal = page.locator('#product-details-modal');
  const none = modal.getByRole('checkbox', { name: 'Sem salada', exact: true });
  const chooseVinagrete = modal.getByRole('button', { name: 'Escolher Vinagrete' });
  const chooseAlface = modal.getByRole('button', { name: 'Escolher Alface' });
  await expect(none).toBeChecked();
  // As opções ficam neutras, mas a superfície inteira ainda aceita o primeiro toque.
  await expect(chooseVinagrete).toBeEnabled();
  await chooseVinagrete.click();
  await expect(none).not.toBeChecked();
  await expect(modal.getByLabel('1 unidade(s) de Vinagrete')).toBeVisible();
  await modal.getByRole('button', { name: 'Adicionar uma unidade de Vinagrete' }).click();
  await expect(modal.getByLabel('2 unidade(s) de Vinagrete')).toBeVisible();
  await modal.getByRole('button', { name: 'Remover uma unidade de Vinagrete' }).click();
  await modal.getByRole('button', { name: 'Remover uma unidade de Vinagrete' }).click();
  await expect(modal.getByLabel('0 unidade(s) de Vinagrete')).toBeVisible();
  await expect(none).toBeChecked(); // O retorno a zero seleciona automaticamente Sem salada.
  await chooseAlface.click();
  await expect(none).not.toBeChecked();
  await expect(modal.getByLabel('1 unidade(s) de Alface')).toBeVisible();
  await none.check();
  await expect(none).toBeChecked();
  await expect(modal.getByLabel('0 unidade(s) de Alface')).toBeVisible();
  await expect(modal.getByLabel('0 unidade(s) de Vinagrete')).toBeVisible();
  await expect(modal.locator('#btn-add-to-cart-action')).toContainText('15,00');
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal).toHaveCount(0);
  // A sacola abre automaticamente em alguns viewports; feche-a antes do próximo produto.
  if (await page.locator('#cart-overlay').isVisible()) {
    await page.locator('#btn-close-cart').click();
  }

  await page.getByRole('button', { name: 'Quentinha P, R$ 10,00, ver detalhes' }).click();
  await expect(modal.getByRole('checkbox', { name: 'Sem salada', exact: true })).toHaveCount(0);
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal.getByRole('alert')).toContainText('Saladas/Verduras');
  await modal.getByRole('checkbox', { name: 'Selecionar Alface' }).check();
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal).toHaveCount(0);
  if (await page.locator('#cart-overlay').isVisible()) {
    await page.locator('#btn-close-cart').click();
  }

  await page.getByRole('button', { name: 'Quentinha M, R$ 12,00, ver detalhes' }).click();
  await expect(none).toBeChecked();
  await modal.getByRole('checkbox', { name: 'Selecionar Vinagrete' }).check();
  await expect(none).not.toBeChecked();
  await modal.getByRole('checkbox', { name: 'Selecionar Vinagrete' }).uncheck();
  await expect(none).toBeChecked();
  await modal.getByRole('button', { name: 'Fechar detalhes do produto' }).click();

  await page.getByRole('button', { name: 'Prato comum, R$ 12,00, ver detalhes' }).click();
  await expect(none).toHaveCount(0);
});
