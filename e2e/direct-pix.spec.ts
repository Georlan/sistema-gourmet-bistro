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
test('conferência mantém referência após falha e confirmação exige extrato',async({page})=>{
  await open(page,true);
  await page.getByRole('button',{name:/Conferir Pix/}).click();
  const panel=page.getByRole('dialog',{name:/Pix manual/});
  await panel.getByRole('button',{name:/#47 · Cliente teste/}).click();
  const confirm=panel.getByRole('button',{name:'Confirmar Pix recebido'});
  await panel.getByText('ID bancário (opcional)').click();
  await expect(confirm).toBeDisabled();
  await panel.getByLabel('Identificador do Pix no extrato (EndToEndId)').fill('E'+'1'.repeat(31));
  await expect(confirm).toBeDisabled();
  await panel.getByLabel('Conferi o recebimento no banco').check();
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
  await expect(panel).toContainText('Nenhum Pix pendente.');
  await panel.getByRole('button',{name:'Fechar conferência Pix'}).click();
  await expect(panel).toBeHidden();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
});

test('Pix pendente mostra contato e código curto antes do aviso do cliente, sem aceitar TXID do QR',async({page})=>{
  await open(page,true);
  const txid='abcdef1234567890abcdef123';
  await page.route('**/payments/direct-pix/pending',route=>route.fulfill({json:[{
    id:'intent-contact',order_number:'47',customer:'Cliente teste',customer_phone:'(88) 99961-6937',
    amount:'10.50',txid,customer_reported:false
  }]}));
  await page.reload();
  await page.getByRole('button',{name:/Conferir Pix/}).click();
  const panel=page.getByRole('dialog',{name:/Pix manual/});
  await expect(panel.getByText('(88) 99961-6937')).toBeVisible();
  const contact=panel.getByRole('link',{name:'Pedir comprovante no WhatsApp'});
  await expect(contact).toHaveAttribute('href',/wa\.me\/5588999616937\?text=/);
  await panel.getByRole('button',{name:/#47 · Cliente teste/}).click();
  await expect(panel.getByText('Pedido #47')).toBeVisible();
  await expect(panel).toContainText('Aguardando Pix');
  await panel.getByText('ID bancário (opcional)').click();
  const input=panel.getByLabel('Identificador do Pix no extrato (EndToEndId)');
  const confirm=panel.getByRole('button',{name:'Confirmar Pix recebido'});
  await panel.getByLabel('Conferi o recebimento no banco').check();
  await input.fill(txid);
  await expect(confirm).toBeDisabled();
  await input.fill('BANK-20261114-0001');
  await expect(confirm).toBeEnabled();
});

test('operador libera no Kanban sem simular recebimento e confirma o Pix posteriormente',async({page})=>{
  await open(page,true);
  let released=false;
  let releasePayload:Record<string,unknown>|undefined;
  let confirmations=0;
  await page.route('**/payments/direct-pix/pending',route=>route.fulfill({json:[{
    id:'unpaid-intent',order_number:'47',customer:'Cliente teste',amount:'10.50',
    released_unpaid:released,customer_reported:false
  }]}));
  await page.route('**/payments/direct-pix/unpaid-intent/release-unpaid',route=>{
    releasePayload=route.request().postDataJSON();
    released=true;
    return route.fulfill({json:{status:'pending',released_unpaid:true,already_released:false}});
  });
  await page.route('**/payments/direct-pix/unpaid-intent/confirm',route=>{
    const body=route.request().postDataJSON();
    expect(body).toMatchObject({bank_reference:null,received_amount:'10.50',checked_bank_statement:true});
    confirmations++;
    return route.fulfill({json:{status:'approved',already_confirmed:false}});
  });
  await page.reload();
  await page.getByRole('button',{name:/Conferir Pix/}).click();
  const panel=page.getByRole('dialog',{name:/Pix manual/});
  await panel.getByRole('button',{name:/#47 · Cliente teste/}).click();
  await panel.getByRole('button',{name:'Liberar preparo sem receber'}).click();
  await expect(panel).toContainText('O Pix continuará pendente no caixa');
  await panel.getByRole('button',{name:'Sim, liberar sem pagamento'}).click();
  expect(releasePayload).toEqual({acknowledge_payment_pending:true});
  expect(confirmations).toBe(0);
  await expect(panel.getByText('Na operação · Pix pendente')).toBeVisible();
  await expect(panel.getByRole('button',{name:'Liberar preparo sem receber'})).toHaveCount(0);
  await panel.getByLabel('Conferi o recebimento no banco').check();
  await panel.getByRole('button',{name:'Confirmar Pix recebido'}).click();
  expect(confirmations).toBe(1);
});

test('Caixa vazio reduz consultas Pix e evento financeiro recupera nova pendência imediatamente',async({page})=>{
  await page.clock.install();
  await mockCashierBackend(page);
  await seedCashierSession(page);
  let reads=0;
  let pending=false;
  await page.route('**/payments/direct-pix/pending',route=>{
    reads++;
    return route.fulfill({json:pending?[{id:'idle-recovered',order_number:'47',customer:'Cliente teste',amount:'10.50'}]:[]});
  });
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  await expect.poll(()=>reads).toBeGreaterThan(0);
  await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
  const baseline=reads;
  await page.clock.runFor(45_000);
  expect(reads).toBe(baseline);
  // Include response-settlement time; only one empty-list safety read is due.
  await page.clock.runFor(30_000);
  await expect.poll(()=>reads).toBe(baseline+1);
  pending=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('koma_orders_updated')));
  await expect(page.getByRole('button',{name:/Conferir Pix/})).toBeVisible();
  expect(reads).toBe(baseline+2);
  await page.clock.runFor(15_000);
  await expect.poll(()=>reads).toBe(baseline+3);
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

test('Pix manual já existente mantém QR reaberto e confirmação única',async({page,context})=>{
  await open(page);
  const enabled=true;
  let paid=false;
  let created=false;
  let customerReported=false;
  let customerReportedAt: string|null=null;
  let confirmations=0;
  const submitted: Record<string,unknown>[]=[];
  const payment=()=>({
    status:paid?'approved':'pending',
    cobranca_online:true,
    confirmacao_manual:true,
    metodo:'pix',
    txid:'journeyintent1234567890123',
    cliente_informou_pagamento:customerReported,
    pagamento_informado_em:customerReportedAt,
    qr_code:'test-only-journey-do-not-pay',
    qr_code_base64:null,
  });
  await page.route('**/payments/direct-pix/pending',route=>route.fulfill({json:created&&!paid?[{
    id:'journey-intent',
    order_number:'47',
    customer:'Cliente teste',
    amount:'10.50',
    txid:'journeyintent1234567890123',
    customer_reported:customerReported,
    customer_reported_at:customerReportedAt,
  }]:[]}));
  await page.route('**/payments/direct-pix/journey-intent/confirm',route=>{
    const body=route.request().postDataJSON();
    expect(body).toMatchObject({received_amount:'10.50',checked_bank_statement:true,bank_reference:'E1234567890123456789012345678901'});
    confirmations++;paid=true;
    return route.fulfill({json:{status:'approved',already_confirmed:false}});
  });
  const consumer=await context.newPage();
  await consumer.route('http://127.0.0.1:8000/**',async route=>{
    const request=route.request();
    const {pathname}=new URL(request.url());
    if(pathname==='/api/cardapio-digital/public') return route.fulfill({json:{
      restaurante:{id:2,nome:'Burger teste',slug:'burger-teste',aceitando_pedidos:true,status_override:'Forçado Aberto',delivery_ativo:true,taxa_entrega_fixa:6,formas_pagamento_aceitas:['Dinheiro','Pix'],pagamento_online_ativo:enabled,socials:{whatsapp:'(88) 99961-6937'}},
      categorias:[{id:10,nome:'Bebidas'}],produtos:[{id:101,nome:'Água',preco:4.5,categoria_id:10,grupos_modificadores:[]}]}});
    if(pathname==='/cardapio/pedidos'&&request.method()==='POST') {
      submitted.push(request.postDataJSON());created=true;
      return route.fulfill({status:201,json:{comanda_id:'journey-order',numero_pedido:47,total:10.5,tracking_token:'journey-tracking-token',pagamento:payment()}});
    }
    if(pathname.endsWith('/pix-informado')&&request.method()==='POST') {
      customerReported=true;
      customerReportedAt='2026-11-14T15:00:00Z';
      return route.fulfill({json:{id:'journey-order',status:paid?'pendente':'aguardando_pagamento',pagamento:payment()}});
    }
    if((pathname.includes('/cardapio/pedidos/')&&pathname.endsWith('/status'))||pathname.endsWith('/acompanhar/journey-tracking-token/summary')) return route.fulfill({json:{
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
  const shortCode=consumer.getByTestId('direct-pix-customer-confirm');
  await expect(shortCode).toContainText('Seu código');
  await expect(shortCode).toContainText('#47');
  await expect(shortCode).toContainText('Pode fechar esta tela');

  await expect(consumer.getByText('No banco, confira destinatário e valor.')).toBeVisible();
  await consumer.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as any).__copiedPix = value; } } });
  });
  await consumer.getByRole('button',{name:'Copiar código Pix',exact:true}).click();
  await expect(consumer.getByRole('button',{name:'Código Pix copiado',exact:true})).toBeVisible();
  expect(await consumer.evaluate(() => (window as any).__copiedPix)).toBe('test-only-journey-do-not-pay');
  await consumer.getByRole('button',{name:'Acompanhar pedido',exact:true}).click();
  await consumer.getByRole('button',{name:'Pagar Pix',exact:true}).click();
  const pix=consumer.getByRole('dialog',{name:'Pagamento Pix do Pedido #47'});
  await expect(pix.locator('svg[role="img"]')).toBeVisible();
  await consumer.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('blocked'); } } });
  });
  await pix.getByRole('button',{name:'Copiar código Pix',exact:true}).click();
  await expect(pix.getByRole('status')).toContainText('Não foi possível copiar');
  await expect(pix.getByRole('button',{name:'Código Pix copiado',exact:true})).toHaveCount(0);
  await expect(pix.getByLabel('Código Pix Copia e Cola')).toHaveValue('test-only-journey-do-not-pay');

  await expect(pix).toContainText('O restaurante conferirá o recebimento');
  const receiptLink = pix.getByRole('link',{name:'Enviar comprovante no WhatsApp'});
  await expect(receiptLink).toHaveAttribute('href', /wa\.me\/5588999616937\?text=/);
  await expect(receiptLink).toBeVisible();
  await expect(pix).not.toContainText('A confirmação do pagamento é automática');
  await consumer.getByRole('button',{name:'Fechar modal Pix',exact:true}).click();
  await consumer.locator((consumer.viewportSize()?.width||0)<=640 ? '#mobile-nav-orders' : '#floating-order-chat-trigger').click();
  await consumer.locator('#orders-drawer-panel').getByRole('button',{name:'Pagar Pix',exact:true}).first().click();
  const reopened=consumer.locator('#pix-payment-modal-backdrop');
  await expect(reopened.locator('svg[role="img"]')).toBeVisible();
  await expect(reopened).toContainText('O restaurante conferirá o recebimento');
  await expect(reopened.getByRole('link',{name:'Enviar comprovante no WhatsApp'})).toHaveAttribute('href', /wa\.me\/5588999616937\?text=/);
  await expect(reopened).not.toContainText('A confirmação do pagamento é automática');
  await reopened.getByRole('button',{name:/Já paguei/}).click();
  await expect(reopened.getByText('Aviso enviado ao restaurante')).toBeVisible();
  expect(customerReported).toBe(true);
  await test.info().attach('pix-reaberto-manual',{body:await consumer.screenshot(),contentType:'image/png'});
  await consumer.reload();
  const ordersButtonAfterReport=(consumer.viewportSize()?.width||0)<=640 ? '#mobile-nav-orders' : '#floating-order-chat-trigger';
  await consumer.locator(ordersButtonAfterReport).click();
  await expect(consumer.locator('#orders-drawer-panel').getByText('Pagamento informado. Aguardando confirmação do restaurante.')).toBeVisible();
  await page.reload();
  await expect(page.locator('.orders-board')).toBeVisible();
  await page.getByRole('button',{name:/Conferir Pix/}).click();
  const pending=page.getByRole('dialog',{name:/Pix manual/});
  await expect(pending.getByTestId('direct-pix-reported-journey-intent')).toContainText('Cliente avisou que pagou');
  await pending.getByRole('button',{name:/#47 · Cliente teste/}).click();
  await expect(pending.getByText('Pedido #47')).toBeVisible();
  await pending.getByText('ID bancário (opcional)').click();
  const referenceInput=pending.getByLabel('Identificador do Pix no extrato (EndToEndId)');
  await referenceInput.fill('Comprovante Pix\nID da transacao: E1234567890123456789012345678901\nValor: R$ 10,50');
  await expect(referenceInput).toHaveValue('E1234567890123456789012345678901');
  await pending.getByRole('checkbox',{name:'Conferi o recebimento no banco'}).check();
  await pending.getByRole('button',{name:'Confirmar Pix recebido'}).click();
  await expect(pending).toContainText('Nenhum Pix aguardando conferência.');
  await pending.getByRole('button',{name:'Fechar conferência Pix'}).click();
  await expect(pending).toBeHidden();
  await consumer.reload();
  const ordersButton=(consumer.viewportSize()?.width||0)<=640 ? '#mobile-nav-orders' : '#floating-order-chat-trigger';
  await consumer.locator(ordersButton).click();
  await expect(consumer.getByText('Aguardando aceite',{exact:true}).first()).toBeVisible();
  await expect(consumer.getByRole('button',{name:'Pagar Pix',exact:true})).toHaveCount(0);
  expect(confirmations).toBe(1);
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({forma_pagamento:'online',forma_pagamento_detalhe:'pix',tipo_pedido:'delivery',taxa_entrega:6});
});


