import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession, cashierConfig } from './fixtures/cashier';

test('editar produto exclusivo preserva o uso somente em promoções', async ({page}) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => { sessionStorage.setItem('koma_active_tab','cardapio'); sessionStorage.setItem('koma_active_subtab','produtos'); });
  const product = { id:'exclusive', nome:'Bebida do conjunto', categoria_id:'drink', preco:1, ativo:true, somente_promocao:true };
  await page.route('**/caixa/configuracoes',r=>r.fulfill({json:{...cashierConfig,operation_profile:'marmitaria'}}));
  await page.route('**/produtos/catalogo',r=>r.fulfill({json:{categorias:[{id:'drink',nome:'Bebidas'}],produtos:[product]}}));
  await page.route('**/produtos/exclusive', async r => {
    if(r.request().method()==='PUT') {
      expect(r.request().postDataJSON().somente_promocao).toBe(true);
      return r.fulfill({json:{...product,...r.request().postDataJSON()}});
    }
    return r.fulfill({json:product});
  });
  await page.goto('/?view=caixa');
  const card = page.locator('article').filter({has:page.getByRole('heading',{name:'Bebida do conjunto',exact:true})});
  await expect(card).toContainText('Só em promoções');
  await card.getByRole('button',{name:'Editar',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Vender somente em promoções'})).toBeChecked();
  const saved=page.waitForRequest(r=>r.method()==='PUT' && r.url().endsWith('/produtos/exclusive'));
  await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
  expect((await saved).postDataJSON().somente_promocao).toBe(true);
});


test('editar produto associa adicional sem alterar escolha herdada da categoria', async ({page}) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab','cardapio');
    sessionStorage.setItem('koma_active_subtab','produtos');
  });
  const groups = [
    { id:'included', nome:'Molho da casa', min_selecoes:1, max_selecoes:1, tipo:'obrigatorio',
      produto_ids:[], categoria_ids:['cat-pratos'],
      opcoes:[{id:'i1',nome:'Molho rosé',preco_adicional:0,ativo:true}] },
    { id:'paid', nome:'Adicionais', min_selecoes:0, max_selecoes:1, tipo:'opcional',
      produto_ids:[], categoria_ids:[],
      opcoes:[{id:'e1',nome:'Bacon extra',preco_adicional:2,ativo:true}] },
  ];
  let savedLinks: any;
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({json:groups}));
  await page.route('**/produtos/101/personalizacoes', route => {
    if (route.request().method() === 'PUT') {
      savedLinks = route.request().postDataJSON();
      return route.fulfill({json:{produto_id:'101',grupos_diretos:['paid'],grupos_herdados:['included']}});
    }
    return route.fulfill({json:{produto_id:'101',grupos_diretos:[],grupos_herdados:['included']}});
  });
  await page.route('**/produtos/101', route => route.fulfill({
    json: {id:'101',nome:'Risoto da casa',preco:42,categoria_id:'cat-pratos',
      ...route.request().postDataJSON()},
  }));
  await page.goto('/?view=caixa');
  const card = page.locator('article').filter({has:page.getByRole('heading',{name:'Risoto da casa',exact:true})});
  await card.getByRole('button',{name:'Editar',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Editar produto'});
  await dialog.getByRole('tab', { name: 'Adicionais' }).click();
  const categoryChoice = dialog.getByRole('checkbox',{name:'Associar Molho da casa ao produto'});
  const addOnChoice = dialog.getByRole('checkbox',{name:'Associar Adicionais ao produto'});
  await expect(categoryChoice).toBeChecked();
  await expect(categoryChoice).toBeDisabled();
  await expect(addOnChoice).toBeEnabled();
  await addOnChoice.check();
  await dialog.getByRole('button',{name:'Salvar alterações',exact:true}).click();
  await expect.poll(() => savedLinks).toEqual({
    grupo_ids:['paid'],
    grupos_diretos_anteriores:[],
  });
  await expect(dialog).toHaveCount(0);
});


test('cadastro único cria sabores com preços por SKU e grupos compartilhados no mobile', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'produtos');
  });
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: [
    { id: 'molhos', nome: 'Molhos', min_selecoes: 0, max_selecoes: 2, tipo: 'opcional',
      produto_ids: [], categoria_ids: [], opcoes: [
        { id: 'molho-rose', nome: 'Molho Rosé', preco_adicional: 0, ativo: true },
      ] },
  ] }));
  let savedFamily: Record<string, any> | undefined;
  await page.route('**/produto-familias', route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: [] });
    savedFamily = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: {
      id: 'family-created', grupo_ids: savedFamily?.grupo_ids || [],
      variantes: (savedFamily?.variantes || []).map((variant: any, index: number) => ({
        ...variant, produto_id: `pastel-${index + 1}`,
      })),
    } });
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo produto' });
  await dialog.locator('#product-name').fill('Pastel Médio');
  await dialog.getByRole('tab', { name: 'Variações' }).click();
  await expect(dialog.locator('#product-name')).toBeHidden();
  await dialog.getByRole('switch', { name: 'Este produto tem sabores ou tamanhos?' }).check();
  await dialog.getByRole('textbox', { name: 'Nome da opção 1' }).fill('Carne Moída');
  await dialog.locator('#variant-price-0').fill('700');
  await dialog.getByRole('button', { name: 'Adicionar sabor' }).click();
  await dialog.getByRole('textbox', { name: 'Nome da opção 2' }).fill('Queijo');
  await dialog.locator('#variant-price-1').fill('800');
  await dialog.getByRole('tab', { name: 'Adicionais' }).click();
  const molho = dialog.getByRole('checkbox', { name: 'Associar Molhos ao produto' });
  await expect(molho).toBeVisible();
  await molho.check();
  await dialog.getByRole('button', { name: 'Criar produto', exact: true }).click();
  await expect.poll(() => savedFamily).toBeTruthy();
  expect(savedFamily?.eixo).toBe('sabor');
  expect(savedFamily?.nome).toBe('Pastel Médio');
  expect(savedFamily?.variantes.map((v: any) => [v.rotulo, v.preco])).toEqual([
    ['Carne Moída', 7], ['Queijo', 8],
  ]);
  expect(savedFamily?.grupo_ids).toEqual(['molhos']);
  await expect(dialog).toHaveCount(0);
});

