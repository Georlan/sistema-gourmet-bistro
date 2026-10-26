import { test, expect, type Page } from '@playwright/test';
const API = 'http://127.0.0.1:8000';
const source = {channel:'caixa',label:'Caixa',references:[]};
const stop = (id: string, number: number, longitude?: number) => ({
  id,numero_pedido:number,cliente_nome:`Cliente ${number}`,delivery_status:'transito',delivery_endereco:`Rua ${number}, 10`,
  total:30,valor_pago:0,valor_a_cobrar:30,delivery_taxa:0,itens_resumo:'1× Suco',criado_em:new Date().toISOString(),source,
  destination:{label:`Rua ${number}, 10`,complement:null,reference:null,route_query:`Rua ${number}, 10`,latitude:longitude === undefined ? null : 1,longitude:longitude ?? null},
});
const deliveries = [stop('far',101,5),stop('near',102,1),stop('unknown',103)];
async function locationMock(page: Page, mode: 'success'|'denied'|'pending'|'imprecise') {
  await page.addInitScript(mode => {
    const state = window as any;
    state.geoCalls = 0; state.geoCallbacks = [];
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success: any,error: any,options: any){
      state.geoCalls++;state.geoCallbacks.push(success);state.geoOptions=options;
      if(mode === 'denied') error({code:1});
      if(mode === 'success' || mode === 'imprecise') success({coords:{latitude:1,longitude:0,accuracy:mode === 'imprecise' ? 3000 : 15},timestamp:Date.now()});
    }}});
  }, mode);
}
async function open(page: Page) {
  await page.goto('/entregador#token=local-automatic-order-token');
  await expect(page.getByRole('heading',{name:'Entregas'})).toBeVisible();
}
const panel = (items = deliveries) => ({contract_version:2,motoboy:{id:99061,nome:'Lucas',telefone:''},entregas:items});

test('ordena a partir do celular sob demanda; falta de coordenadas fica visível e só IDs persistem',async({page})=>{
  let gets=0,posts=0;
  await page.route(`${API}/**`,route=>{if(route.request().method()==='POST')posts++;else gets++;return route.fulfill({json:panel()});});
  await locationMock(page,'success');await open(page);
  expect(await page.evaluate(()=>(window as any).geoCalls)).toBe(0);
  const initial=gets;
  await page.getByRole('button',{name:'Ordenar automático',exact:true}).click();
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','Pedido 102');
  await expect(page.getByRole('article').first()).toContainText('Próxima entrega');
  await expect(page.getByRole('article').last()).toHaveAttribute('aria-label','Pedido 103');
  await expect(page.getByRole('status').filter({hasText:'1 entrega sem localização'})).toBeVisible();
  expect(gets).toBe(initial);expect(posts).toBe(0);
  const stored=await page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.startsWith('koma_courier_trip_v1:')));
  expect(stored).toHaveLength(1);expect(JSON.parse(stored[0][1])).toEqual(['near','far','unknown']);
  expect(await page.evaluate(()=>(window as any).geoOptions)).toEqual({enableHighAccuracy:true,timeout:10000,maximumAge:30000});
  await page.reload();await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','Pedido 102');
  expect(await page.evaluate(()=>(window as any).geoCalls)).toBe(0);
  await page.getByRole('button',{name:'Editar sequência'}).click();
  await expect(page.getByRole('status').filter({hasText:'1 entrega sem localização'})).toHaveCount(0);
  await page.getByRole('button',{name:'Antecipar pedido 101'}).click();
  await page.getByRole('button',{name:'Usar sequência'}).click();
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','Pedido 101');
});

for(const mode of ['denied','imprecise'] as const) test(`localização ${mode} preserva ordem e permite ajuste`,async({page})=>{
  await page.route(`${API}/**`,route=>route.fulfill({json:panel()}));
  await locationMock(page,mode);await open(page);
  await page.getByRole('button',{name:'Ordenar automático',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText(mode === 'denied' ? 'Permita a localização' : 'Localização imprecisa');
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','Pedido 101');
  await expect(page.getByRole('button',{name:'Organizar viagem'})).toBeEnabled();
});

test('timeout e resposta tardia não alteram a viagem nem duplicam a busca de posição',async({page})=>{
  await page.route(`${API}/**`,route=>route.fulfill({json:panel()}));
  await locationMock(page,'pending');await open(page);await page.clock.install();
  await page.getByRole('button',{name:'Ordenar automático',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
  await expect(page.getByRole('button',{name:'Localizando…'})).toBeDisabled();
  expect(await page.evaluate(()=>(window as any).geoCalls)).toBe(1);
  await page.clock.fastForward(12100);
  await expect(page.getByRole('alert')).toContainText('Localização demorou');
  await page.evaluate(()=>(window as any).geoCallbacks[0]({coords:{latitude:1,longitude:0,accuracy:10}}));
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','Pedido 101');
  await expect(page.getByText('Próxima entrega')).toHaveCount(0);
});

test('troca de entregador invalida callback pendente de GPS',async({page})=>{
  let items=deliveries;
  await page.route(`${API}/**`,route=>route.fulfill({json:panel(items)}));
  await locationMock(page,'pending');await open(page);
  await page.getByRole('button',{name:'Ordenar automático',exact:true}).click();
  items=[stop('other-far',201,5),stop('other-near',202,1)];
  await page.evaluate(()=>{location.hash='token=another-local-automatic-token';});
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','Pedido 201');
  await page.evaluate(()=>(window as any).geoCallbacks[0]({coords:{latitude:1,longitude:0,accuracy:10}}));
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','Pedido 201');
  await expect(page.getByText('Próxima entrega')).toHaveCount(0);
});

test('pedido reatribuído enquanto GPS aguarda não reaparece na sequência',async({page})=>{
  let items=deliveries;
  await page.route(`${API}/**`,route=>route.fulfill({json:panel(items)}));
  await locationMock(page,'pending');await open(page);
  await page.getByRole('button',{name:'Ordenar automático',exact:true}).click();
  items=[deliveries[0],deliveries[2]];
  await page.getByRole('button',{name:'Atualizar Pedidos'}).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Atualizar Pedidos'})).toBeEnabled();
  await page.evaluate(()=>(window as any).geoCallbacks[0]({coords:{latitude:1,longitude:0,accuracy:10}}));
  await expect(page.getByRole('button',{name:'Editar sequência'})).toBeEnabled();
  await expect(page.getByRole('article',{name:'Pedido 102'})).toHaveCount(0);
  const stored=await page.evaluate(()=>Object.entries(sessionStorage).find(([key])=>key.startsWith('koma_courier_trip_v1:'))?.[1]);
  expect(JSON.parse(stored!)).toEqual(['far','unknown']);
});

test('sem coordenadas não pede GPS e não inventa localização a partir do endereço',async({page})=>{
  await page.route(`${API}/**`,route=>route.fulfill({json:panel([stop('a',101),stop('b',102)])}));
  await locationMock(page,'success');await open(page);
  await page.getByRole('button',{name:'Ordenar automático',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Endereços sem localização');
  expect(await page.evaluate(()=>(window as any).geoCalls)).toBe(0);
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','Pedido 101');
});
