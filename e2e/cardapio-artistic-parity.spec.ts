import {expect, test, type Page} from '@playwright/test';
import {publicMenuPayload} from './fixtures/menu-parity';

async function menu(page:Page, mutate?:(payload:any)=>void, rankingGate?:Promise<void>) {
  const payload:any = structuredClone(publicMenuPayload);
  payload.restaurante.beneficios = {coupons:false,loyalty:false,cashback:false};
  payload.produtos.push({id:301,nome:'Pizza de batata',preco:40,categoria_id:10,grupos_modificadores:[]});
  mutate?.(payload);
  let rankingRequests=0;
  const orders:any[]=[];
  await page.routeWebSocket('**/ws/**',()=>{});
  await page.route('http://127.0.0.1:8000/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path === '/cardapio/pedidos' && route.request().method() === 'POST') { orders.push(route.request().postDataJSON()); return route.fulfill({status:201,json:{comanda_id:'local-order',numero_pedido:123,total:24}}); }
    if(path.endsWith('/public')) return route.fulfill({json:payload});
    if(path.endsWith('/populares')) {rankingRequests++;if(rankingGate)await rankingGate;return route.fulfill({json:{produtos:[{produto_id:'201',escolhas:12},{produto_id:'101',escolhas:7}]}});}
    return route.fulfill({json:{}});
  });
  await page.goto('/cardapio?restaurante_id=2&vitrine=artistic-total');
  await expect(page.locator('#koma-artistic-canvas')).toBeVisible();
  return {payload,orders,rankingRequests:()=>rankingRequests};
}

 test('ranking real, IDs únicos e consulta única ao navegar', async({page})=>{
  const state=await menu(page);
  await expect(page.locator('#koma-art-hero-showcase')).toContainText('Vinho Tinto');
  await expect.poll(state.rankingRequests).toBeGreaterThan(0);
  const initialRequests=state.rankingRequests();
  const duplicateIds=await page.locator('[id]').evaluateAll(elements=>elements.map(e=>e.id).filter((id,i,ids)=>ids.indexOf(id)!==i));
  expect(duplicateIds).toEqual([]);
  const nav=page.getByRole('navigation',{name:'Categorias do cardápio'});
  await nav.getByRole('button',{name:'Bebidas',exact:true}).click();
  await nav.getByRole('button',{name:'Início',exact:true}).click();
  expect(state.rankingRequests()).toBe(initialRequests);
 });

 test('adicionar mantém ordem das recomendações e sincroniza catálogo; detalhes aceitam teclado',async({page})=>{
  await menu(page,p=>{p.produtos.push({id:202,nome:'Suco natural',preco:10,categoria_id:20,grupos_modificadores:[]});});
  const before=await page.locator('[id^="pairing-card-"]').evaluateAll(es=>es.map(e=>e.id));
  await page.locator('#btn-pairing-fast-add-202').click();
  await expect(page.locator('#pairing-qty-202')).toHaveText('1');
  await expect(page.locator('#qty-202')).toHaveText('1');
  expect(await page.locator('[id^="pairing-card-"]').evaluateAll(es=>es.map(e=>e.id))).toEqual(before);
  await expect(page.locator('#cardapio-recommendations-home')).not.toContainText('Pizza de batata');
  await page.locator('#product-card-101').getByRole('button',{name:/ver detalhes/}).press('Enter');
  await expect(page.locator('#product-details-modal')).toBeVisible();
  await expect(page.locator('#product-details-modal')).toContainText('Catupiry');
  await page.goBack();
  await expect(page.locator('#product-details-modal')).toHaveCount(0);
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 });

 test('fast add e quantidade na sacola resistem a eventos agrupados',async({page})=>{
  await menu(page);
  await expect(page.locator('#btn-hero-fast-add-201')).toBeVisible();
  await page.locator('#btn-hero-fast-add-201').evaluate(button=>{for(let i=0;i<10;i++)(button as HTMLButtonElement).click();});
  await expect(page.locator('#hero-qty-201')).toHaveText('10');
  await page.locator('#btn-cart-header').click();
  const cart=page.locator('#cart-drawer-container');
  await expect(cart).toBeVisible();
  await cart.getByRole('button',{name:'Aumentar Vinho Tinto Sangiovese (Taça)',exact:true}).first().evaluate(button=>{for(let i=0;i<10;i++)(button as HTMLButtonElement).click();});
  await expect(cart.locator('#cart-items')).toContainText('20× Vinho');
  await expect(cart.locator('#btn-confirm-order')).toHaveAccessibleName('Continuar');
  await expect(page.locator('#koma-art-dock')).toHaveCount(0);
  await page.goBack();
  await expect(cart).not.toBeVisible();
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 });

 for(const mode of ['tipos','porcoes'])test(`marmitaria artística preserva limite por ${mode} e edição`,async({page})=>{
  await menu(page,p=>{p.produtos[0].nome='Quentinha G';p.produtos[0].marmitaria=true;p.produtos[0].grupos_modificadores=[{id:'protein',nome:'Proteínas',min_selecoes:2,max_selecoes:2,modo_selecao:mode,tipo:'obrigatorio',opcoes:[{id:'chicken',nome:'Frango',ativo:true,preco_adicional:0},{id:'beef',nome:'Carne',ativo:true,preco_adicional:2}]}];});
  await page.locator('#btn-fast-add-101').click();
  const modal=page.locator('#product-details-modal');
  const choose=modal.getByRole(mode==='tipos'?'checkbox':'button',{name:mode==='tipos'?'Selecionar Frango':'Adicionar uma unidade de Frango',exact:true});
  await choose.click();
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal).toContainText('Confira as escolhas em Proteínas');
  await modal.getByRole(mode==='tipos'?'checkbox':'button',{name:mode==='tipos'?'Selecionar Carne':'Adicionar uma unidade de Frango',exact:true}).click();
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal).toHaveCount(0);
  if(!await page.locator('#cart-drawer-container').isVisible())await page.locator('#btn-cart-header').click();
  const cart=page.locator('#cart-drawer-container');
  await cart.getByRole('button',{name:'Editar montagem de Quentinha G',exact:true}).click();
  await expect(modal.locator('#btn-add-to-cart-action')).toHaveAccessibleName(/Salvar 1 × Quentinha G/);
  await page.goBack();
  await expect(cart).toBeVisible();
  await expect(modal).toHaveCount(0);
 });

 for(const enabled of [false,true])test(`benefícios ${enabled}: dock e numeração contínua`,async({page})=>{
  await menu(page,p=>{p.restaurante.beneficios={coupons:enabled,loyalty:enabled,cashback:enabled};});
  await expect(page.locator('#mobile-nav-benefits')).toHaveCount(enabled?1:0);
  await page.locator('#btn-fast-add-201').click();
  if(!await page.locator('#cart-drawer-container').isVisible())await page.locator('#btn-cart-header').click();
  const labels=await page.locator('#cart-drawer-container h3 > button[aria-controls]').allTextContents();
  const numbered=labels.map(s=>s.trim()).filter(s=>/^\d+\./.test(s));
  expect(numbered.length).toBeGreaterThan(0);
  for(let i=0;i<numbered.length;i++)expect(numbered[i]).toMatch(new RegExp(`^${i+1}\\.`));
 });

 test('promoção preserva preço base e adicional canônico',async({page})=>{
  await menu(page,p=>{p.promocoes=[{id:'combo',nome:'Pizza e vinho',preco:60,componentes:[['101'],['201']],fim_em:null}];});
  await page.getByRole('button',{name:/Montar promoção Pizza e vinho/}).click();
  const modal=page.locator('#product-details-modal');
  await modal.getByRole('checkbox',{name:'Selecionar Catupiry'}).check();
  await modal.getByRole('button',{name:/Continuar para/}).click();
  await modal.getByRole('button',{name:'Revisar promoção'}).click();
  await page.getByRole('button',{name:'Adicionar promoção',exact:true}).click();
  await expect(page.locator('#cart-drawer-container')).toContainText('Pizza e vinho');
  await expect(page.locator('#cart-drawer-container')).toContainText(/R\$\s*65,00/);
 });

 test('pausa e pagamento removido atualizam sacola sem duplicar ações',async({page})=>{
  const state=await menu(page);
  await page.locator('#btn-fast-add-201').click();
  await page.locator('#btn-cart-header').click();
  state.payload.restaurante.aceitando_pedidos=false;
  state.payload.restaurante.motivo_indisponibilidade='Pausa de teste';
  // Retomar a aba usa o mesmo refresh do evento real e conserva a sacola.
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#btn-confirm-order')).toBeDisabled();
  await expect(page.locator('#btn-confirm-order')).toHaveAccessibleName('Pedidos pausados');
  state.payload.restaurante.aceitando_pedidos=true;
  state.payload.restaurante.formas_pagamento_aceitas=[];
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#btn-confirm-order')).toHaveAccessibleName('Pagamento indisponível');
 });

