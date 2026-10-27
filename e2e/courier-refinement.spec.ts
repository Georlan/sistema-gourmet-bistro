import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const API = 'http://127.0.0.1:8000';
test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if (origin !== new URL(baseURL!).origin && origin !== API) return route.abort();
    return route.fallback();
  });
});
const delivery = {
  id:'courier-test-101', numero_pedido:101, cliente_nome:'Ana Oliveira', delivery_telefone:'85999990001',
  delivery_endereco:'Rua dos Ipês, 245 · Centro — Casa azul, portão branco', delivery_taxa:7,delivery_status:'transito',
  total:68.9,valor_pago:0,valor_a_cobrar:68.9,itens_resumo:'2× Hambúrguer, 1× Suco de laranja',criado_em:new Date().toISOString(),
};
const profile = {id:99021,nome:'Lucas',telefone:'85999990000'};
async function fixture(page:Page, deliveries = [delivery]) {
  await page.route(`${API}/**`, route => route.fulfill({json:{motoboy:profile,entregas:deliveries}}));
}
async function open(page:Page) {
  await page.goto('/entregador#token=local-courier-test-secret', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading',{name:'Entregas'})).toBeVisible();
}
test('sessão por aba, links corretos, detalhes sob demanda e confirmação protegida',async({page})=>{
  await fixture(page);
  let posts=0;
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`${API}/comandas/motoboys/pedidos/*/confirmar-entrega`,async route=>{
    expect(route.request().headers()['x-koma-delivery-token']).toBe('local-courier-test-secret');
    posts++;await gate;await route.fulfill({json:{status:'sucesso'}});
  });
  await open(page);
  await expect(page).toHaveURL(/\/entregador$/);
  expect(await page.evaluate(()=>localStorage.getItem('koma_entregador_session_token'))).toBeNull();
  const card=page.getByRole('article',{name:'Pedido 101'});
  const link=card.getByRole('link',{name:/Google Maps/});
  expect(new URL((await link.getAttribute('href'))!).searchParams.get('destination')).toBe(delivery.delivery_endereco);
  await expect(link).toHaveAttribute('target','_blank');
  await expect(link).toHaveAttribute('rel','noopener noreferrer');
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.getByText(delivery.delivery_telefone)).toHaveCount(0);
  await expect(card.getByText(delivery.itens_resumo)).toBeHidden();
  await card.getByRole('button',{name:/Ver pedido|Ver \d+ ite/}).click();
  await expect(page.getByRole('dialog').getByText(delivery.itens_resumo)).toBeVisible();
  await page.getByRole('button',{name:'Voltar às entregas'}).click();
  await card.getByRole('button',{name:/^(Concluir entrega|Confirmar com código)$/}).click();
  expect(posts).toBe(0);
  await expect(page.getByRole('dialog').getByRole('button',{name:'Confirmar',exact:true})).toBeFocused();
  await page.getByRole('dialog').getByRole('button',{name:'Confirmar',exact:true}).press('Escape');
  await expect(card.getByRole('button',{name:/^(Concluir entrega|Confirmar com código)$/})).toBeFocused();
  await card.getByRole('button',{name:/^(Concluir entrega|Confirmar com código)$/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Cancelar'}).click();
  expect(posts).toBe(0);
  await card.getByRole('button',{name:/^(Concluir entrega|Confirmar com código)$/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect.poll(()=>posts).toBe(1);
  await expect(page.getByRole('button',{name:'Confirmando…'})).toBeDisabled();
  release();
  await expect(page.getByRole('heading',{name:'Nenhuma entrega em rota'})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'Entrega confirmada com sucesso.'})).toBeVisible();
});

test('retorno coalesce eventos, não cria polling, refresh mantém dados e acesso revogado apaga dados',async({page})=>{
  let gets=0;let fail=false;let revoked=false;
  await page.route(`${API}/**`, route=>{
    gets++;
    return route.fulfill(revoked?{status:403,json:{detail:'Acesso revogado pelo caixa.'}}:fail?{status:503,json:{detail:'Servidor indisponível.'}}:{json:{motoboy:profile,entregas:[delivery]}});
  });
  await open(page);
  const initial=gets;
  await page.clock.install();
  await page.clock.fastForward(60_000);
  expect(gets).toBe(initial);
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>gets).toBe(initial+1);
  await expect(page.getByRole('button',{name:'Atualizar Pedidos'})).toBeEnabled();
  fail=true;
  await page.getByRole('button',{name:'Atualizar Pedidos'}).click();
  await expect(page.getByRole('alert')).toContainText('Servidor indisponível');
  await expect(page.getByRole('article',{name:'Pedido 101'})).toBeVisible();
  revoked=true;
  await page.getByRole('button',{name:'Atualizar Pedidos'}).click();
  await expect(page.getByText('Acesso revogado pelo caixa.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('timeout e reconciliação falha mantêm confirmação bloqueada até conferir sem segundo POST',async({page})=>{
  let posts=0;let recover=false;
  await page.route(`${API}/**`,route=>{
    if(route.request().method()==='POST'){posts++;return;}
    if(posts && !recover)return route.fulfill({status:503,json:{detail:'Servidor indisponível.'}});
    return route.fulfill({json:{motoboy:profile,entregas:recover?[]:[delivery]}});
  });
  await open(page);
  await page.clock.install();
  await page.getByRole('button',{name:/^(Concluir entrega|Confirmar com código)$/}).click();
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect.poll(()=>posts).toBe(1);
  await page.clock.fastForward(12_100);
  await expect(page.getByRole('button',{name:/^(Concluir entrega|Confirmar com código)$/})).toBeDisabled();
  await expect(page.getByText('Confirmação pendente. Toque em Verificar.')).toBeVisible();
  expect(posts).toBe(1);
  recover=true;
  await page.getByRole('button',{name:'Verificar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Nenhuma entrega em rota'})).toBeVisible();
  expect(posts).toBe(1);
});

for(const theme of ['dark','light'])test(`visual ${theme}: valores e nomes longos, sem filtros redundantes e alvos de toque`,async({page},info)=>{
  await fixture(page,[{...delivery,cliente_nome:'Maria Aparecida de Albuquerque e Vasconcelos',delivery_endereco:'Avenida Governador Raul Barbosa, 13240, Condomínio Jardim das Acácias, bloco 12, apartamento 1204 — portaria lateral',total:12345.67,valor_a_cobrar:12345.67}, {...delivery,id:'paid',numero_pedido:102,cliente_nome:'Marcos',delivery_status:'transito',valor_pago:68.9,valor_a_cobrar:0}]);
  await page.addInitScript(t=>localStorage.setItem('@koma:theme',t),theme);
  await page.emulateMedia({reducedMotion:'reduce'});
  await open(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('[data-koma-logo="wordmark"] img:visible')).toHaveCount(1);
  await expect(page.getByText('Retirada', { exact: true })).toHaveCount(0);
  for(const control of await page.locator('.k-courier button, .k-courier a, .k-courier summary').all()) {
    if(await control.isVisible())expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  if(process.env.KOMA_COURIER_CAPTURE_DIR){await mkdir(process.env.KOMA_COURIER_CAPTURE_DIR,{recursive:true});await page.screenshot({path:join(process.env.KOMA_COURIER_CAPTURE_DIR,`${info.project.name}-${theme}.png`),fullPage:true});}
  await expect(page.getByRole('navigation',{name:'Filtrar entregas'})).toHaveCount(0);
  await expect(page.getByText('Sem cobrança',{exact:true})).toBeVisible();
  await expect(page.getByText('Já Pago via App')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(2);
});

test('endereço e telefone ausentes não geram links vazios; abrir detalhes por teclado',async({page})=>{
  await fixture(page,[{...delivery,delivery_endereco:null as any,delivery_telefone:null as any}]);
  await open(page);
  await expect(page.getByRole('link')).toHaveCount(0);
  const summary=page.getByRole('button',{name:'Ver pedido'});
  await summary.focus();await summary.press('Enter');
  await expect(page.getByText(delivery.itens_resumo)).toBeVisible();
});

test('viagem: sequência persiste no reload, avança após entrega e outro acesso não herda pedidos', async ({page}) => {
  let deliveries = [delivery, {...delivery,id:'second',numero_pedido:102,cliente_nome:'Marcos'}];
  let posts = 0;
  await page.route(`${API}/**`, route => {
    if (route.request().method() === 'POST') { posts++; deliveries = deliveries.filter(item=>item.id !== 'second'); return route.fulfill({json:{status:'sucesso'}}); }
    return route.fulfill({json:{motoboy:profile,entregas:deliveries}});
  });
  await open(page);
  await page.getByRole('button',{name:'Organizar viagem'}).click();
  await page.getByRole('checkbox',{name:/#101/}).check();
  await page.getByRole('checkbox',{name:/#102/}).check();
  await page.getByRole('button',{name:'Antecipar pedido 102'}).click();
  await page.getByRole('button',{name:'Usar sequência'}).click();
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','Pedido 102');
  await expect(page.getByRole('article').first()).toContainText('Próxima entrega');
  expect(posts).toBe(0);
  await page.reload();
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','Pedido 102');
  await page.getByRole('article').first().getByRole('button',{name:/^(Concluir entrega|Confirmar com código)$/}).click();
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','Pedido 101');
  await expect(page.getByRole('article').first()).toContainText('Próxima entrega');
  expect(posts).toBe(1);
  await page.evaluate(()=> { location.hash='token=another-local-courier-secret'; });
  await expect(page.getByRole('button',{name:'Organizar viagem'})).toBeVisible();
  await expect(page.getByText('Próxima entrega')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify(Object.keys(sessionStorage)))).not.toContain('another-local-courier-secret');
});

test('recebimento: campo único numérico, zeros iniciais, erro mantém formulário e Enter confirma', async({page}) => {
  await fixture(page,[{...delivery,requires_delivery_code:true} as any]);
  const codes:string[]=[];
  await page.route(`${API}/comandas/motoboys/pedidos/*/confirmar-entrega`,route=>{
    const code=route.request().postDataJSON().code;codes.push(code);
    return route.fulfill(code==='012'?{json:{status:'sucesso'}}:{status:422,json:{detail:'Código incorreto. Confira os 3 dígitos com o cliente.'}});
  });
  await open(page);
  await page.getByRole('button',{name:/^(Concluir entrega|Confirmar com código)$/}).click();
  const input=page.getByLabel('Código de entrega');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('inputmode','numeric');
  await input.fill('111');await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Código incorreto');
  await expect(input).toBeFocused();
  await input.fill('012');
  expect(codes).toEqual(['111']);
  await input.press('Enter');
  await expect(page.getByRole('heading',{name:'Nenhuma entrega em rota'})).toBeVisible();
  expect(codes).toEqual(['111','012']);
});


test('mesmo com resposta antiga, pronto atribuído não aparece nem permite confirmação',async({page})=>{
  await fixture(page,[delivery,{...delivery,id:'ready-only',numero_pedido:999,cliente_nome:'Aguardando despacho',delivery_status:'pronto'}]);
  await open(page);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Aguardando despacho')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Para sair/})).toHaveCount(0);
});

for (const theme of ['dark','light']) test(`handoff ${theme}: cobrança, troco, origem e observações substituem papel`,async({page},info)=>{
  await page.addInitScript(t=>localStorage.setItem('@koma:theme',t),theme);
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await fixture(page,[{...delivery,
    source:{channel:'caixa',label:'Caixa',references:[]},
    destination:{label:'Rua dos Ipês, 245, Centro, Fortaleza, CE',complement:'Casa azul · portão lateral',reference:'Em frente à praça',route_query:'Rua dos Ipês, 245, Centro, Fortaleza, CE'},
    payment:{status:'collect',method:'cash',amount_due:68.9,change_for:100,change_amount:31.1,change_needs_check:false},
    items:[{name:'Hambúrguer artesanal',quantity:2,notes:'Sem cebola',modifiers:['Queijo extra']},{name:'Suco de laranja',quantity:1,notes:null,modifiers:[]}],
    confirmation:{mode:'koma_code',enabled:true,code_length:3,reason:null},requires_delivery_code:true,
  } as any]);
  await open(page);
  const payment=page.getByRole('region',{name:'Pagamento da entrega'});
  await expect(payment).toContainText('68,90');
  await expect(payment).toContainText('31,10');
  await expect(payment).toContainText('Paga com');
  await expect(payment).toContainText('dinheiro');
  await expect(page.locator('.k-courier__reference')).toContainText('Em frente à praça');
  await expect(page.getByText('Casa azul · portão lateral')).toBeVisible();
  await expect(page.getByText('Já recebido',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Copiar endereço/})).toHaveCount(0);
  expect(new URL((await page.getByRole('link',{name:/Google Maps/}).getAttribute('href'))!).searchParams.get('destination')).not.toContain('praça');
  await page.getByRole('button',{name:/Ver pedido|Ver \d+ ite/}).click();
  await expect(page.getByText('Sem cebola',{exact:true})).toBeVisible();
  await expect(page.getByText('Queijo extra',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(process.env.KOMA_COURIER_CAPTURE_DIR){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(process.env.KOMA_COURIER_CAPTURE_DIR,`${info.project.name}-handoff-${theme}.png`),fullPage:true});}
});

test('pago não cobra de novo; cartão tem identificação própria; referência de parceiro não simula conclusão',async({page})=>{
  const base={status:'paid',method:'pix',amount_due:0,change_for:null,change_amount:null,change_needs_check:false};
  await fixture(page,[{...delivery,id:'paid-online',payment:base} as any,
    {...delivery,id:'card',numero_pedido:102,payment:{...base,status:'collect',method:'card',amount_due:68.9}} as any,
    {...delivery,id:'partner',numero_pedido:103,source:{channel:'ifood',label:'iFood',references:[{provider:'ifood',reference:'external-order-demo'}]},payment:base,confirmation:{mode:'partner_pending',enabled:false,code_length:null,reason:'A conclusão com este parceiro ainda não está conectada. Confira com o Caixa.'}} as any]);
  await open(page);
  await expect(page.getByRole('article',{name:'Pedido 101'})).toContainText('Não cobrar');
  await expect(page.getByRole('article',{name:'Pedido 102'})).toContainText('Cobrar no cartão');
  const partner=page.getByRole('article',{name:'Pedido 103'});
  await expect(partner.getByRole('img',{name:'iFood',exact:true})).toBeVisible();
  await expect(partner.getByRole('button',{name:/^(Concluir entrega|Confirmar com código)$/})).toBeDisabled();
  await expect(partner).toContainText('Confirmação: confira no Caixa.');
});


test('logos oficiais dos parceiros são locais, carregam e preservam a proporção',async({page})=>{
  const channels=[['ifood','iFood'],['99food','99Food'],['keeta','Keeta']];
  await fixture(page,channels.map(([channel,label],i)=>({...delivery,id:`brand-${channel}`,numero_pedido:301+i,source:{channel,label,references:[]}} as any)));
  await open(page);
  for(const [,label] of channels){
    const logo=page.getByRole('img',{name:label,exact:true});
    await expect(logo).toBeVisible();
    await expect.poll(()=>logo.evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
    const src=await logo.getAttribute('src');
    expect(src?.startsWith('data:image/png') || new URL(src!,page.url()).origin===new URL(page.url()).origin).toBe(true);
    expect(await logo.evaluate(img=>getComputedStyle(img).objectFit)).toBe('contain');
  }
  await expect(page.getByText('Em rota',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Organize as entregas da viagem',{exact:true})).toHaveCount(0);
});


test('selo KÔMA identifica pedidos próprios sem substituir marcas externas',async({page})=>{
  await fixture(page,['caixa','cardapio','koma'].map((channel,i)=>({...delivery,id:`native-${channel}`,numero_pedido:401+i,source:{channel,label:channel==='caixa'?'Caixa':channel==='cardapio'?'Cardápio':'KÔMA',references:[]}} as any)));
  await open(page);
  for(const number of [401,402,403]){
    const card=page.getByRole('article',{name:`Pedido ${number}`,exact:true});
    const logo=card.getByRole('img',{name:'KÔMA',exact:true});
    await expect(logo).toBeVisible();
    await expect.poll(()=>logo.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
    await expect(card.locator('[data-koma-native=true]')).toHaveAttribute('title',/Pedido KÔMA/);
  }
});

test('sem rede mantém endereço e sequência; reconecta antes do throttle e não repete confirmação', async ({ page }, info) => {
  let gets = 0, posts = 0;
  await page.route(`${API}/**`, route => {
    if (route.request().method() === 'POST') { posts++; return route.fulfill({ json: { status: 'sucesso' } }); }
    gets++;
    return route.fulfill({ json: { motoboy: profile, entregas: [delivery] } });
  });
  await open(page);
  await page.getByRole('button', { name: /^(Concluir entrega|Confirmar com código)$/ }).click();
  const initial = gets;
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.getByRole('status').filter({ hasText: 'Sem conexão · entregas mantidas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Atualizar Pedidos' })).toBeDisabled();
  await expect(page.getByText(delivery.delivery_endereco)).toBeVisible();
  await expect(page.getByRole('link', { name: /Google Maps/ })).toBeVisible();
  expect(posts).toBe(0);
  if (process.env.KOMA_COURIER_CAPTURE_DIR) {
    await mkdir(process.env.KOMA_COURIER_CAPTURE_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.KOMA_COURIER_CAPTURE_DIR, `${info.project.name}-offline.png`), fullPage: true });
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => gets).toBe(initial + 1);
  await expect(page.getByRole('button', { name: 'Confirmar', exact: true })).toBeEnabled();
  expect(posts).toBe(0);
});

test('falha de atualização fica indicada após o toast; reconexão retira pedido reatribuído', async ({ page }) => {
  let fail = false, reassigned = false;
  await page.route(`${API}/**`, route => route.fulfill(fail
    ? { status: 503, json: { detail: 'Servidor indisponível.' } }
    : { json: { motoboy: profile, entregas: reassigned ? [] : [delivery] } }));
  await open(page);
  await page.clock.install();
  fail = true;
  await page.getByRole('button', { name: 'Atualizar Pedidos' }).click();
  await expect(page.getByRole('alert')).toContainText('Servidor indisponível');
  await page.clock.fastForward(5100);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Atualização pendente' })).toBeVisible();
  fail = false; reassigned = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('heading', { name: 'Nenhuma entrega em rota' })).toBeVisible();
  await expect(page.getByText('Atualização pendente', { exact: false })).toHaveCount(0);
});


test('reconexão durante leitura antiga aguarda e confere uma vez, sem requisições paralelas', async ({ page }) => {
  let gets = 0, active = 0, maxActive = 0, holdNext = false, reassigned = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${API}/**`, async route => {
    gets++; active++; maxActive = Math.max(maxActive, active);
    const deliveries = reassigned ? [] : [delivery];
    if (holdNext) { holdNext = false; await gate; }
    active--;
    return route.fulfill({ json: { motoboy: profile, entregas: deliveries } });
  });
  await open(page);
  // StrictMode may abort an initial request; count only the loaded session.
  const initial = gets;
  active = 0; maxActive = 0; holdNext = true;
  await page.getByRole('button', { name: 'Atualizar Pedidos' }).click();
  await expect.poll(() => gets).toBe(initial + 1);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  expect(gets).toBe(initial + 1);
  reassigned = true;
  release();
  await expect(page.getByRole('heading', { name: 'Nenhuma entrega em rota' })).toBeVisible();
  expect(gets).toBe(initial + 2);
  expect(maxActive).toBe(1);
});


test('Enter no código respeita a conferência em andamento antes de concluir', async ({ page }) => {
  let holdNext = false, posts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${API}/**`, async route => {
    if (route.request().method() === 'POST') { posts++; return route.fulfill({ json: { status: 'sucesso' } }); }
    if (holdNext) { holdNext = false; await gate; }
    return route.fulfill({ json: { motoboy: profile, entregas: [{ ...delivery, requires_delivery_code: true }] } });
  });
  await open(page);
  await page.getByRole('button', { name: /^(Concluir entrega|Confirmar com código)$/ }).click();
  const input = page.getByLabel('Código de entrega');
  await input.fill('012');
  holdNext = true;
  await page.clock.install();
  await page.clock.fastForward(15_100);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Confirmar', exact: true })).toBeDisabled();
  await input.press('Enter');
  expect(posts).toBe(0);
  release();
  await expect(page.getByRole('button', { name: 'Confirmar', exact: true })).toBeEnabled();
  await expect(input).toHaveValue('012');
  await input.press('Enter');
  await expect.poll(() => posts).toBe(1);
  await expect(page.getByRole('heading', { name: 'Nenhuma entrega em rota' })).toBeVisible();
});

test('painéis contêm foco, retornam à ação e não fazem leituras extras; pago também exige código', async ({page}) => {
  let gets = 0, posts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const paid = {...delivery, requires_delivery_code:true, payment:{status:'paid',method:'pix',amount_due:0,change_for:null,change_amount:null,change_needs_check:false}, items:[{name:'Hambúrguer',quantity:2,notes:'Sem cebola',modifiers:['Queijo extra']}]};
  await page.route(`${API}/**`, async route => {
    if (route.request().method() === 'POST') { posts++; expect(route.request().postDataJSON()).toEqual({code:'012'}); await gate; return route.fulfill({json:{status:'sucesso'}}); }
    gets++; return route.fulfill({json:{motoboy:profile,entregas:[paid]}});
  });
  await open(page);
  const baseline = gets;
  const items = page.getByRole('button',{name:'Ver 2 itens'});
  await items.focus(); await items.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Sem cebola')).toBeVisible();
  await expect(dialog.getByText('Queijo extra')).toBeVisible();
  for (let i=0;i<5;i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(()=>document.activeElement?.closest('dialog') !== null)).toBe(true); }
  await page.keyboard.press('Escape'); await expect(items).toBeFocused();
  await items.click();
  await dialog.getByText('Sem cebola').click();
  await expect(dialog).toBeVisible();
  const bounds = (await dialog.boundingBox())!;
  const outside = {x: 2, y: 2};
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(outside.x, outside.y);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(outside.x, outside.y);
  await expect(dialog).toHaveCount(0);
  await expect(items).toBeFocused();
  expect(posts).toBe(0); expect(gets).toBe(baseline);
  const confirm = page.getByRole('button',{name:'Confirmar com código'});
  await confirm.click();
  const input = page.getByLabel('Código de entrega');
  await expect(input).toBeFocused(); await expect(dialog.getByText('Não cobrar')).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Confirmar',exact:true})).toBeDisabled();
  await input.fill('01'); await input.press('Enter'); expect(posts).toBe(0);
  await input.fill('012'); expect(posts).toBe(0); expect(gets).toBe(baseline);
  await input.press('Enter'); await expect.poll(()=>posts).toBe(1);
  await expect(dialog.getByRole('button', {name:'Confirmando…'})).toBeDisabled();
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  expect(posts).toBe(1);
  release();
  await expect(page.getByRole('heading',{name:'Nenhuma entrega em rota'})).toBeVisible();
});

test('pedido antigo conserva quatro números e pedido externo permite conclusão apenas interna', async ({page}) => {
  await fixture(page, [
    {...delivery,requires_delivery_code:true,confirmation:{mode:'koma_code',enabled:true,code_length:4,reason:null}} as any,
    {...delivery,id:'external-local',numero_pedido:105,source:{channel:'keeta',label:'Keeta',references:[]},payment:{status:'paid',method:'pix',amount_due:0},confirmation:{mode:'local_internal',enabled:true,code_length:null,reason:null}} as any,
  ]);
  await open(page);
  await page.getByRole('article',{name:'Pedido 101'}).getByRole('button',{name:'Confirmar com código'}).click();
  const input=page.getByLabel('Código de entrega');
  await expect(input).toHaveAttribute('maxlength','4');
  await input.fill('001');
  await expect(page.getByRole('button',{name:'Confirmar',exact:true})).toBeDisabled();
  await input.fill('0012');
  await expect(page.getByRole('button',{name:'Confirmar',exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('article',{name:'Pedido 105'}).getByRole('button',{name:'Concluir entrega'}).click();
  await expect(page.getByRole('dialog').getByText('Não cobrar')).toBeVisible();
  await expect(page.getByRole('button',{name:'Confirmar',exact:true})).toBeEnabled();
});

test('link abre com armazenamento de sessão bloqueado e não expõe a credencial na URL', async ({page}) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (this === window.sessionStorage) throw new DOMException('Blocked','SecurityError'); return get.call(this,key); };
    Storage.prototype.setItem = function(key,value) { if (this === window.sessionStorage) throw new DOMException('Blocked','SecurityError'); set.call(this,key,value); };
  });
  await fixture(page);
  await open(page);
  await expect(page.getByRole('article',{name:'Pedido 101'})).toBeVisible();
  await expect(page).toHaveURL(/\/entregador$/);
  expect(await page.evaluate(()=>JSON.stringify(Object.values(localStorage)))).not.toContain('local-courier-test-secret');
});

test('retorno do Google Maps após >12s com GET pendente na suspensão não exibe falso timeout, coalesce eventos + WebSocket e reconcilia entregas', async ({ page }) => {
  let gets = 0;
  let holdPendingGet = false;
  let updatedAfterMaps = false;
  const activeSockets: any[] = [];

  await page.routeWebSocket('**/ws/entregador', ws => {
    activeSockets.push(ws);
    ws.onMessage(message => {
      if (message === 'ping') ws.send(JSON.stringify({ event: 'pong' }));
    });
    ws.send(JSON.stringify({ event: 'courier_ready' }));
  });

  await page.route(`${API}/**`, async route => {
    gets++;
    if (holdPendingGet) {
      // Simula GET que ficou pendurada exatamente quando o usuário tocou em Maps e o Chrome foi suspenso
      await new Promise<void>(() => {});
      return;
    }
    const items = updatedAfterMaps
      ? [{ ...delivery, cliente_nome: 'Georlan (Atualizado)', valor_a_cobrar: 35.9 }]
      : [delivery];
    return route.fulfill({ json: { motoboy: profile, entregas: items } });
  });

  await open(page);
  await page.clock.install();
  // Aguarda estabilizar a leitura inicial e o handshake inicial do WebSocket
  await page.clock.fastForward(300);
  await expect(page.getByRole('button', { name: 'Atualizar Pedidos' })).toBeEnabled();

  // 1. Dispara uma consulta GET que fica pendente no exato momento em que o entregador abre o Maps
  holdPendingGet = true;
  await page.getByRole('button', { name: 'Atualizar Pedidos' }).click();
  const getsAtSuspend = gets;

  // 2. Simula ida para o app do Google Maps (visibilityState = 'hidden' + pagehide)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });

  // 3. Permanece mais de 12 segundos no Google Maps (ex.: 25 segundos)
  await page.clock.fastForward(25_000);

  // Nenhum alerta falso de timeout deve aparecer por causa do cancelamento intencional na suspensão
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('O painel demorou demais para responder. Tente novamente.')).toHaveCount(0);

  // 4. Ao retornar do Maps para o Chrome Android, múltiplos eventos disparam simultaneamente junto à reconexão do WebSocket
  holdPendingGet = false;
  updatedAfterMaps = true;
  const socketsBeforeResume = activeSockets.length;

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
  });

  // Avança o debounce de 200ms do courier_ready da reconexão do WebSocket
  await page.clock.fastForward(350);

  // O WebSocket reconectou ao voltar para o primeiro plano, mas o retorno fez exatamente 1 GET consolidada
  expect(activeSockets.length).toBeGreaterThan(socketsBeforeResume);
  await expect(page.getByText('Georlan (Atualizado)')).toBeVisible();
  expect(gets).toBe(getsAtSuspend + 1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('timeout real de 12s em primeiro plano exibe alerta apropriado e preserva entregas visíveis', async ({ page }) => {
  let hangRefresh = false;
  await page.route(`${API}/**`, async route => {
    if (hangRefresh) {
      await new Promise<void>(() => {});
      return;
    }
    return route.fulfill({ json: { motoboy: profile, entregas: [delivery] } });
  });

  await open(page);
  await page.clock.install();
  hangRefresh = true;
  await page.getByRole('button', { name: 'Atualizar Pedidos' }).click();

  await page.clock.fastForward(12_100);
  await expect(page.getByRole('alert')).toContainText('O painel demorou demais para responder. Tente novamente.');
  await expect(page.getByRole('article', { name: 'Pedido 101' })).toBeVisible();
});

test('suspensão e retorno durante confirmação de entrega em voo nunca repete o POST automaticamente', async ({ page }) => {
  let posts = 0;
  let releasePost!: () => void;
  const postGate = new Promise<void>(resolve => { releasePost = resolve; });
  let delivered = false;

  await page.route(`${API}/**`, async route => {
    if (route.request().method() === 'POST') {
      posts++;
      await postGate;
      delivered = true;
      return route.fulfill({ json: { status: 'sucesso' } });
    }
    return route.fulfill({ json: { motoboy: profile, entregas: delivered ? [] : [delivery] } });
  });

  await open(page);
  await page.clock.install();
  await page.getByRole('button', { name: /^(Concluir entrega|Confirmar com código)$/ }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect.poll(() => posts).toBe(1);

  // Usuário alterna para outro app e retorna enquanto o POST ainda está em andamento
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(5_000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('focus'));
  });

  expect(posts).toBe(1);
  releasePost();
  await expect(page.getByRole('heading', { name: 'Nenhuma entrega em rota' })).toBeVisible();
  expect(posts).toBe(1);
});

