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
