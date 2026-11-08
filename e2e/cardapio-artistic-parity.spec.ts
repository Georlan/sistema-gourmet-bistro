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


test('sacola usa o mesmo card de família nativa, exige tamanho e conserva preço por SKU', async ({ page }) => {
  await menu(page, payload => {
    payload.categorias.push({ id: 30, nome: 'Batatas Fritas' });
    payload.produtos.push(
      { id: 'b200', nome: 'Batata Tradicional 200g', descricao: 'Porção de 200 g', preco: 12,
        categoria_id: 30, imagem_url: '', familia_id: 'f-batatas',
        familia_nome: 'Batata Tradicional', familia_eixo: 'tamanho', variacao_rotulo: '200 g',
        grupos_modificadores: [] },
      { id: 'b400', nome: 'Batata Tradicional 400g', descricao: 'Porção de 400 g', preco: 18,
        categoria_id: 30, imagem_url: '', familia_id: 'f-batatas',
        familia_nome: 'Batata Tradicional', familia_eixo: 'tamanho', variacao_rotulo: '400 g',
        grupos_modificadores: [] },
    );
  });
  await page.locator('#btn-fast-add-301').click();
  await page.locator('#btn-cart-header').click();
  const cart = page.locator('#cart-drawer-container');
  await expect(cart).toBeVisible();
  const family = cart.locator('#upsell-card-family-f-batatas');
  await expect(family).toBeVisible();
  await expect(family).toContainText('Batata Tradicional');
  await expect(family).toContainText('A partir de R$ 12,00');
  await expect(cart.locator('#upsell-card-b200')).toHaveCount(0);
  await expect(cart.locator('#upsell-card-b400')).toHaveCount(0);
  await family.locator('#btn-upsell-add-family-f-batatas').click();
  const modal = page.locator('#product-details-modal');
  await expect(modal).toBeVisible();
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal).toContainText('Escolha o tamanho antes de adicionar');
  await modal.locator('#variant-btn-b400').click();
  await expect(modal.locator('#btn-add-to-cart-action')).toContainText('R$ 18,00');
});

test('logo da loja mantém avatar circular sem moldura branca no cabeçalho e no painel', async ({ page }) => {
  const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#101010"/><circle cx="32" cy="32" r="24" fill="#ffd12b"/></svg>';
  await menu(page, payload => {
    payload.restaurante.logo_url = `data:image/svg+xml,${encodeURIComponent(logoSvg)}`;
  });

  const headerLogo = page.locator('.koma-art-brand-logo');
  await expect(headerLogo).toBeVisible();
  const headerStyle = await headerLogo.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, radius: style.borderRadius, fit: style.objectFit };
  });
  expect(headerStyle).toEqual({ background: 'rgba(0, 0, 0, 0)', radius: '50%', fit: 'contain' });

  await page.locator('#header-brand-info-trigger').click();
  const avatar = page.locator('#store-info-brand-avatar');
  await expect(avatar).toBeVisible();
  const avatarStyle = await avatar.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, overflow: style.overflow, padding: style.padding, radius: style.borderRadius };
  });
  expect(avatarStyle.background).not.toBe('rgb(255, 255, 255)');
  expect(avatarStyle.overflow).toBe('hidden');
  expect(avatarStyle.padding).toBe('0px');
  expect(parseFloat(avatarStyle.radius)).toBeGreaterThan(20);
  const logo = avatar.locator('img');
  await expect(logo).toHaveAttribute('alt', 'Pizzeria Bella Italia');
  expect(await logo.evaluate((element) => getComputedStyle(element).objectFit)).toBe('contain');
});

