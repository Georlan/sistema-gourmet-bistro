import {test,expect} from '@playwright/test';
import {publicMenuPayload} from './fixtures/menu-parity';
const API='http://127.0.0.1:8000';
test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if (origin !== new URL(baseURL!).origin && origin !== API) return route.abort();
    return route.fallback();
  });
});
test('cliente vê código privado no acompanhamento sem outra requisição de código',async({page})=>{
  let summaries=0; let finished=false;
  await page.addInitScript(()=>sessionStorage.setItem('koma_active_orders',JSON.stringify([{
    id:'receipt-customer',numero_pedido:101,restaurante_id:2,timestamp:Date.now(),tracking_token:'private-receipt-token',status:'transito',total:12.9,tipo:'Delivery',
  }])));
  await page.route(`${API}/**`,route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/public'))return route.fulfill({json:publicMenuPayload});
    if(path.endsWith('/summary')) { summaries++;return route.fulfill({json:{id:'receipt-customer',numero_pedido:101,tipo:'Delivery',status:finished?'finalizado':'transito',delivery_receipt_code:finished?null:'001234',fechada:finished,conversa:{id:'conv-receipt',can_chat:true,unread_count:0}}}); }
    if(path.endsWith('/events'))return route.fulfill({contentType:'text/event-stream',body:': local\n\n'});
    if(path.endsWith('/feed'))return route.fulfill({json:{items:[],has_more:false,oldest_seq:null,latest_seq:null,purged_at:null}});
    if(path.endsWith('/messages'))return route.fulfill({json:{items:[],conversa:{id:'conv-receipt',can_chat:true}}});
    return route.fulfill({json:{}});
  });
  await page.goto('/cardapio?restaurante_id=2#koma-order=receipt-customer');
  const receipt=page.getByLabel('Código de recebimento da entrega').first();
  await expect.poll(() => summaries).toBeGreaterThan(0);
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('001234');
  await expect(receipt).toContainText('quando receber o pedido');
  expect(summaries).toBeGreaterThan(0);
  if (!await page.locator('#inline-order-chat-panel').isVisible()) await page.getByRole('button',{name:'Chat com restaurante',exact:true}).click();
  await expect(page.locator('#inline-order-chat-panel').getByLabel('Código de recebimento da entrega')).toBeVisible();
  finished=true;
  await page.reload();
  await expect(page.getByRole('heading',{name:'Concluído',exact:true}).first()).toBeVisible();
  await expect(page.getByLabel('Código de recebimento da entrega')).toHaveCount(0);
});
