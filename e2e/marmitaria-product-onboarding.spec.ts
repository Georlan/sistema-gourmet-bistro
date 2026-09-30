import { expect, test } from '@playwright/test';
import { cashierConfig, mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('lista única edita G, cria P/M e configura escolhas exclusivamente em Complementos', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => { sessionStorage.setItem('koma_active_tab', 'cardapio'); sessionStorage.setItem('koma_active_subtab', 'produtos'); });
  const categories = [{ id: 'quentinhas', nome: 'Quentinhas', destino_impressao: 'COZINHA' }];
  const products: Record<string, any>[] = [{ id: 'original-g', nome: 'Quentinha G', categoria_id: 'quentinhas', preco: 10, ativo: false }];
  let sizes: Record<string, any>[] = [{ ...products[0], tamanho: 'G', regras: [], configurado: false }];
  const groups = ['Proteínas', 'Guarnições'].map((nome, index) => ({ id: `group-${index}`, nome, tipo: 'opcional', min_selecoes: 0, max_selecoes: 3, opcoes: ['Frango', 'Carne', 'Peixe'].map((name, i) => ({ id: `option-${index}-${i}`, nome: name, ativo: true, preco_adicional: 0 })), produto_ids: [], categoria_ids: [] }));
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'marmitaria' } }));
  await page.route('**/produtos/catalogo', route => route.fulfill({ json: { categorias: categories, produtos: products } }));
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: groups }));
  await page.route('**/cardapio/modificadores/categorias-hierarquia', route => route.fulfill({ json: categories }));
  let failNext = false;
  await page.route('**/cardapio/marmitaria/tamanhos**', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { enabled: true, tamanhos: sizes } }); return; }
    if (failNext) { failNext = false; await route.fulfill({ status: 409, json: { detail: 'Confira as escolhas da marmita.' } }); return; }
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
  await page.goto('/?view=caixa');
  const row = (name: string) => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(row('Quentinha G')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Cadastro de marmitas' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Novo Grupo', exact: true })).toHaveCount(0);
  const choices = page.getByRole('region', { name: 'Escolhas das marmitas' });
  for (const [size, price, count] of [['G', '2800', 2], ['P', '1200', 1], ['M', '2000', 2]] as const) {
    const name = size === 'G' ? 'Quentinha G' : `Marmita ${size}`;
    if (size !== 'G') {
      await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
      await page.getByRole('button', { name: /^Marmita/ }).click();
      const create = page.getByRole('dialog', { name: 'Nova marmita' });
      await expect(create.getByRole('button', { name: 'Configurar marmita G', exact: true })).toBeDisabled();
      await create.getByRole('button', { name: `Cadastrar marmita ${size}` }).click();
      await create.getByLabel('Preço da marmita').fill(price);
      await create.getByRole('button', { name: 'Salvar marmita' }).click();
      await expect(create).toHaveCount(0);
    }
    await row(name).getByRole('button', { name: 'Editar', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Editar produto' });
    await expect(edit.getByLabel('Nome do produto')).toHaveValue(name);
    await edit.getByLabel('Preço de venda').fill(price);
    await edit.getByRole('button', { name: 'Salvar e configurar escolhas em Complementos' }).click();
    await expect(edit).toHaveCount(0);
    await expect(choices.getByRole('form')).toBeVisible();
    for (const [index, quantity] of [[0, count], [1, 3]]) {
      await choices.getByRole('button', { name: 'Adicionar escolhas' }).click();
      await choices.getByLabel(`Grupo ${index + 1}`, { exact: true }).selectOption(`group-${index}`);
      await choices.getByLabel(`Quantidade do grupo ${index + 1}`).fill(String(quantity));
    }
    await choices.getByLabel('Disponível para venda').check();
    await choices.getByRole('button', { name: 'Salvar escolhas' }).click();
    await expect(choices.getByRole('form')).toHaveCount(0);
    await page.getByRole('button', { name: 'Produtos', exact: true }).last().click();
    await row(name).getByRole('button', { name: 'Editar', exact: true }).click();
    await edit.getByLabel('Preço de venda').fill(price);
    await edit.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await expect(edit).toHaveCount(0);
    expect(sizes.find(item => item.nome === name)?.regras).toHaveLength(2);
    await expect(row(name)).toHaveCount(1);
  }
  expect(products).toHaveLength(3);
  expect(sizes.find(size => size.id === 'original-g')?.preco).toBe(28);
  await page.getByRole('button', { name: 'Complementos', exact: true }).last().click();
  await choices.getByRole('button', { name: 'Configurar Quentinha G', exact: true }).click();
  await choices.getByLabel('Permitir repetir grupo 1').check();
  failNext = true;
  await choices.getByRole('button', { name: 'Salvar escolhas' }).click();
  await expect(choices.getByRole('alert')).toHaveText('Confira as escolhas da marmita.');
  await expect(choices.getByLabel('Permitir repetir grupo 1')).toBeChecked();
  await choices.getByRole('button', { name: 'Salvar escolhas' }).click();
  await expect(choices.getByRole('form')).toHaveCount(0);
  expect(products).toHaveLength(3);
});

test('salva preço pausado sem grupos e permite continuar o cadastro depois', async ({ page }) => {
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
  await expect(panel.getByLabel('Disponível para venda')).toBeDisabled();
  await panel.getByRole('button', { name: 'Salvar marmita' }).click();
  await expect(page.getByRole('dialog', { name: 'Nova marmita' })).toHaveCount(0);
  expect(saved).toMatchObject({ tamanho: 'P', preco: 15, ativo: false, regras: [] });
});

test('marmita antiga ativa sem escolhas pode ser pausada pelo cadastro único', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => { sessionStorage.setItem('koma_active_tab', 'cardapio'); sessionStorage.setItem('koma_active_subtab', 'produtos'); });
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'marmitaria' } }));
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: [] }));
  let saved = { id: 'old-g', tamanho: 'G', nome: 'Quentinha G', preco: 10, ativo: true, regras: [] };
  await page.route('**/cardapio/marmitaria/tamanhos**', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { enabled: true, tamanhos: [saved] } }); return; }
    expect(route.request().method()).toBe('PUT');
    expect(route.request().url()).toMatch(/old-g$/);
    saved = { ...saved, ...route.request().postDataJSON() };
    await route.fulfill({ json: saved });
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: 'Complementos', exact: true }).last().click();
  const panel = page.getByRole('region', { name: 'Escolhas das marmitas' });
  await panel.getByRole('button', { name: 'Configurar Quentinha G', exact: true }).click();
  await expect(panel.getByLabel('Disponível para venda')).toBeEnabled();
  await panel.getByLabel('Disponível para venda').uncheck();
  await panel.getByRole('button', { name: 'Salvar escolhas' }).click();
  await expect(panel.getByRole('form')).toHaveCount(0);
  expect(saved.ativo).toBe(false);
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
