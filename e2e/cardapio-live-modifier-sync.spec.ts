import {expect, test} from '@playwright/test';
import {publicMenuPayload} from './fixtures/menu-parity';

for (const variant of ['editorial', 'artistic-total']) {
  test(`${variant}: montagem aberta acompanha pausa e preço sem perder escolhas válidas`, async ({page}) => {
    const payload:any = structuredClone(publicMenuPayload);
    payload.produtos[0] = {id:101,nome:'Quentinha G',preco:14,categoria_id:10,marmitaria:true,grupos_modificadores:[
      {id:'protein',nome:'Proteínas',min_selecoes:2,max_selecoes:2,modo_selecao:'porcoes',tipo:'obrigatorio',opcoes:[
        {id:'chicken',nome:'Frango',ativo:true,preco_adicional:0},
        {id:'beef',nome:'Carne',ativo:true,preco_adicional:0},
      ]},
      {id:'extras',nome:'Adicionais pagos',grupo_origem_id:'protein',min_selecoes:0,max_selecoes:20,modo_selecao:'porcoes',tipo:'opcional',opcoes:[
        {id:'extra-chicken',nome:'Frango adicional',ativo:true,preco_adicional:5},
      ]},
    ]};
    let reads=0;
    let writes=0;
    const sockets:Array<{send:(data:string)=>void}>=[];
    await page.routeWebSocket('**/ws/cliente**',socket=>{sockets.push(socket);});
    await page.route('http://127.0.0.1:8000/**',route=>{
      if(route.request().method()!=='GET'){writes++;return route.abort();}
      if(new URL(route.request().url()).pathname.endsWith('/public')){reads++;return route.fulfill({json:payload});}
      return route.fulfill({json:{produtos:[]}});
    });
    await page.goto(`/cardapio?restaurante_id=2&vitrine=${variant}`);
    await page.getByRole('button',{name:'Quentinha G, R$ 14,00, ver detalhes',exact:true}).click();
    const modal=page.locator('#product-details-modal');
    await modal.getByRole('button',{name:'Adicionar uma unidade de Frango',exact:true}).click();
    await modal.getByRole('button',{name:'Adicionar uma unidade de Carne',exact:true}).click();
    await modal.getByRole('button',{name:/Adicionais pagos/}).click();
    await modal.getByRole('button',{name:'Adicionar uma unidade de Frango adicional',exact:true}).click();
    const notes=modal.locator('textarea');
    await notes.fill('Sem cebola');
    await modal.getByRole('button',{name:'Aumentar quantidade',exact:true}).click();
    await expect(modal.locator('#btn-add-to-cart-action')).toContainText('38,00');
    await expect.poll(()=>sockets.length).toBe(1);

    // A mesma notificação usada pelo Caixa atualiza o catálogo público.
    payload.produtos[0].preco=15;
    payload.produtos[0].grupos_modificadores[0].opcoes=payload.produtos[0].grupos_modificadores[0].opcoes.filter((o:any)=>o.id!=='chicken');
    payload.produtos[0].grupos_modificadores[1].opcoes=[];
    sockets[0].send(JSON.stringify({event:'catalog_updated'}));
    await expect.poll(()=>reads).toBe(2);
    await expect(modal.getByRole('button',{name:'Adicionar uma unidade de Frango',exact:true})).toHaveCount(0);
    await expect(modal.getByRole('button',{name:'Adicionar uma unidade de Frango adicional',exact:true})).toHaveCount(0);
    await expect(modal.getByLabel('1 unidade(s) de Carne',{exact:true})).toBeVisible();
    await expect(notes).toHaveValue('Sem cebola');
    await expect(modal.locator('#btn-add-to-cart-action')).toContainText('30,00');
    await expect(modal.getByRole('alert')).toContainText('Algumas opções não estão mais disponíveis');
    await modal.locator('#btn-add-to-cart-action').click();
    await expect(modal.getByRole('alert')).toContainText('Confira as escolhas em Proteínas');
    await modal.getByRole('button',{name:'Adicionar uma unidade de Carne',exact:true}).click();

    // Refresh sem nova mudança não pode apagar a montagem ainda em andamento.
    sockets[0].send(JSON.stringify({event:'catalog_updated'}));
    await expect.poll(()=>reads).toBe(3);
    await expect(modal.getByLabel('2 unidade(s) de Carne',{exact:true})).toBeVisible();
    await expect(notes).toHaveValue('Sem cebola');
    await modal.locator('#btn-add-to-cart-action').click();
    await expect(modal).toHaveCount(0);
    if(!await page.locator('#cart-drawer-container').isVisible())await page.locator('#btn-cart-header').click();
    const cart=page.locator('#cart-drawer-container');
    await expect(cart.locator('#cart-items')).toContainText('2× Quentinha G');
    await expect(cart.locator('#cart-items')).toContainText('Carne');
    await expect(cart.locator('#cart-items')).not.toContainText('Frango');
    expect(writes).toBe(0);
  });
}

for (const variant of ['editorial', 'artistic-total']) {
  test(`${variant}: produto pausado encerra edição sem substituir a sacola ao adicionar outro`, async ({page}) => {
    const payload:any=structuredClone(publicMenuPayload);
    let socket:{send:(data:string)=>void}|undefined;
    let reads=0;
    await page.routeWebSocket('**/ws/cliente**',peer=>{socket=peer;});
    await page.route('http://127.0.0.1:8000/**',route=>{
      if(route.request().method()!=='GET')return route.abort();
      if(new URL(route.request().url()).pathname.endsWith('/public')){reads++;return route.fulfill({json:payload});}
      return route.fulfill({json:{produtos:[]}});
    });
    await page.goto(`/cardapio?restaurante_id=2&vitrine=${variant}`);
    await page.getByRole('button',{name:/Pizza Margherita Especial.*ver detalhes/}).click();
    const modal=page.locator('#product-details-modal');
    await modal.getByRole('checkbox',{name:'Selecionar Catupiry',exact:true}).check();
    await modal.locator('#btn-add-to-cart-action').click();
    if(!await page.locator('#cart-drawer-container').isVisible())await page.locator('#btn-cart-header').click();
    const cart=page.locator('#cart-drawer-container');
    await cart.getByRole('button',{name:'Editar montagem de Pizza Margherita Especial',exact:true}).click();
    await expect(modal).toBeVisible();
    await expect.poll(()=>Boolean(socket)).toBe(true);
    payload.produtos=payload.produtos.filter((p:any)=>p.id!==101);
    socket!.send(JSON.stringify({event:'catalog_updated'}));
    await expect.poll(()=>reads).toBe(2);
    await expect(modal).toHaveCount(0);
    // A retirada do catálogo não apaga a sacola e não deixa uma edição órfã.
    if(await cart.isVisible())await page.locator('#btn-close-cart').click();
    await page.getByRole('button',{name:'Adicionar Vinho Tinto Sangiovese (Taça) à sacola',exact:true}).click();
    if(!await cart.isVisible())await page.locator('#btn-cart-header').click();
    await expect(cart.locator('#cart-items')).toContainText('Pizza Margherita Especial');
    await expect(cart.locator('#cart-items')).toContainText('Vinho Tinto');
  });
}
