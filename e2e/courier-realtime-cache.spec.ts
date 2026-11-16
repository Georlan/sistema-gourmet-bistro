import {test,expect,type Page,type WebSocketRoute} from '@playwright/test';
const API='http://127.0.0.1:8000';
const token='isolated-offline-courier';
const delivery={id:'offline-delivery',numero_pedido:701,cliente_nome:'Cliente reservado',delivery_endereco:'Rua offline, 10',delivery_status:'transito',total:30,valor_a_cobrar:30,valor_pago:0,delivery_taxa:0,itens_resumo:'1× Suco',requires_delivery_code:true};
const panel=(items:any[])=>({motoboy:{id:99091,nome:'Lucas',telefone:''},entregas:items});
async function sockets(page:Page){
 const active:WebSocketRoute[]=[];
 await page.routeWebSocket('**/ws/entregador',ws=>{active.push(ws);ws.onMessage(message=>{if(message==='ping')ws.send(JSON.stringify({event:'pong'}));});ws.send(JSON.stringify({event:'courier_ready'}));});
 return active;
}
async function open(page:Page){await page.goto('/entregador#token='+token);await expect(page.getByRole('heading',{name:'Entregas'})).toBeVisible();}
const cached=(page:Page)=>page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('koma_courier_snapshot_v1:')).length);

test('reconexão com releitura falha bloqueia lista antiga até conferir a atribuição',async({page})=>{
 let fail=false,posts=0,gets=0;
 await page.route(`${API}/**`,route=>{
  if(route.request().method()==='POST'){posts++;return route.fulfill({json:{status:'sucesso'}});}
  gets++;return route.fulfill(fail?{status:503,json:{detail:'Servidor indisponível'}}:{json:panel([delivery])});
 });
 await open(page);
 const confirm=page.getByRole('button',{name:'Confirmar com código',exact:true});
 await expect(confirm).toBeEnabled();
 fail=true;
 await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
 await expect(confirm).toBeDisabled();
 const before=gets;
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect.poll(()=>gets).toBeGreaterThan(before);
 await expect(page.getByRole('status').filter({hasText:'Atualização pendente'})).toBeVisible();
 await expect(confirm).toBeDisabled();
 expect(posts).toBe(0);
 fail=false;
 await page.getByRole('button',{name:'Atualizar Pedidos'}).click();
 await expect(confirm).toBeEnabled();
 expect(posts).toBe(0);
});

for(const status of [500,502,503,504,408]){
 test(`HTTP ${status} na confirmação exige releitura sem repetir POST`,async({page})=>{
  let posts=0,recover=false;
  await page.route(`${API}/**`,route=>{
   if(route.request().method()==='POST'){posts++;return route.fulfill({status,json:{detail:'Resposta incerta'}});}
   if(posts&&!recover)return route.fulfill({status:503,json:{detail:'Releitura indisponível'}});
   return route.fulfill({json:panel(recover?[]:[delivery])});
  });
  await open(page);
  await page.getByRole('button',{name:'Confirmar com código',exact:true}).click();
  await page.getByLabel('Código de entrega').fill('012');
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Confirmação pendente'})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Confirmar com código',exact:true})).toBeDisabled();
  expect(posts).toBe(1);
  recover=true;
  await page.getByRole('button',{name:'Verificar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Nenhuma entrega em rota'})).toBeVisible();
  expect(posts).toBe(1);
 });
}

test('cache cifrado restaura no reload sem API; outra credencial não herda a lista',async({page})=>{
 await sockets(page);
 await page.route(`${API}/**`,route=>route.fulfill({json:panel([delivery])}));
 await open(page);await expect.poll(()=>cached(page)).toBe(1);
 const raw=await page.evaluate(()=>JSON.stringify(localStorage));
 expect(raw).not.toContain('Cliente reservado');expect(raw).not.toContain('Rua offline');
 await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
 await page.reload();
 await expect(page.getByRole('article',{name:'Pedido 701'})).toBeVisible();
 await expect(page.getByRole('status').filter({hasText:'Sem conexão'})).toBeVisible();
 await expect(page.getByRole('button',{name:/^(Concluir entrega|Confirmar com código)$/})).toBeDisabled();
 await expect(page.getByRole('link',{name:/Google Maps/})).toBeVisible();
 await page.evaluate(()=>{location.hash='token=another-offline-courier';});
 await expect(page.getByRole('article')).toHaveCount(0);
 await expect(page.getByRole('alert')).toContainText('sem entregas salvas');
});

test('WebSocket atualiza atribuição em rajada sem polling, reconecta e revogação limpa o cache',async({page})=>{
 let items:any[]=[],gets=0;
 const ws=await sockets(page);
 await page.route(`${API}/**`,route=>{gets++;return route.fulfill({json:panel(items)});});
 await open(page);await expect.poll(()=>gets).toBeGreaterThanOrEqual(2);
 await expect(page.getByRole('button',{name:'Atualizar Pedidos'})).toBeEnabled();
 const initial=gets;items=[delivery];
 for(let i=0;i<20;i++)ws.at(-1)!.send(JSON.stringify({event:'courier_panel_updated'}));
 await expect(page.getByRole('article',{name:'Pedido 701'})).toBeVisible();
 expect(gets).toBe(initial+1);
 await page.clock.install();await page.clock.fastForward(60_000);
 expect(gets).toBe(initial+1);
 items=[];const connected=ws.length;
 await ws.at(-1)!.close({code:1012});
 await page.clock.fastForward(2000);
 await expect.poll(()=>ws.length).toBeGreaterThan(connected);
 await page.clock.fastForward(250);
 await expect(page.getByRole('article')).toHaveCount(0);
 expect(ws.at(-1)!.url()).not.toContain('token=');
 await ws.at(-1)!.close({code:1008});
 await expect(page.getByRole('alert')).toContainText('Acesso encerrado');
 await expect.poll(()=>cached(page)).toBe(0);
});

test('código com rede confirma uma vez, relê evento e não ressuscita a entrega no cache',async({page})=>{
 let items:any[]=[delivery],posts=0;
 const ws=await sockets(page);
 await page.route(`${API}/**`,route=>{
  if(route.request().method()==='POST'){
   posts++;expect(route.request().postDataJSON()).toEqual({code:'012'});items=[];
   for(let i=0;i<10;i++)ws.at(-1)!.send(JSON.stringify({event:'courier_panel_updated'}));
   return route.fulfill({json:{status:'sucesso'}});
  }
  return route.fulfill({json:panel(items)});
 });
 await open(page);await expect.poll(()=>cached(page)).toBe(1);
 await page.getByRole('button',{name:/^(Concluir entrega|Confirmar com código)$/}).click();
 await page.getByLabel('Código de entrega').fill('012');await page.getByLabel('Código de entrega').press('Enter');
 await expect(page.getByRole('heading',{name:'Nenhuma entrega em rota'})).toBeVisible();expect(posts).toBe(1);
 await expect(page.getByRole('button',{name:'Atualizar Pedidos'})).toBeEnabled();
 await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
 await page.reload();
 await expect(page.getByRole('heading',{name:'Nenhuma entrega em rota'})).toBeVisible();expect(posts).toBe(1);
});
