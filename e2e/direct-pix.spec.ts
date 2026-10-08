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

test('liberação de teste permite cadastrar chave sem inventar contrato ou mensalidade',async({page})=>{
  await open(page);
  const config={available:true,enabled:false,key_type:'email',pix_key:'recebimento@example.com',holder_name:'RESTAURANTE',city:'FORTALEZA',commercial:null,test_mode:true};
  await page.route('**/payments/direct-pix/settings',async route=>{
    if(route.request().method()==='PUT') {
      expect(route.request().postDataJSON()).toMatchObject({enabled:true});
      return route.fulfill({json:{...config,enabled:true}});
    }
    return route.fulfill({json:config});
  });
  await settings(page);
  const card=page.getByRole('region',{name:'Pix direto na conta'});
  await expect(card).toContainText('sem contrato ou mensalidade habilitada');
  await expect(card).toContainText('O QR movimenta dinheiro real');
  await expect(card).not.toContainText('Seu contrato');
  await card.getByRole('checkbox').check();
  await card.getByRole('button',{name:'Usar chave Pix própria'}).click();
  await expect(card).toContainText('Pix direto ativado para novos pedidos.');
  await expect(card).toContainText('sem contrato ou mensalidade habilitada');
});

test('cadastro da chave chega ao checkout, QR reaberto e confirmação manual única',async({page,context})=>{
  await open(page);
  let enabled=false;
  let paid=false;
  let created=false;
  let confirmations=0;
  const submitted: Record<string,unknown>[]=[];
  const configuration={available:true,key_type:'email',pix_key:'recebimento@example.com',holder_name:'RESTAURANTE',city:'FORTALEZA',commercial:null,test_mode:true};
  const payment=()=>({status:paid?'approved':'pending',cobranca_online:true,confirmacao_manual:true,metodo:'pix',qr_code:'test-only-journey-do-not-pay',qr_code_base64:null});
  await page.route('**/payments/direct-pix/settings',async route=>{
    if(route.request().method()==='PUT') enabled=route.request().postDataJSON().enabled;
    await route.fulfill({json:{...configuration,enabled}});
  });
  await page.route('**/payments/direct-pix/pending',route=>route.fulfill({json:created&&!paid?[{id:'journey-intent',order_number:'47',customer:'Cliente teste',amount:'10.50'}]:[]}));
  await page.route('**/payments/direct-pix/journey-intent/confirm',route=>{
    const body=route.request().postDataJSON();
    expect(body).toMatchObject({received_amount:'10.50',checked_bank_statement:true,bank_reference:'E'+'8'.repeat(31)});
    confirmations++;paid=true;
    return route.fulfill({json:{status:'approved',already_confirmed:false}});
  });
  await settings(page);
  const card=page.getByRole('region',{name:'Pix direto na conta'});
  await card.getByRole('checkbox').check();
  await card.getByRole('button',{name:'Usar chave Pix própria'}).click();
  await expect(card).toContainText('Pix direto ativado');
  const consumer=await context.newPage();
  await consumer.route('http://127.0.0.1:8000/**',async route=>{
    const request=route.request();
    const {pathname}=new URL(request.url());
    if(pathname==='/api/cardapio-digital/public') return route.fulfill({json:{
      restaurante:{id:2,nome:'Burger teste',slug:'burger-teste',aceitando_pedidos:true,status_override:'Forçado Aberto',delivery_ativo:true,taxa_entrega_fixa:6,formas_pagamento_aceitas:['Dinheiro','Pix'],pagamento_online_ativo:enabled},
      categorias:[{id:10,nome:'Bebidas'}],produtos:[{id:101,nome:'Água',preco:4.5,categoria_id:10,grupos_modificadores:[]}]}});
    if(pathname==='/cardapio/pedidos'&&request.method()==='POST') {
      submitted.push(request.postDataJSON());created=true;
      return route.fulfill({status:201,json:{comanda_id:'journey-order',numero_pedido:47,total:10.5,pagamento:payment()}});
    }
    if(pathname.includes('/cardapio/pedidos/')&&pathname.endsWith('/status')) return route.fulfill({json:{
      id:'journey-order',numero_pedido:47,status:paid?'pendente':'aguardando_pagamento',tipo:'Delivery',fechado:false,total:10.5,pagamento:payment()}});
    return route.fulfill({json:{}});
  });
  await consumer.goto('/cardapio?restaurante_id=2');
  await consumer.locator('#btn-fast-add-101').click();
  const cartButton=(consumer.viewportSize()?.width||0)<=640 ? '#mobile-nav-cart' : '#btn-cart-header';
  await consumer.locator(cartButton).click();
  const cart=consumer.locator('#cart-drawer-container');
  await cart.getByRole('button',{name:'Receber',exact:true}).click();
  await consumer.getByRole('button',{name:/^Entrega\b/}).click();
  await consumer.locator('#delivery-address-logradouro').fill('Rua de teste');
  await consumer.locator('#delivery-address-numero').fill('10');
  await cart.getByRole('button',{name:'Pagamento',exact:true}).click();
  await consumer.getByRole('button',{name:'Pix',exact:true}).click();
  await cart.getByRole('button',{name:'Contato',exact:true}).click();
  await consumer.locator('#input-guest-name').fill('Cliente teste');
  await consumer.locator('#input-guest-phone').fill('85999999999');
  await consumer.locator('#input-customer-email').fill('cliente@example.test');
  await consumer.getByRole('button',{name:'Revisar pedido',exact:true}).click();
  await consumer.getByRole('button',{name:'Fazer pedido',exact:true}).click();
  await expect(consumer.getByText('Aguardando pagamento',{exact:true}).first()).toBeVisible();
  await expect(consumer.getByText('O restaurante conferirá o recebimento',{exact:false})).toBeVisible();
  await consumer.getByRole('button',{name:'Acompanhar pedido',exact:true}).click();
  await consumer.getByRole('button',{name:'Pagar Pix',exact:true}).click();
  const pix=consumer.getByRole('dialog',{name:'Pagamento Pix do Pedido #47'});
  await expect(pix.locator('svg[role="img"]')).toBeVisible();
  await expect(pix).toContainText('O restaurante conferirá o recebimento');
  await expect(pix).not.toContainText('A confirmação do pagamento é automática');
  await consumer.getByRole('button',{name:'Fechar modal Pix',exact:true}).click();
  await consumer.locator((consumer.viewportSize()?.width||0)<=640 ? '#mobile-nav-orders' : '#floating-order-chat-trigger').click();
  await consumer.locator('#orders-drawer-panel').getByRole('button',{name:'Pagar Pix',exact:true}).first().click();
  const reopened=consumer.locator('#pix-payment-modal-backdrop');
  await expect(reopened.locator('svg[role="img"]')).toBeVisible();
  await expect(reopened).toContainText('O restaurante conferirá o recebimento');
  await expect(reopened).not.toContainText('A confirmação do pagamento é automática');
  await test.info().attach('pix-reaberto-manual',{body:await consumer.screenshot(),contentType:'image/png'});
  await page.reload();
  await expect(page.locator('.orders-board')).toBeVisible();
  const pending=page.getByRole('region',{name:'Pix aguardando conferência'});
  await pending.getByRole('button',{name:/Pedido #47/}).click();
  await pending.getByRole('textbox').fill('E'+'8'.repeat(31));
  await pending.getByRole('checkbox',{name:'Conferi o valor integral recebido na conta correta.'}).check();
  await pending.getByRole('button',{name:'Confirmar Pagamento Pix'}).click();
  await expect(pending).toHaveCount(0);
  await consumer.reload();
  const ordersButton=(consumer.viewportSize()?.width||0)<=640 ? '#mobile-nav-orders' : '#floating-order-chat-trigger';
  await consumer.locator(ordersButton).click();
  await expect(consumer.getByText('Aguardando aceite',{exact:true}).first()).toBeVisible();
  await expect(consumer.getByRole('button',{name:'Pagar Pix',exact:true})).toHaveCount(0);
  expect(confirmations).toBe(1);
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({forma_pagamento:'online',forma_pagamento_detalhe:'pix',tipo_pedido:'delivery',taxa_entrega:6});
});