test('link de rota usa Google Maps quando cadastrado somente o Plus Code', async ({ page }) => {
  await menu(page, payload => {
    payload.restaurante.google_maps_url = 'Q4H9+CQ, Limoeiro do Norte - CE, 62930-000';
  });
  await page.locator('#header-brand-info-trigger').click();
  const mapsLink = page.locator('#btn-google-maps-link');
  await expect(mapsLink).toBeVisible();
  await expect(mapsLink).toHaveAttribute(
    'href',
    'https://www.google.com/maps/dir/?api=1&destination=Q4H9%2BCQ%2C%20Limoeiro%20do%20Norte%20-%20CE%2C%2062930-000',
  );
  await expect(mapsLink).toHaveAttribute('target', '_blank');
});

test('batata tradicional usa um único card com tamanho obrigatório na categoria e na sugestão', async ({ page }) => {
  await menu(page, payload => {
    payload.restaurante.id = 1;
    payload.categorias.push({ id: 30, nome: 'Batatas Fritas' });
    payload.produtos.push(
      { id: 'batata-p', nome: 'Batata Frita Pequena (200 g)', descricao: 'Com molho rosé', preco: 12, categoria_id: 30, imagem_url: '', grupos_modificadores: [] },
      { id: 'batata-m', nome: 'Batata Frita Média (300 g)', descricao: 'Com molho rosé', preco: 15, categoria_id: 30, imagem_url: '', grupos_modificadores: [] },
      { id: 'batata-g', nome: 'Batata Frita Grande (400 g)', descricao: 'Com molho rosé', preco: 18, categoria_id: 30, imagem_url: '', grupos_modificadores: [] },
      { id: 'especial', nome: 'Batata Frita Especial (300 g)', descricao: 'Escolha bacon ou calabresa', preco: 24, categoria_id: 30, imagem_url: '', grupos_modificadores: [] },
    );
  });
  const catalog = page.locator('[data-menu-category="Batatas Fritas"]');
  await expect(catalog.locator('[id^="product-card-"]')).toHaveCount(2);
  await expect(catalog.locator('#product-card-family-batata-tradicional')).toContainText('A partir de R$');
  await expect(page.locator('#pairing-card-family-batata-tradicional')).toBeVisible();

  await page.locator('#pairing-card-family-batata-tradicional').click();
  const modal = page.locator('#product-details-modal');
  await expect(modal).toContainText('Batata Frita Tradicional');
  await expect(modal.locator('#variant-btn-batata-p')).toContainText('Pequena · 200 g');
  await expect(modal.locator('#variant-btn-batata-m')).toContainText('Média · 300 g');
  await expect(modal.locator('#variant-btn-batata-g')).toContainText('Grande · 400 g');
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal).toContainText('Escolha o tamanho antes de adicionar');
  await modal.locator('#variant-btn-batata-m').click();
  await expect(modal.locator('#btn-add-to-cart-action')).toContainText('R$ 15,00');
  await modal.locator('#btn-close-modal').click();

  await catalog.locator('#product-card-family-batata-tradicional').click();
  await expect(modal).toContainText('Escolha o tamanho:');
  await modal.locator('#variant-btn-batata-g').click();
  await expect(modal.locator('#btn-add-to-cart-action')).toContainText('R$ 18,00');
});

test('destaque da batata abre o mesmo seletor sem fast-add de produto sintético', async ({ page }) => {
  await menu(page, payload => {
    payload.restaurante.id = 1;
    payload.produtos = payload.produtos.filter((product: any) => product.id !== 201);
    payload.categorias.push({ id: 30, nome: 'Batatas Fritas' });
    payload.produtos.push(
      { id: 201, nome: 'Batata Frita Pequena (200 g)', descricao: 'Com molho rosé', preco: 12, categoria_id: 30, imagem_url: '', grupos_modificadores: [] },
      { id: 'batata-m', nome: 'Batata Frita Média (300 g)', descricao: 'Com molho rosé', preco: 15, categoria_id: 30, imagem_url: '', grupos_modificadores: [] },
      { id: 'batata-g', nome: 'Batata Frita Grande (400 g)', descricao: 'Com molho rosé', preco: 18, categoria_id: 30, imagem_url: '', grupos_modificadores: [] },
    );
  });
  const hero = page.locator('#koma-art-hero-showcase');
  await expect(hero).toContainText('Batata Frita Tradicional');
  await hero.locator('#btn-hero-fast-add-family-batata-tradicional').click();
  const modal = page.locator('#product-details-modal');
  await expect(modal).toContainText('Escolha o tamanho:');
  await modal.locator('#variant-btn-batata-g').click();
  await expect(modal.locator('#btn-add-to-cart-action')).toContainText('R$ 18,00');
});