test('busca canônica ignora acentos e informa ausência de resultados',async({page})=>{
  await menu(page,p=>{p.produtos[0].nome='Camarão gratinado';});
  const search=page.getByRole('searchbox');
  await search.fill('camarao');
  await expect(page.locator('#product-card-101')).toBeVisible();
  await search.fill('nenhum-produto');
  await expect(page.getByRole('status')).toContainText('Nenhum item encontrado');
  await page.getByRole('status').getByRole('button',{name:'Limpar busca'}).click();
  await expect(search).toHaveValue('');
  await expect(page.locator('#product-card-101')).toBeVisible();
});

test('consumo local não exige mesa ou endereço e envia uma única vez',async({page})=>{
  const state=await menu(page,p=>{p.restaurante.taxa_entrega_padrao=7;p.restaurante.tipos_pedido_ativos=['delivery','retirada','consumo_local'];});
  await page.locator('#btn-fast-add-201').click();
  if(!await page.locator('#cart-drawer-container').isVisible())await page.locator('#btn-cart-header').click();
  const cart=page.locator('#cart-drawer-container');
  await cart.locator('#btn-confirm-order').click();
  await cart.getByRole('button',{name:/^Consumo local/}).click();
  await expect(cart.locator('#delivery-address-logradouro')).toHaveCount(0);
  await cart.locator('#btn-confirm-order').click();
  await cart.getByRole('button',{name:'Dinheiro',exact:true}).click();
  await cart.locator('#btn-confirm-order').click();
  await cart.locator('#input-guest-name').fill('Cliente local');
  await cart.locator('#input-guest-phone').fill('85999999999');
  await cart.locator('#btn-confirm-order').click();
  await page.locator('#btn-place-order-final').click();
  await expect(page.getByText('Pedido recebido',{exact:true})).toBeVisible();
  expect(state.orders).toHaveLength(1);
  expect(state.orders[0]).toMatchObject({tipo_pedido:'consumo_local',taxa_entrega:0});
  expect(state.orders[0].mesa_id).toBeUndefined();
});

