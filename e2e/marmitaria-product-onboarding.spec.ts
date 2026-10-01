import { expect, test } from '@playwright/test';
import { cashierConfig, mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('Produtos define limites próprios por quentinha e Complementos mantém somente grupos e opções', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => { sessionStorage.setItem('koma_active_tab', 'cardapio'); sessionStorage.setItem('koma_active_subtab', 'produtos'); });
  const categories = [{ id: 'quentinhas', nome: 'Quentinhas', destino_impressao: 'COZINHA' }];
  const products: Record<string, any>[] = [{ id: 'original-g', nome: 'Quentinha G', categoria_id: 'quentinhas', preco: 10, ativo: false, marmitaria_tamanho: 'g' }];
  let sizes: Record<string, any>[] = [{ ...products[0], tamanho: 'G', regras: [], configurado: true }];
  const groups = ['Proteínas', 'Guarnições'].map((nome, index) => ({ id: `group-${index}`, nome, tipo: 'opcional', min_selecoes: 0, max_selecoes: 3, opcoes: ['Frango', 'Carne', 'Peixe'].map((name, i) => ({ id: `option-${index}-${i}`, nome: name, ativo: true, preco_adicional: 0 })), produto_ids: [], categoria_ids: [] }));
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'marmitaria' } }));
  await page.route('**/produtos/catalogo', route => route.fulfill({ json: { categorias: categories, produtos: products } }));
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: groups }));
  await page.route('**/cardapio/modificadores/categorias-hierarquia', route => route.fulfill({ json: categories }));
  let failNext = false;
  await page.route('**/cardapio/marmitaria/tamanhos**', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { enabled: true, tamanhos: sizes } }); return; }
    if (failNext) { failNext = false; await route.fulfill({ status: 409, json: { detail: 'Confira a composição da marmita.' } }); return; }
    const payload = route.request().postDataJSON();
    const id = route.request().method() === 'PUT' ? route.request().url().split('/').at(-1)! : `marmita-${payload.tamanho}`;
    const saved = { ...payload, id, categoria_id: 'quentinhas', configurado: true };
    sizes = [...sizes.filter(size => size.id !== id), saved];
    const product = { ...saved, marmitaria_tamanho: payload.tamanho.toLowerCase() };
    const position = products.findIndex(item => item.id === id);
    if (position >= 0) products[position] = product; else products.push(product);
    await route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200, json: saved });
  });
  await page.route(/\/produtos\/(original-g|marmita-[PM])$/, async route => {
    const id = route.request().url().split('/').at(-1)!;
    const product = products.find(item => item.id === id)!;
    Object.assign(product, route.request().postDataJSON());
    sizes = sizes.map(size => size.id === id ? { ...size, ...route.request().postDataJSON() } : size);
    await route.fulfill({ json: product });
  });

  const configureComposition = async (panel: ReturnType<typeof page.getByRole>, proteinMax: number) => {
    for (const [index, limits] of [[0, [0, proteinMax]], [1, [0, 3]]] as const) {
      await panel.getByRole('button', { name: /Adicionar.*composição/ }).click();
      await panel.getByLabel(`Grupo ${index + 1}`, { exact: true }).selectOption(`group-${index}`);
      await panel.getByLabel(`Mínimo do grupo ${index + 1}`).fill(String(limits[0]));
      await panel.getByLabel(`Máximo do grupo ${index + 1}`).fill(String(limits[1]));
    }
    await panel.getByLabel('Disponível para venda').check();
  };

  await page.goto('/?view=caixa');
  const row = (name: string) => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(row('Quentinha G')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Cadastro de marmitas' })).toHaveCount(0);

  await row('Quentinha G').getByRole('button', { name: 'Editar', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Editar produto' });
  await edit.getByLabel('Preço de venda').fill('2800');
  await edit.getByRole('button', { name: 'Salvar e configurar composição da quentinha' }).click();
  const gDialog = page.getByRole('dialog', { name: 'Nova marmita' });
  const gPanel = gDialog.getByRole('region', { name: 'Cadastro de marmitas' });
  await expect(gPanel.getByRole('form')).toBeVisible();
  await configureComposition(gPanel, 2);
  await gPanel.getByRole('button', { name: 'Salvar marmita' }).click();
  await expect(gDialog).toHaveCount(0);

  for (const [size, price, proteinMax] of [['P', '1200', 1], ['M', '2000', 2]] as const) {
    await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
    await page.getByRole('dialog', { name: 'Novo produto' }).getByRole('button', { name: /^Marmita/ }).click();
    const create = page.getByRole('dialog', { name: 'Nova marmita' });
    const panel = create.getByRole('region', { name: 'Cadastro de marmitas' });
    await expect(panel.getByRole('button', { name: 'Configurar marmita G', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: `Cadastrar marmita ${size}` }).click();
    await panel.getByLabel('Preço da marmita').fill(price);
    await expect(panel.getByLabel('Disponível para venda')).toBeChecked();
    await expect(panel.getByRole('button', { name: /Adicionar à composição/ })).toBeVisible();
    await configureComposition(panel, proteinMax);
    await panel.getByRole('button', { name: 'Salvar marmita' }).click();
    await expect(create).toHaveCount(0);
    await expect(row(`Marmita ${size}`)).toHaveCount(1);
  }

  expect(products).toHaveLength(3);
  expect(sizes.find(size => size.id === 'original-g')?.regras).toEqual([
    { grupo_id: 'group-0', minimo: 0, maximo: 2, modo_selecao: 'tipos' },
    { grupo_id: 'group-1', minimo: 0, maximo: 3, modo_selecao: 'tipos' },
  ]);
  expect(sizes.find(size => size.tamanho === 'P')?.regras[0]).toMatchObject({ grupo_id: 'group-0', minimo: 0, maximo: 1 });
  expect(sizes.find(size => size.tamanho === 'M')?.regras[0]).toMatchObject({ grupo_id: 'group-0', minimo: 0, maximo: 2 });

  await row('Quentinha G').getByRole('button', { name: 'Editar', exact: true }).click();
  await edit.getByRole('button', { name: 'Salvar e configurar composição da quentinha' }).click();
  const retryDialog = page.getByRole('dialog', { name: 'Nova marmita' });
  const retryPanel = retryDialog.getByRole('region', { name: 'Cadastro de marmitas' });
  await retryPanel.getByLabel('Permitir repetir grupo 1').check();
  failNext = true;
  await retryPanel.getByRole('button', { name: 'Salvar marmita' }).click();
  await expect(retryPanel.getByRole('alert')).toHaveText('Confira a composição da marmita.');
  await expect(retryPanel.getByLabel('Permitir repetir grupo 1')).toBeChecked();
  await retryPanel.getByRole('button', { name: 'Salvar marmita' }).click();
  await expect(retryDialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Complementos', exact: true }).last().click();
  await expect(page.getByRole('region', { name: 'Cadastro de marmitas' })).toHaveCount(0);
  await expect(page.getByText('De 0 a 3 opções', { exact: true })).toHaveCount(0);
  await expect(page.getByText('3 opções cadastradas', { exact: true }).first()).toBeVisible();
  await page.getByTitle('Editar').first().click();
  await expect(page.getByText('Mínimo', { exact: true })).toBeHidden();
  await expect(page.getByText('Máximo', { exact: true })).toBeHidden();
  await expect(page.getByText('Tipo', { exact: true })).toBeHidden();
  await expect(page.getByText(/O mínimo e o máximo pertencem a cada Quentinha P, M ou G e são configurados em Produtos/)).toBeVisible();
});
test('novo tamanho inicia à venda e ainda pode ser salvo pausado sem grupos', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => { sessionStorage.setItem('koma_active_tab', 'cardapio'); sessionStorage.setItem('koma_active_subtab', 'produtos'); });
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'marmitaria' } }));
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: [] }));
  let saved: Record<string, unknown> | null = null;
  await page.route('**/cardapio/marmitaria/tamanhos**', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { enabled: true, tamanhos: saved ? [saved] : [] } }); return; }
    saved = { ...route.request().postDataJSON(), id: 'paused-p', configurado: true };
    await route.fulfill({ status: 201, json: saved });
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  await page.getByRole('button', { name: /^Marmita/ }).click();
  const panel = page.getByRole('region', { name: 'Cadastro de marmitas' });
  await panel.getByRole('button', { name: 'Cadastrar marmita P' }).click();
  await panel.getByLabel('Preço da marmita').fill('1500');
  await expect(panel.getByLabel('Disponível para venda')).toBeEnabled();
  await expect(panel.getByLabel('Disponível para venda')).toBeChecked();
  await expect(panel.getByRole('button', { name: /Adicionar à composição/ })).toBeVisible();
  await panel.getByLabel('Disponível para venda').uncheck();
  await panel.getByRole('button', { name: 'Salvar marmita' }).click();
  await expect(page.getByRole('dialog', { name: 'Nova marmita' })).toHaveCount(0);
  expect(saved).toMatchObject({ tamanho: 'P', preco: 15, ativo: false, regras: [] });
});