test('editar variante existente abre a família e preserva IDs dos sabores', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'produtos');
  });
  const products = [
    { id: 'pastel-carne', nome: 'Pastel Carne', preco: 7, categoria_id: 'cat-pratos',
      ativo: true, familia_id: 'pastel-family', variacao_rotulo: 'Carne Moída' },
    { id: 'pastel-queijo', nome: 'Pastel Queijo', preco: 8, categoria_id: 'cat-pratos',
      ativo: true, familia_id: 'pastel-family', variacao_rotulo: 'Queijo' },
  ];
  await page.route('**/produtos/catalogo', route => route.fulfill({
    json: { categorias: [{ id: 'cat-pratos', nome: 'Pratos' }], produtos: products },
  }));
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: [] }));
  await page.route('**/produto-familias', route => route.fulfill({ json: [{
    id: 'pastel-family', nome: 'Pastel Médio', descricao: '', eixo: 'sabor',
    categoria_id: 'cat-pratos', cardapio_id: null, imagem: '',
    variantes: [
      { produto_id: 'pastel-carne', rotulo: 'Carne Moída', preco: 7, ativo: true },
      { produto_id: 'pastel-queijo', rotulo: 'Queijo', preco: 8, ativo: true },
    ],
  }] }));
  await page.route('**/produto-familias/pastel-family/personalizacoes',
    route => route.fulfill({ json: { familia_id: 'pastel-family', grupo_ids: [] } }));
  let update: Record<string, any> | undefined;
  await page.route('**/produto-familias/pastel-family', route => {
    update = route.request().postDataJSON();
    return route.fulfill({ json: {
      id: 'pastel-family', grupo_ids: [], variantes: update?.variantes || [],
    } });
  });
  await page.goto('/?view=caixa');
  const card = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'Pastel Carne', exact: true }),
  });
  await card.getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar produto' });
  await dialog.getByRole('tab', { name: 'Variações' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Nome da opção 2' })).toHaveValue('Queijo');
  await dialog.locator('#variant-price-1').fill('900');
  await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect.poll(() => update).toBeTruthy();
  expect(update?.variantes.map((v: any) => [v.produto_id, v.preco])).toEqual([
    ['pastel-carne', 7], ['pastel-queijo', 9],
  ]);
  await expect(dialog).toHaveCount(0);
});


test('edição em abas preserva o rascunho sem salvar ao navegar', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'produtos');
  });
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: [] }));
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo produto' });
  await dialog.locator('#product-name').fill('Pastel Médio');
  await dialog.getByRole('tab', { name: 'Variações' }).click();
  await dialog.getByRole('switch', { name: 'Este produto tem sabores ou tamanhos?' }).check();
  await dialog.getByRole('textbox', { name: 'Nome da opção 1' }).fill('Carne Moída');
  await dialog.locator('#variant-price-0').fill('700');
  await dialog.getByRole('tab', { name: 'Adicionais' }).click();
  await expect(dialog.getByText('O cliente pode personalizar?')).toHaveCount(0);
  await expect(dialog.getByText('Personalizações compartilhadas')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Produto' }).click();
  await expect(dialog.locator('#product-name')).toHaveValue('Pastel Médio');
  await dialog.getByRole('tab', { name: 'Variações' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Nome da opção 1' })).toHaveValue('Carne Moída');
  await expect(dialog.getByRole('tab', { name: 'Variações' })).toHaveAttribute('aria-selected', 'true');
});


test('dono seleciona recomendações existentes sem cadastrar produtos novamente', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'produtos');
  });
  let stored: string[] = [];
  await page.route('**/api/cardapio-digital/recomendacoes', route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      expect(body.anteriores).toEqual([]);
      stored = body.produto_ids;
      return route.fulfill({ json: { produto_ids: stored } });
    }
    return route.fulfill({ json: { produto_ids: stored } });
  });

  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: 'Recomendações', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recomendações na sacola' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Sugestões automáticas');
  await dialog.getByRole('button', { name: 'Recomendar Risoto da casa' }).click();
  await expect(dialog).toContainText('Escolhidos (1/6)');
  await dialog.getByRole('button', { name: 'Salvar recomendações' }).click();
  await expect(dialog).toHaveCount(0);
  expect(stored).toEqual(['101']);
});