test('ranking atrasado não remove recomendações após adicionar',async({page})=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await menu(page,p=>{p.produtos.push({id:202,nome:'Suco natural',preco:10,categoria_id:20,grupos_modificadores:[]});},gate);
  const ids=await page.locator('[id^="pairing-card-"]').evaluateAll(es=>es.map(e=>e.id));
  await page.locator('#btn-pairing-fast-add-202').click();
  release();
  await expect(page.locator('#koma-art-hero-showcase')).toContainText('Vinho Tinto');
  expect(await page.locator('[id^="pairing-card-"]').evaluateAll(es=>es.map(e=>e.id))).toEqual(ids);
  await expect(page.locator('#pairing-qty-202')).toHaveText('1');
});

test('rota padrão usa o novo cardápio e mantém retorno explícito ao editorial',async({page})=>{
  await menu(page);
  await page.goto('/cardapio?restaurante_id=2');
  await expect(page.locator('#koma-artistic-canvas')).toBeVisible();
  await page.goto('/cardapio?restaurante_id=2&vitrine=editorial');
  await expect(page.locator('#koma-artistic-canvas')).toHaveCount(0);
  await expect(page.locator('#catalog-feed')).toBeVisible();
});

for (const firstField of ['phone','name'] as const) {
  test(`contato preserva os dois campos começando por ${firstField}`,async({page})=>{
    const state=await menu(page);
    await page.locator('#btn-fast-add-201').click();
    if(!await page.locator('#cart-drawer-container').isVisible())await page.locator('#btn-cart-header').click();
    const cart=page.locator('#cart-drawer-container');
    await cart.getByRole('button',{name:'Contato',exact:true}).click();
    for(const field of firstField==='phone'?['phone','name']:['name','phone']) {
      await page.locator(`#input-guest-${field}`).fill(field==='phone'?'85999999999':'Cliente local');
    }
    await expect(page.locator('#input-guest-phone')).toHaveValue('(85) 99999-9999');
    await expect(page.locator('#input-guest-name')).toHaveValue('Cliente local');
    await cart.getByRole('button',{name:'Receber',exact:true}).click();
    await cart.getByRole('button',{name:/^Retirada/}).click();
    await cart.getByRole('button',{name:'Pagamento',exact:true}).click();
    await cart.getByRole('button',{name:'Dinheiro',exact:true}).click();
    await cart.getByRole('button',{name:'Contato',exact:true}).click();
    await cart.locator('#btn-confirm-order').click();
    await page.locator('#btn-place-order-final').click();
    await expect(page.getByText('Pedido recebido',{exact:true})).toBeVisible();
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0]).toMatchObject({cliente_nome:'Cliente local',cliente_telefone:'85999999999'});
  });
}