test('marmita antiga ativa sem escolhas pode ser pausada pelo fluxo de Produtos', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => { sessionStorage.setItem('koma_active_tab', 'cardapio'); sessionStorage.setItem('koma_active_subtab', 'produtos'); });
  const categories = [{ id: 'quentinhas', nome: 'Quentinhas', destino_impressao: 'COZINHA' }];
  const products: Record<string, any>[] = [{ id: 'old-g', nome: 'Quentinha G', categoria_id: 'quentinhas', preco: 10, ativo: true, marmitaria_tamanho: 'g' }];
  let saved: Record<string, any> = { ...products[0], tamanho: 'G', regras: [], configurado: true };
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'marmitaria' } }));
  await page.route('**/produtos/catalogo', route => route.fulfill({ json: { categorias: categories, produtos: products } }));
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: [] }));
  await page.route('**/cardapio/marmitaria/tamanhos**', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { enabled: true, tamanhos: [saved] } }); return; }
    expect(route.request().method()).toBe('PUT');
    expect(route.request().url()).toMatch(/old-g$/);
    saved = { ...saved, ...route.request().postDataJSON() };
    Object.assign(products[0], saved);
    await route.fulfill({ json: saved });
  });
  await page.route('**/produtos/old-g', async route => {
    Object.assign(products[0], route.request().postDataJSON());
    saved = { ...saved, ...route.request().postDataJSON() };
    await route.fulfill({ json: products[0] });
  });
  await page.goto('/?view=caixa');
  const row = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Quentinha G', exact: true }) });
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Editar produto' });
  await edit.getByRole('button', { name: 'Salvar e configurar composição da quentinha' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova marmita' });
  const panel = dialog.getByRole('region', { name: 'Cadastro de marmitas' });
  await expect(panel.getByLabel('Disponível para venda')).toBeEnabled();
  await panel.getByLabel('Disponível para venda').uncheck();
  await panel.getByRole('button', { name: 'Salvar marmita' }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved.ativo).toBe(false);
});

