import {expect,type Page,test} from '@playwright/test';
import {mockCashierBackend,seedCashierSession} from './fixtures/cashier';

async function open(page:Page,pending=false) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.route('**/payments/direct-pix/pending',route=>route.fulfill({json:pending?[{id:'intent-test',order_number:'47',customer:'Cliente teste',amount:'100.00'}]:[]}));
  await page.route('**/payments/direct-pix/settings',route=>route.fulfill({json:{available:true,enabled:false,key_type:'email',pix_key:'recebimento@example.com',holder_name:'RESTAURANTE',city:'FORTALEZA'}}));
  await page.route('**/payments/direct-pix/invoices',route=>route.fulfill({json:[]}));
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
}
async function settings(page:Page) {
  const sidebar=page.locator('.cashier-sidebar:visible');
  if(!await sidebar.isVisible()) await page.getByRole('button',{name:'Abrir menu principal'}).click();
  await sidebar.getByRole('button',{name:/^Configurações/}).click();
  await page.getByRole('button',{name:'Integrações',exact:true}).first().click();
}

test('chave própria exige aceite e preserva a conexão Mercado Pago',async({page})=>{
  await open(page);
  const bodies:unknown[]=[];
  await page.route('**/payments/direct-pix/settings',async route=>{
    if(route.request().method()!=='PUT') return route.fallback();
    const body=route.request().postDataJSON();bodies.push(body);
    await route.fulfill({json:{...body,available:true}});
  });
  await settings(page);
  const card=page.getByRole('region',{name:'Pix direto na conta'});
  const activate=card.getByRole('button',{name:'Usar chave Pix própria'});
  await expect(activate).toBeDisabled();
  await card.getByRole('checkbox').check();
  await activate.click();
  await expect(card).toContainText('Pix direto ativado para novos pedidos.');
  await expect(page.getByText('Conta Mercado Pago vinculada')).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({enabled:true,accept_manual_confirmation_and_monthly_fees:true});
  await test.info().attach('direct-pix-settings',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});

test('conferência mantém referência após falha e confirmação exige extrato',async({page})=>{
  await open(page,true);
  const panel=page.getByRole('region',{name:'Pix aguardando conferência'});
  await panel.getByRole('button',{name:/Pedido #47/}).click();
  const confirm=panel.getByRole('button',{name:'Confirmar Pagamento Pix'});
  await expect(confirm).toBeDisabled();
  await panel.getByLabel('Identificador do Pix no extrato (EndToEndId)').fill('E'+'1'.repeat(31));
  await expect(confirm).toBeDisabled();
  await panel.getByLabel('Conferi o valor integral recebido na conta correta.').check();
  const bodies:unknown[]=[];
  await page.route('**/payments/direct-pix/intent-test/confirm',async route=>{
    bodies.push(route.request().postDataJSON());
    await route.fulfill({status:bodies.length===1?503:200,json:bodies.length===1?{detail:'Falha temporária'}:{status:'approved'}});
  });
  await confirm.click();
  await expect(panel.getByRole('alert')).toContainText('Falha temporária');
  await expect(panel.getByLabel('Identificador do Pix no extrato (EndToEndId)')).toHaveValue('E'+'1'.repeat(31));
  await test.info().attach('direct-pix-manual-confirmation',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await page.route('**/payments/direct-pix/pending',route=>route.fulfill({json:[]}));
  await confirm.click();
  await expect(panel).toBeHidden();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
});
