import { expect, test } from '@playwright/test';
import { cashierConfig, mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('cadastro em massa, criação inline de categoria, complementos em lote, duplicação e importação rápida funcionam no navegador', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'produtos');
  });

  const categories = [
    { id: 'cat-lanches', nome: 'Lanches', destino_impressao: 'COZINHA' },
  ];
  const products = [
    { id: 'p-1', nome: 'X-Burguer', categoria_id: 'cat-lanches', categoria: 'Lanches', preco: 20, ativo: true, destaque: false },
    { id: 'p-2', nome: 'X-Bacon', categoria_id: 'cat-lanches', categoria: 'Lanches', preco: 26, ativo: true, destaque: false },
  ];
  const groups = [
    { id: 'grp-1', nome: 'Adicionais', min_selecoes: 0, max_selecoes: 3, opcoes: [{ id: 'opt-1', nome: 'Bacon', preco_adicional: 4, ativo: true }], produto_ids: [], categoria_ids: [] },
  ];

  let batchPayload: Record<string, unknown> | null = null;
  let importPayload: Record<string, unknown> | null = null;
  let duplicatedId = '';

  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'generic' } }));
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: groups }));
  await page.route('**/produtos/categorias', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: categories });
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      const created = { id: body.id, nome: body.nome, destino_impressao: body.destino_impressao || 'COZINHA' };
      categories.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    return route.continue();
  });

  await page.route('**/produtos/catalogo', route => route.fulfill({
    json: { categorias: categories, produtos: products, cardapios: [], cardapios_ativos_ids: [] },
  }));
  await page.route('**/produtos/', route => route.fulfill({ json: products }));
  await page.route('**/produtos/edicao-lote', async route => {
    batchPayload = route.request().postDataJSON();
    if (batchPayload?.categoria_id) {
      for (const p of products) {
        if ((batchPayload.produto_ids as string[]).includes(p.id)) {
          p.categoria_id = String(batchPayload.categoria_id);
        }
      }
    }
    await route.fulfill({
      json: {
        atualizados: (batchPayload?.produto_ids as string[])?.length || 0,
        grupos_adicionados: (batchPayload?.adicionar_grupos_modificadores_ids as string[])?.length ? 2 : 0,
        grupos_removidos: 0,
      },
    });
  });

  await page.route('**/produtos/*/duplicar', async route => {
    duplicatedId = 'p-1-copy';
    const copy = { ...products[0], id: duplicatedId, nome: 'X-Burguer (Cópia)' };
    products.push(copy);
    await route.fulfill({ status: 201, json: copy });
  });

  await page.route('**/produtos/importar', async route => {
    importPayload = route.request().postDataJSON();
    const imported = ((importPayload?.products as Array<Record<string, unknown>>) || []).map(item => ({
      ...item,
      ativo: true,
    }));
    for (const item of imported) {
      products.push(item as any);
    }
    await route.fulfill({ status: 200, json: imported });
  });

  await page.goto('/?view=caixa');
  await expect(page.getByText('X-Burguer')).toBeVisible({ timeout: 15_000 });

  // 1. Duplicação rápida 1-clique
  await page.getByRole('button', { name: 'Duplicar X-Burguer', exact: true }).click();
  await expect.poll(() => duplicatedId).toBe('p-1-copy');
  await expect(page.getByText('X-Burguer (Cópia)')).toBeVisible();

  // 2. Seleção múltipla + grupo de complementos em lote + criação inline de categoria
  await page.getByRole('button', { name: 'Selecionar produtos', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Selecionar X-Burguer', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Selecionar X-Bacon', exact: true }).check();

  await page.getByLabel('Grupo de complementos para os selecionados').selectOption('grp-1');
  await page.getByRole('button', { name: '+ Vincular grupo', exact: true }).click();
  await expect.poll(() => (batchPayload?.adicionar_grupos_modificadores_ids as string[] | undefined)?.[0]).toBe('grp-1');

  // Reabre seleção para criar categoria inline e mover os selecionados
  await page.getByRole('button', { name: 'Selecionar produtos', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Selecionar X-Burguer', exact: true }).check();
  await page.getByRole('button', { name: '+ Nova', exact: true }).click();
  await page.getByLabel('Nome da nova categoria em lote').fill('Especiais');
  await page.getByRole('button', { name: 'Criar e mover selecionados', exact: true }).click();
  await expect.poll(() => batchPayload?.categoria_id).toBe('cat-especiais');

  // 3. Importação rápida em massa (WhatsApp -> Prévia editável -> Publicar merge)
  await page.getByRole('button', { name: 'Importar em massa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar cardápio em massa', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator('textarea').fill('*BEBIDAS*\nGuaraná Lata - R$ 6,50\nSuco de Uva - R$ 9,00');
  await dialog.getByRole('button', { name: 'Estruturar prévia', exact: true }).click();

  await expect(dialog.getByText('2 de 2 selecionados')).toBeVisible();
  await dialog.getByRole('button', { name: /Publicar 2 item/i }).click();
  await expect.poll(() => importPayload?.mode).toBe('merge');
  await expect(dialog.getByText(/2 produtos publicados/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Concluir', exact: true }).click();
  await expect(page.getByText('Guaraná Lata')).toBeVisible();
});
