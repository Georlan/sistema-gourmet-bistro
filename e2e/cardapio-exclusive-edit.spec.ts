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
