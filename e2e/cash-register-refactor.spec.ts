import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

for (const theme of ['dark','light']) for (const scale of [1,1.4]) {
  test(`caixa legível e navegável sem overflow em ${theme} escala ${scale}`,async({page})=>{
    await page.goto(`/e2e/fixtures/cash-register.html?theme=${theme}&scale=${scale}`);
    await expect(page.getByRole('heading',{name:'Caixa aberto',exact:true})).toBeVisible();
    await expect(page.getByText('Contas pendentes',{exact:true})).toHaveCount(0);
    await expect(page.getByText('Turno em ordem',{exact:true})).toHaveCount(0);
    const activities=page.locator('.cash-register li');
    await expect(activities.first()).toContainText('Dinheiro retirado');
    for(const button of await page.locator('.cash-register button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({path:test.info().outputPath(`turno-${theme}.png`),fullPage:true});
    await page.getByRole('button',{name:'Ver movimentações',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Entradas e retiradas',exact:true})).toBeVisible();
    await expect(page.locator('li').first()).toContainText('Dinheiro retirado');
    await expect(page.getByText('Pagamento de fornecedor com motivo completo',{exact:false})).toBeVisible();
    await page.getByRole('combobox',{name:'Tipo de movimentação'}).selectOption('suprimento');
    await expect(page.locator('li')).toHaveCount(1);
    await expect(page.locator('li')).toContainText('Reforço de troco');
    await page.getByRole('button',{name:'Limpar filtros'}).click();
    await expect(page.locator('li')).toHaveCount(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`movimentacoes-${theme}.png`),fullPage:true});
    await page.getByRole('button',{name:'fechamento',exact:true}).click();
    await page.getByRole('radio',{name:/Conferência cega/}).click();
    await expect(page.getByText('R$ 220,00',{exact:true})).toHaveCount(0);
    await page.locator('#closing-cash').fill('22000');
    await page.locator('#closing-card').fill('10000');
    await page.locator('#closing-pix').fill('20000');
    await page.getByRole('button',{name:'Revisar fechamento'}).click();
    const confirmation=page.getByRole('dialog',{name:'Confirmar fechamento?'});
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByText('Conferência cega mantida')).toBeVisible();
    await confirmation.getByRole('button',{name:'Fechar caixa',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Falha controlada ao fechar');
    await expect(page.locator('#closing-cash')).toHaveValue('220,00');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`fechamento-${theme}.png`),fullPage:true});
  });
}

test('retira apenas a unidade escolhida e mantém o item após falha',async({page})=>{
 await page.goto('/e2e/fixtures/order-details-layout.html?grouped=1&fail=1');
 await page.locator('.kd-items-disclosure > summary').click();
 await page.getByRole('button',{name:'Retirar item',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).detailCalls)).toEqual([]);
 await page.getByRole('button',{name:'Manter item',exact:true}).click();
 await expect(page.getByRole('button',{name:'Confirmar retirada'})).toHaveCount(0);
 await page.getByRole('button',{name:'Retirar item',exact:true}).click();
 await page.getByRole('combobox',{name:'Unidade a retirar — Combo Bacon'}).selectOption('combo-2');
 await page.getByRole('button',{name:'Confirmar retirada'}).click();
 await expect(page.getByRole('alert')).toContainText('Pagamento registrado');
 await expect(page.getByRole('combobox',{name:'Unidade a retirar — Combo Bacon'})).toHaveValue('combo-2');
 await expect(page.locator('.orders-detail-modal__item')).toContainText('2×');
 expect(await page.evaluate(()=>(window as any).detailCalls)).toEqual([{action:'remove',id:'combo-2'}]);
 await page.goto('/e2e/fixtures/order-details-layout.html?grouped=1');
 await page.locator('.kd-items-disclosure > summary').click();
 await page.getByRole('button',{name:'Retirar item',exact:true}).click();
 await page.getByRole('combobox',{name:'Unidade a retirar — Combo Bacon'}).selectOption('combo-2');
 await page.getByRole('button',{name:'Confirmar retirada'}).click();
 await expect(page.locator('.orders-detail-modal__item')).toContainText('1×');
 expect(await page.evaluate(()=>(window as any).detailCalls)).toEqual([{action:'remove',id:'combo-2'}]);
});

test('pedido pago não oferece retirada direta',async({page})=>{
 await page.goto('/e2e/fixtures/order-details-layout.html?grouped=1&paid=1');
 await expect(page.getByRole('button',{name:'Retirar item',exact:true})).toHaveCount(0);
 await page.goto('/e2e/fixtures/order-details-layout.html?grouped=1&online=1');
 await page.locator('.kd-items-disclosure > summary').click();
 await expect(page.getByRole('button',{name:'Retirar item',exact:true})).toHaveCount(0);
 await expect(page.getByText('Resolva a cobrança ou devolva o pagamento no Caixa antes de corrigir os itens.')).toBeVisible();
});

test('caixa envia o ID exato e só fecha detalhe após confirmação do servidor',async({page})=>{
 await mockCashierBackend(page); await seedCashierSession(page);
 const writes:string[]=[];
 await page.route('**/comandas/itens/*/cancelar',async route=>{
  writes.push(route.request().url());
  if (writes.length > 1) await new Promise(resolve => setTimeout(resolve,150));
  await route.fulfill({status:writes.length===1?409:200,json:writes.length===1?{detail:'Pagamento registrado. Faça a devolução.'}:{status:'cancelado'}});
 });
 await page.goto('/?view=caixa');
 await page.locator('.orders-card--salon').first().click();
 const dialog=page.getByRole('dialog');
 await dialog.getByText(/Ver \d+ ite(?:m|ns)/).click();
 await dialog.getByRole('button',{name:'Retirar item',exact:true}).first().click();
 await dialog.getByRole('button',{name:'Confirmar retirada'}).click();
 await expect(dialog.getByRole('alert')).toContainText('Pagamento registrado');
 await expect(dialog).toBeVisible();
 expect(writes[0]).toContain('/comandas/itens/item-e2e-1/cancelar');
 await dialog.getByRole('button',{name:'Confirmar retirada'}).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
 await expect(dialog).toBeHidden();
 await expect(page.locator('.orders-board')).toBeVisible();
 expect(writes).toHaveLength(2);
});