test('Pix usa botão compacto, lateral com rolagem própria e mantém rascunho ao reabrir',async({page})=>{
  await open(page,true);
  const trigger=page.getByRole('button',{name:/Conferir Pix/});
  const dialog=page.getByRole('dialog',{name:/Pix manual/});
  await expect(trigger).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Conferi o recebimento no banco')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const before=await page.locator('.orders-board').boundingBox();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Fechar conferência Pix'})).toBeFocused();
  await dialog.getByRole('button',{name:/#47 · Cliente teste/}).click();
  await dialog.getByText('ID bancário (opcional)').click();
  const input=dialog.getByLabel('Identificador do Pix no extrato (EndToEndId)');
  await input.fill('E'+'2'.repeat(31));
  await input.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(input).toHaveValue('E'+'2'.repeat(31));
  await expect(dialog.getByRole('button',{name:'Confirmar Pix recebido'})).toBeDisabled();
  const box=await dialog.boundingBox();
  const viewport=page.viewportSize()!;
  expect(box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.locator('.orders-board').boundingBox()).toEqual(before);
  await test.info().attach('pix-conference-drawer',{body:await page.screenshot(),contentType:'image/png'});
  await dialog.getByRole('button',{name:'Fechar conferência Pix'}).click();
});


test('muitas pendências rolam dentro da lateral e não deslocam a página',async({page})=>{
  await open(page,true);
  await page.route('**/payments/direct-pix/pending',route=>route.fulfill({json:Array.from({length:40},(_,index)=>({id:`pix-${index}`,order_number:String(100+index),customer:'Cliente teste',amount:'4.50'}))}));
  await page.reload();
  const trigger=page.getByRole('button',{name:/Conferir Pix/});
  await expect(trigger).toContainText('40');
  if(test.info().project.name==='mobile-390' || test.info().project.name==='desktop-1366')
    await page.screenshot({path:test.info().outputPath('pix-botao.png')});
  const pageY=await page.evaluate(()=>window.scrollY);
  await trigger.click();
  const dialog=page.getByRole('dialog',{name:/Pix manual/});
  await dialog.getByRole('button',{name:/#139 · Cliente teste/}).click();
  await dialog.getByRole('button',{name:'Confirmar Pix recebido'}).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button',{name:'Fechar conferência Pix'})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Confirmar Pix recebido'})).toBeVisible();
  expect(await page.evaluate(()=>window.scrollY)).toBe(pageY);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  if(test.info().project.name==='mobile-390' || test.info().project.name==='desktop-1366')
    await page.screenshot({path:test.info().outputPath('pix-lateral.png')});
});
