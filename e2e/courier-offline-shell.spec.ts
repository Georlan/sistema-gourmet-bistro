import {test,expect} from '@playwright/test';

// Run against the built app: dev-server modules are deliberately never cached.
test.skip(process.env.KOMA_COURIER_OFFLINE_TEST !== 'true', 'Requires production preview and real browser service workers');
for(let install=1;install<=3;install++)test(`instalação nova ${install}: abre e atualiza sem rede; reconcilia ao voltar`,async({page,context})=>{
 let posts=0,deliveries:any[]=[{id:'offline-shell-order',numero_pedido:811,cliente_nome:'Cliente offline',delivery_status:'transito',delivery_endereco:'Rua offline, 10',total:30,valor_pago:0,valor_a_cobrar:30,delivery_taxa:0,itens_resumo:'1× Suco',requires_delivery_code:true}];
 await page.route('**/comandas/motoboys/**',route=>{
  if(route.request().method()==='POST')posts++;
  return route.fulfill({json:{motoboy:{id:99101,nome:'Lucas',telefone:''},entregas:deliveries}});
 });
 await page.routeWebSocket('**/ws/entregador',ws=>{ws.send(JSON.stringify({event:'courier_ready'}));ws.onMessage(message=>{if(message==='ping')ws.send(JSON.stringify({event:'pong'}));});});
 await page.goto('/entregador#token=local-offline-shell-test');
 await expect(page.getByRole('article',{name:'Pedido 811'})).toBeVisible();
 await page.waitForFunction(async()=>{
  for(const name of await caches.keys())if(name.startsWith('koma-courier-shell-v1:') && await(await caches.open(name)).match('/entregador'))return navigator.serviceWorker.controller?.scriptURL.endsWith('/courier-sw.js');
  return false;
 });
 await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('koma_courier_snapshot_v1:')))).toBe(true);
 await context.setOffline(true);
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.getByRole('article',{name:'Pedido 811'})).toBeVisible();
 await expect(page.getByRole('status').filter({hasText:'Sem conexão'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Concluir entrega'})).toBeDisabled();
 const cached=await page.evaluate(async()=>{
  const urls:string[]=[];
  for(const name of await caches.keys())if(name.startsWith('koma-courier-shell-v1:'))urls.push(...(await(await caches.open(name)).keys()).map(request=>request.url));
  return urls;
 });
 expect(cached.length).toBeGreaterThan(2);
 expect(cached.some(url=>url.includes('/comandas/')||url.includes('token='))).toBe(false);
 deliveries=[];await context.setOffline(false);
 await expect(page.getByRole('heading',{name:'Nenhuma entrega em rota'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Atualizar Pedidos'})).toBeEnabled();
 expect(posts).toBe(0);
});
