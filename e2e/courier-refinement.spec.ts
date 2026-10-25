import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const API = 'http://127.0.0.1:8000';
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
  await page.goto('/entregador#token=local-courier-test-secret');
  await expect(page.getByRole('heading',{name:'Suas entregas'})).toBeVisible();
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
  const link=card.getByRole('link',{name:/Abrir rota/});
  expect(new URL((await link.getAttribute('href'))!).searchParams.get('destination')).toBe(delivery.delivery_endereco);
  await expect(card.getByRole('link',{name:'Ligar para Ana Oliveira'})).toHaveAttribute('href','tel:5585999990001');
  await expect(card.getByText(delivery.itens_resumo)).toBeHidden();
  await card.locator('summary').click();
  await expect(card.getByText(delivery.itens_resumo)).toBeVisible();
  await card.getByRole('button',{name:'Concluir entrega'}).click();
  expect(posts).toBe(0);
  await expect(card.getByRole('button',{name:'Confirmar entrega',exact:true})).toBeFocused();
  await card.getByRole('button',{name:'Confirmar entrega',exact:true}).press('Escape');
  await expect(card.getByRole('button',{name:'Concluir entrega'})).toBeFocused();
  await card.getByRole('button',{name:'Concluir entrega'}).click();
  await card.getByRole('button',{name:'Voltar'}).click();
  expect(posts).toBe(0);
  await card.getByRole('button',{name:'Concluir entrega'}).click();
  await card.getByRole('button',{name:'Confirmar entrega',exact:true}).click();
  await expect.poll(()=>posts).toBe(1);
  await expect(page.getByRole('button',{name:'Confirmando…'})).toBeDisabled();
  release();
  await expect(page.getByRole('heading',{name:'Tudo entregue'})).toBeVisible();
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
  await page.getByRole('button',{name:'Concluir entrega'}).click();
  await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();
  await expect.poll(()=>posts).toBe(1);
  await page.clock.fastForward(12_100);
  await expect(page.getByRole('button',{name:'Concluir entrega'})).toBeDisabled();
  await expect(page.getByText('Confirmação pendente. Confira o painel antes de tentar de novo.')).toBeVisible();
  expect(posts).toBe(1);
  recover=true;
  await page.getByRole('button',{name:'Verificar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Tudo entregue'})).toBeVisible();
  expect(posts).toBe(1);
});

for(const theme of ['dark','light'])test(`visual ${theme}: valores e nomes longos, filtros e alvos de toque`,async({page},info)=>{
  await fixture(page,[{...delivery,cliente_nome:'Maria Aparecida de Albuquerque e Vasconcelos',delivery_endereco:'Avenida Governador Raul Barbosa, 13240, Condomínio Jardim das Acácias, bloco 12, apartamento 1204 — portaria lateral',total:12345.67,valor_a_cobrar:12345.67}, {...delivery,id:'paid',numero_pedido:102,cliente_nome:'Marcos',delivery_status:'pronto',valor_pago:68.9,valor_a_cobrar:0}]);
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
  await page.getByRole('button',{name:'Para sair 1',exact:true}).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Sem cobrança',{exact:true})).toBeVisible();
  await expect(page.getByText('Já Pago via App')).toHaveCount(0);
  await page.getByRole('button',{name:'Todas 2',exact:true}).click();
  await expect(page.getByRole('article')).toHaveCount(2);
});

test('endereço e telefone ausentes não geram links vazios; abrir detalhes por teclado',async({page})=>{
  await fixture(page,[{...delivery,delivery_endereco:null as any,delivery_telefone:null as any}]);
  await open(page);
  await expect(page.getByRole('link')).toHaveCount(0);
  const summary=page.locator('summary');
  await summary.focus();await summary.press('Enter');
  await expect(page.getByText(delivery.itens_resumo)).toBeVisible();
});