test('Hambúrguer e outros perfis mantêm os limites globais de Complementos', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => { sessionStorage.setItem('koma_active_tab', 'cardapio'); sessionStorage.setItem('koma_active_subtab', 'complementos'); });
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'generic' } }));
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: [] }));
  await page.route('**/cardapio/modificadores/categorias-hierarquia', route => route.fulfill({ json: [] }));
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: 'Novo Grupo', exact: true }).click();
  await expect(page.getByText('Tipo', { exact: true })).toBeVisible();
  await expect(page.getByText('Mínimo', { exact: true })).toBeVisible();
  await expect(page.getByText('Máximo', { exact: true })).toBeVisible();
});
test('adiciona sobremesa e suco na lista das marmitas e reaproveita categorias', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => { sessionStorage.setItem('koma_active_tab', 'cardapio'); sessionStorage.setItem('koma_active_subtab', 'produtos'); });
  const categories = [{ id: 'quentinhas', nome: 'Quentinhas', destino_impressao: 'COZINHA' }];
  const products: Record<string, any>[] = [{ id: 'original-g', nome: 'Quentinha G', categoria_id: 'quentinhas', preco: 10, ativo: true, marmitaria_tamanho: 'g' }];
  let categoryCreates = 0;
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'marmitaria' } }));
  await page.route('**/produtos/catalogo', route => route.fulfill({ json: { categorias: categories, produtos: products } }));
  await page.route('**/produtos/categorias', async route => {
    if (route.request().method() !== 'POST') { await route.fulfill({ json: categories }); return; }
    const category = route.request().postDataJSON();
    categories.push(category);
    categoryCreates++;
    await route.fulfill({ status: 201, json: category });
  });
  await page.route('**/produtos/', async route => {
    const product = { ...route.request().postDataJSON(), id: `created-${products.length}` };
    products.push(product);
    await route.fulfill({ status: 201, json: product });
  });
  await page.route(/\/produtos\/created-\d+$/, async route => {
    const product = products.find(item => item.id === route.request().url().split('/').at(-1))!;
    Object.assign(product, route.request().postDataJSON());
    await route.fulfill({ json: product });
  });
  await page.goto('/?view=caixa');
  const row = (name: string) => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
  for (const [type, name, price, category] of [['Sobremesa', 'Pudim caseiro', '600', 'sobremesas'], ['Bebida', 'Suco de acerola', '500', 'bebidas']] as const) {
    await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
    await page.getByRole('dialog', { name: 'Novo produto' }).getByRole('button', { name: new RegExp(`^${type}`) }).click();
    const form = page.getByRole('dialog', { name: 'Novo produto' });
    await form.getByLabel('Nome do produto').fill(name);
    await form.getByLabel('Preço de venda').fill(price);
    await expect(form.getByLabel('Categoria', { exact: true })).toHaveValue(category);
    await form.getByRole('button', { name: 'Criar produto', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(row(name)).toHaveCount(1);
    await expect(row('Quentinha G')).toHaveCount(1);
  }
  expect(categoryCreates).toBe(2);
  await row('Suco de acerola').getByRole('button', { name: 'Editar', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Editar produto' });
  await edit.getByLabel('Preço de venda').fill('700');
  await edit.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(edit).toHaveCount(0);
  expect(products.find(item => item.nome === 'Suco de acerola')?.preco).toBe(7);
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  await page.getByRole('dialog', { name: 'Novo produto' }).getByRole('button', { name: /^Bebida/ }).click();
  await expect(page.getByLabel('Categoria', { exact: true })).toHaveValue('bebidas');
  expect(categoryCreates).toBe(2);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar produtos' }).fill('Quentinha');
  await expect(row('Quentinha G')).toHaveCount(1);
  await expect(row('Pudim caseiro')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Buscar produtos' }).fill('');
  await expect(row('Pudim caseiro')).toHaveCount(1);
  const widths = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  expect(widths[1]).toBeLessThanOrEqual(widths[0] + 1);
});