test('pastel médio e pastelão oferecem somente sabores com preço correspondente', async ({ page }) => {
  await menu(page, payload => {
    payload.restaurante.id = 1;
    payload.categorias.push({ id: 40, nome: 'Pastelões e Pastel Médio' });
    payload.produtos.push(
      { id: 'pastel-m-sol', nome: 'Pastel Médio de Carne de Sol', descricao: 'Carne de sol, queijo e catupiry', preco: 7, categoria_id: 40, imagem_url: '', grupos_modificadores: [] },
      { id: 'pastel-m-frango', nome: 'Pastel Médio de Frango', descricao: 'Frango, catupiry e queijo', preco: 7, categoria_id: 40, imagem_url: '', grupos_modificadores: [] },
      { id: 'pastel-g-sol', nome: 'Pastelão de Carne de Sol', descricao: 'Carne de sol, queijo e catupiry', preco: 17, categoria_id: 40, imagem_url: '', grupos_modificadores: [] },
      { id: 'pastel-g-frango', nome: 'Pastelão de Frango', descricao: 'Frango, catupiry e queijo', preco: 16, categoria_id: 40, imagem_url: '', grupos_modificadores: [] },
    );
  });
  const catalog = page.locator('[data-menu-category="Pastelões e Pastel Médio"]');
  await expect(catalog.locator('[id^="product-card-"]')).toHaveCount(2);
  await catalog.locator('#product-card-family-pastelao').click();
  const modal = page.locator('#product-details-modal');
  await expect(modal).toContainText('Pastelão');
  await expect(modal).toContainText('Escolha o sabor:');
  await expect(modal).not.toContainText('Tamanho');
  await modal.locator('#btn-add-to-cart-action').click();
  await expect(modal).toContainText('Escolha o sabor antes de adicionar');
  await modal.locator('#variant-btn-pastel-g-sol').click();
  await expect(modal.locator('#btn-add-to-cart-action')).toContainText('R$ 17,00');
  await modal.locator('#btn-close-modal').click();
  await catalog.locator('#product-card-family-pastel-medio').click();
  await expect(modal).toContainText('Pastel Médio');
  await modal.locator('#variant-btn-pastel-m-frango').click();
  await expect(modal.locator('#btn-add-to-cart-action')).toContainText('R$ 7,00');
});

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

test('contato preserva foco quando a navegação chega atrasada',async({page})=>{
  await menu(page);
  await page.locator('#btn-fast-add-201').click();
  if(!await page.locator('#cart-drawer-container').isVisible())await page.locator('#btn-cart-header').click();
  await page.evaluate(()=>{
    const state=window as any;
    state.__komaFocusFrames=[];
    state.__komaOriginalFrame=window.requestAnimationFrame;
    window.requestAnimationFrame=callback=>{state.__komaFocusFrames.push(callback);return state.__komaFocusFrames.length;};
  });
  await page.locator('#cart-drawer-container').getByRole('button',{name:'Contato',exact:true}).click();
  await page.locator('#input-guest-phone').fill('85999999999');
  await expect(page.locator('#input-guest-phone')).toBeFocused();
  await page.evaluate(()=>{
    const state=window as any;
    window.requestAnimationFrame=state.__komaOriginalFrame;
    for(const callback of state.__komaFocusFrames.splice(0))callback(performance.now());
  });
  await expect(page.locator('#input-guest-phone')).toBeFocused();
  await page.locator('#input-guest-name').fill('Cliente local');
  await expect(page.locator('#input-guest-phone')).toHaveValue('(85) 99999-9999');
});
