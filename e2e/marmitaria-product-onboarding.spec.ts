import { expect, test } from '@playwright/test';
import { cashierConfig, mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('Produtos define limites próprios por quentinha e Complementos oferece vínculos de outros produtos', async ({ page }) => {
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
  await edit.getByRole('button', { name: 'Abrir composição diretamente sem salvar dados básicos', exact: true }).click();
  const readOnlyComposition = page.getByRole('dialog', { name: 'Nova marmita' });
  await expect(readOnlyComposition.getByLabel('Preço da marmita')).toHaveValue('10,00');
  expect(products[0].preco).toBe(10);
  expect(sizes[0].regras).toEqual([]);
  await readOnlyComposition.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await readOnlyComposition.getByRole('button', { name: 'Fechar', exact: true }).click();
  await row('Quentinha G').getByRole('button', { name: 'Editar', exact: true }).click();
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
  await page.getByRole('button', { name: 'Cadastros', exact: true }).click();
  await expect(page.getByText('3 opções cadastradas', { exact: true }).first()).toBeVisible();
  await page.getByTitle('Editar').first().click();
  await expect(page.getByText('Mínimo', { exact: true })).toBeHidden();
  await expect(page.getByText('Máximo', { exact: true })).toBeHidden();
  await expect(page.getByText('Tipo', { exact: true })).toBeHidden();
  await expect(page.getByText(/Para quentinhas, configure o mínimo e o máximo em cada tamanho na aba Produtos/)).toBeVisible();
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


test('promoções ficam como categoria virtual no catálogo, sem bloco acima dos produtos', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'produtos');
  });
  const categories = [
    { id: 'quentinhas', nome: 'Quentinhas', destino_impressao: 'COZINHA' },
    { id: 'bebidas', nome: 'Bebidas', destino_impressao: 'BAR' },
  ];
  const products = [
    { id: 'g', nome: 'Quentinha G', categoria_id: 'quentinhas', preco: 14, ativo: true, marmitaria_tamanho: 'g' },
    { id: 'm', nome: 'Quentinha M', categoria_id: 'quentinhas', preco: 10, ativo: true, marmitaria_tamanho: 'm' },
    { id: 'pitulinha', nome: 'Pitulinha', categoria_id: 'bebidas', preco: 1, ativo: true, somente_promocao: true },
  ];
  let promotions = [
    { id: 'gm', nome: 'Quentinha G + Quentinha M', descricao: 'Duas quentinhas', preco: 22, componentes: [['g'], ['m']], ativo: true },
    { id: 'gb', nome: 'Quentinha G + Pitulinha', descricao: 'Bebida exclusiva', preco: 16, componentes: [['g'], ['pitulinha']], ativo: false },
  ];
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'marmitaria' } }));
  await page.route('**/produtos/catalogo', route => route.fulfill({ json: { categorias: categories, produtos: products } }));
  await page.route('**/api/cardapio-digital/promocoes**', async route => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').at(-1);
    if (request.method() === 'PUT') {
      const index = promotions.findIndex(promotion => promotion.id === id);
      expect(index).toBeGreaterThanOrEqual(0);
      promotions[index] = { ...promotions[index], ...request.postDataJSON() };
      await route.fulfill({ json: promotions[index] });
      return;
    }
    if (request.method() === 'POST') {
      const created = { ...request.postDataJSON(), id: 'new-promotion' };
      promotions = [...promotions, created];
      await route.fulfill({ status: 201, json: created });
      return;
    }
    await route.fulfill({ json: { produtos: products, categorias: categories, promocoes: promotions, perfil_marmitaria: true } });
  });

  await page.goto('/?view=caixa');
  const categoriesBar = page.getByLabel('Categorias do cardápio');
  await expect(categoriesBar.getByRole('button', { name: /Promoções/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo produto', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Gerenciar promoções' })).toHaveCount(0);

  await categoriesBar.getByRole('button', { name: /Promoções/ }).click();
  const panel = page.getByRole('region', { name: 'Gerenciar promoções' });
  await expect(panel).toBeVisible();
  await expect(categoriesBar.getByRole('button', { name: /Promoções 2/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Novo produto', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Buscar produtos' })).toHaveCount(0);
  await expect(panel.getByText('Quentinha G + Quentinha M', { exact: true })).toBeVisible();
  await expect(panel.getByText('Quentinha G + Pitulinha', { exact: true })).toBeVisible();
  await expect(panel.getByText('R$ 22,00')).toBeVisible();
  await expect(panel.getByText('R$ 16,00')).toBeVisible();
  await expect(panel.getByText('Bebida exclusiva do combo')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'G + M · R$ 22' })).toHaveCount(0);

  await panel.getByRole('button', { name: 'Pausar Quentinha G + Quentinha M' }).click();
  await expect(panel.getByText('Pausada', { exact: true })).toHaveCount(2);
  await panel.getByRole('button', { name: 'Publicar Quentinha G + Pitulinha' }).click();
  await expect(panel.getByText('Ativa', { exact: true })).toHaveCount(1);

  await panel.getByRole('button', { name: 'Nova oferta' }).click();
  await expect(panel.getByRole('region', { name: 'Cadastrar promoção' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'G + M · R$ 22' })).toBeVisible();
  await expect(panel.getByText('Cadastrar bebida exclusiva para o combo')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Criar bebida apenas para promoções' })).toBeHidden();
  await panel.getByRole('button', { name: 'G + M · R$ 22' }).click();
  await expect(panel.getByRole('textbox', { name: 'Nome da promoção' })).toHaveValue('Quentinha G + Quentinha M');
  await expect(panel.getByRole('spinbutton', { name: 'Preço do conjunto' })).toHaveValue('22.00');
  await panel.getByRole('button', { name: 'Cancelar' }).click();
  await expect(panel.getByRole('region', { name: 'Cadastrar promoção' })).toHaveCount(0);

  const scheduledCard = panel.locator('article').filter({ hasText: 'Quentinha G + Quentinha M' });
  await scheduledCard.getByRole('button', { name: 'Editar', exact: true }).click();
  await panel.getByLabel('Início programado (opcional)').fill('2099-10-16T12:00');
  await panel.getByLabel('Encerramento (opcional)').fill('2099-10-16T14:00');
  await panel.getByLabel('Habilitar oferta').check();
  const savedSchedule = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith('/promocoes/gm'));
  await panel.getByRole('button', { name: 'Salvar alterações' }).click();
  const scheduled = (await savedSchedule).postDataJSON();
  expect(scheduled.inicio_em).toBe('2099-10-16T15:00:00.000Z');
  expect(scheduled.fim_em).toBe('2099-10-16T17:00:00.000Z');
  expect(scheduled.fuso_horario).toBe('America/Fortaleza');
  await scheduledCard.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(panel.getByLabel('Início programado (opcional)')).toHaveValue('2099-10-16T12:00');
  await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await categoriesBar.getByRole('button', { name: /Todos/ }).click();
  await expect(page.getByRole('button', { name: 'Novo produto', exact: true })).toBeVisible();
  await expect(page.locator('article').filter({ has: page.getByRole('heading', { name: 'Quentinha G', exact: true }) })).toHaveCount(1);
});

test('promoções estão disponíveis globalmente sem modelos de marmitaria', async ({ page }, testInfo) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'produtos');
  });
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'generic' } }));
  await page.goto('/?view=caixa');
  await expect(page.getByLabel('Categorias do cardápio')).toBeVisible();
  await expect(page.getByLabel('Categorias do cardápio').getByRole('button', { name: /Promoções/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo produto', exact: true })).toBeVisible();
  await page.route('**/api/cardapio-digital/promocoes**', route => route.fulfill({ json: {
    produtos: [], categorias: [], promocoes: [], perfil_marmitaria: false,
  } }));
  await page.getByLabel('Categorias do cardápio').getByRole('button', { name: /Promoções/ }).click();
  const panel = page.getByRole('region', { name: 'Gerenciar promoções' });
  await expect(panel.getByText('Nenhuma promoção cadastrada')).toBeVisible();
  await panel.getByRole('button', { name: 'Nova oferta' }).click();
  await expect(panel.getByRole('textbox', { name: 'Nome da promoção' })).toBeVisible();
  await expect(panel.getByLabel('Modelos de ofertas')).toHaveCount(0);
  await expect(panel.getByText('Pitulinha')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('promotions-global.png'), fullPage: true });
});
