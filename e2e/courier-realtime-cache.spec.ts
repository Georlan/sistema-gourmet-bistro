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
 await expect(page.getByRole('button',{name:'Concluir entrega'})).toBeDisabled();
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
   posts++;expect(route.request().postDataJSON()).toEqual({code:'0123'});items=[];
   for(let i=0;i<10;i++)ws.at(-1)!.send(JSON.stringify({event:'courier_panel_updated'}));
   return route.fulfill({json:{status:'sucesso'}});
  }
  return route.fulfill({json:panel(items)});
 });
 await open(page);await expect.poll(()=>cached(page)).toBe(1);
 await page.getByRole('button',{name:'Concluir entrega'}).click();
 await page.getByLabel('Código de entrega').fill('0123');await page.getByLabel('Código de entrega').press('Enter');
 await expect(page.getByRole('heading',{name:'Nenhuma entrega em rota'})).toBeVisible();expect(posts).toBe(1);
 await expect(page.getByRole('button',{name:'Atualizar Pedidos'})).toBeEnabled();
 await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
 await page.reload();
 await expect(page.getByRole('heading',{name:'Nenhuma entrega em rota'})).toBeVisible();expect(posts).toBe(1);
});
