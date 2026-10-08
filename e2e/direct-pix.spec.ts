import {expect,type Page,test} from '@playwright/test';
import {mockCashierBackend,seedCashierSession} from './fixtures/cashier';

async function open(page:Page,pending=false) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.route('**/payments/direct-pix/pending',route=>route.fulfill({json:pending?[{id:'intent-test',order_number:'47',customer:'Cliente teste',amount:'100.00'}]:[]}));
  await page.route('**/payments/direct-pix/settings',route=>route.fulfill({json:{available:true,enabled:false,key_type:'email',pix_key:'recebimento@example.com',holder_name:'RESTAURANTE',city:'FORTALEZA',commercial:{plan:'pocket',billing_cycle:'monthly',billing_amount:'109.00',marketplace_rate:'0.0149'}}}));
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

test('fatura mostra valores antes do QR e só reconhece pagamento confirmado',async({page})=>{
  await open(page);
  const invoice={id:'invoice-1',period:'2026-09',fees:'1.49',subscription_amount:'109.00',total:'110.49',status:'open',due_at:'2026-10-15T15:00:00Z'};
  await page.route('**/payments/direct-pix/invoices',route=>route.fulfill({json:[invoice]}));
  await page.route('**/payments/direct-pix/invoices/invoice-1',route=>route.fulfill({json:{...invoice,items:[{order_number:'47',amount:'100.00',fee:'1.49',method:'pix',confirmed_at:'2026-09-15T15:00:00Z'}],has_more:false}}));
  let requests=0;
  await page.route('**/payments/direct-pix/invoices/invoice-1/pix',route=>{requests++;return route.fulfill({json:requests===1?{status:'pending',amount:'110.49',qrCode:'test-invoice-code'}:{status:'approved',amount:'110.49'}});});
  await settings(page);
  await page.getByRole('button',{name:'Ver fatura',exact:true}).click();
  const statement=page.getByRole('region',{name:'Detalhes da fatura KÔMA'});
  await expect(statement).toContainText('R$ 110,49');
  await expect(statement).toContainText('#47');
  expect(requests).toBe(0);
  await statement.getByRole('button',{name:'Gerar Pix desta fatura'}).click();
  await expect(statement.getByRole('button',{name:'Conferir pagamento'})).toBeVisible();
  await expect(page.getByText('Este QR paga o KÔMA.',{exact:false})).toBeVisible();
  await test.info().attach('invoice-before-payment',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await statement.getByRole('button',{name:'Conferir pagamento'}).click();
  await expect(page.getByRole('status').filter({hasText:'Fatura paga.'})).toBeVisible();
  expect(requests).toBe(2);
});

test('QR aberto reconhece aprovação automaticamente sem gerar outra cobrança',async({page})=>{
  await page.clock.install();
  await open(page);
  const invoice={id:'auto-invoice',period:'2026-09',fees:'1.49',subscription_amount:'109.00',total:'110.49',status:'open'};
  await page.route('**/payments/direct-pix/invoices',route=>route.fulfill({json:[invoice]}));
  await page.route('**/payments/direct-pix/invoices/auto-invoice',route=>route.fulfill({json:{...invoice,items:[],has_more:false}}));
  let charges=0;
  await page.route('**/payments/direct-pix/invoices/auto-invoice/pix',route=>{charges++;return route.fulfill({json:{status:'pending',amount:'110.49',qrCode:'test-code'}});});
  await page.route('**/payments/direct-pix/invoices/auto-invoice/payment-status',route=>route.fulfill({json:{status:'approved'}}));
  await settings(page);
  await page.getByRole('button',{name:'Ver fatura',exact:true}).click();
  await page.getByRole('button',{name:'Gerar Pix desta fatura'}).click();
  await expect(page.getByRole('button',{name:'Copiar Pix da fatura'})).toBeVisible();
  await page.clock.fastForward(15001);
  await expect(page.getByRole('status').filter({hasText:'Fatura paga.'})).toBeVisible();
  expect(charges).toBe(1);
});

test('SuperAdmin distingue atraso e mantém o histórico das faturas pagas',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('koma_super_admin_token','e2e-token'));
  await page.route('**/api/super-admin/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/restaurantes'))return route.fulfill({json:[{id:'7',name:'Burger teste',status:'ACTIVE',plan:'pocket',billing:{status:'restricted',open_total:'110.49',open_count:1,due_at:'2026-10-08T15:00:00Z',subscription_status:'active',subscription_due_at:'2026-10-08T15:00:00Z'}}]});
    if(path.endsWith('/7/billing'))return route.fulfill({json:{billing:{status:'restricted'},invoices:[
      {id:'oct',period:'2026-09',subscription_amount:'109.00',fees:'1.49',total:'110.49',status:'open',due_at:'2026-10-08T15:00:00Z',paid_at:null},
      {id:'sep',period:'2026-08',subscription_amount:'109.00',fees:'0.50',total:'109.50',status:'paid',due_at:'2026-09-08T15:00:00Z',paid_at:'2026-09-08T16:00:00Z'}]}});
    if(path.endsWith('/contracts'))return route.fulfill({json:{items:[],pendingCount:0}});
    if(path.endsWith('/incidents/attention'))return route.fulfill({json:{checked_at:'2026-10-08T15:00:00Z',items:[]}});
    return route.fulfill({json:{}});
  });
  await page.route('**/health/live',route=>route.fulfill({json:{status:'ok'}}));
  await page.goto('/super-admin');
  if(page.viewportSize()!.width<768)await page.getByRole('button',{name:'Abrir menu lateral'}).click();
  await page.getByRole('button',{name:'Clientes',exact:true}).click();
  await expect(page.getByRole('table').first()).toContainText('Novas vendas restritas');
  await page.getByRole('button',{name:'Histórico de faturas'}).click();
  const history=page.getByRole('dialog',{name:'Histórico de cobrança KÔMA'});
  await expect(history).toContainText('R$ 110,49');
  await expect(history).toContainText('R$ 109,50');
  await expect(history).toContainText('Paga');
  await test.info().attach('superadmin-billing-history',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await history.getByRole('button',{name:'Fechar',exact:true}).click();
  await expect(history).toBeHidden();
});
