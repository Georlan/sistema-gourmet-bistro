import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { mockCashierBackend } from './fixtures/cashier';
async function open(page: Page) {
  await mockCashierBackend(page);
  const state = { reads: 0, feedback: [] as any[], feedbackFails: true, socket: null as WebSocketRoute | null };
  await page.routeWebSocket(/\/ws\//, socket => { state.socket=socket;socket.onMessage(() => {}); });
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_waiter_token','history-fixture');sessionStorage.setItem('koma_waiter_id','history-waiter');sessionStorage.setItem('koma_waiter_name','Ana');sessionStorage.setItem('koma_user_role','garcom');sessionStorage.setItem('koma_active_operational_portal','garcom');sessionStorage.setItem('koma_operator_session_garcom',JSON.stringify({token:'history-fixture',expiresAt:Date.now()+86400000,user:{id:'history-waiter',nome:'Ana',role:'garcom',restaurante_id:99001}}));
  });
  await page.route('**/garcom/historico**', route => {
    state.reads++;const url=new URL(route.request().url());
    const entry = (id: string, pedido: string, hour: number) => ({id,pedido,mesa_id:7,mesa_nome:'Varanda de frente',horario:`2026-10-24T${hour}:00:00Z`,itens_count:2});
    if (url.pathname.endsWith('/h-new')) return route.fulfill({json:{...entry('h-new','124-AA',18),itens:[{id:'one',nome:'Risoto da casa',preco:42,cliente:'Ana',observacao:'Sem cebola',status:'entregue',modificadores:[]},{id:'two',nome:'Suco',preco:12,cliente:'Consumo Geral',observacao:'',status:'cancelado',modificadores:[]}]}});
    return route.fulfill({json:{dia:url.searchParams.get('dia'),items:url.searchParams.has('antes')?[entry('h-old','123-A',16)]:[entry('h-new','124-AA',18),entry('h-middle','124-Z',17)],next_cursor:url.searchParams.has('antes')?null:'h-middle'}});
  });
  await page.route('**/api/support/feedback', route => { state.feedback.push(route.request().postDataJSON());return route.fulfill({status:state.feedbackFails?500:201,json:state.feedbackFails?{detail:'Falha simulada. Tente novamente.'}:{id:'feedback-fixture'}}); });
  await page.goto('/?view=garcom');await page.locator('#mesa-card-7').waitFor();return state;
}

test('lateral enxuta abre histórico sob demanda, pagina e mostra detalhes sem alterar a mesa', async ({ page }) => {
  const state=await open(page);expect(state.reads).toBe(0);
  await page.locator('#open-sidebar-btn').click();
  for(const id of ['drawer-show-all-tables','drawer-show-ready-tables','drawer-show-occupied-tables','drawer-sync-salon'])await expect(page.locator('#'+id)).toHaveCount(0);
  await page.locator('#drawer-open-history').click();
  const dialog=page.getByRole('dialog',{name:'Meu histórico',exact:true});await expect(dialog).toBeVisible();
  await expect(page.locator('#history-entry-h-new')).toContainText('Pedido 124-AA');
  await expect(dialog.locator('.kw-history-entry')).toHaveCount(2);
  await page.getByRole('button',{name:'Ver mais',exact:true}).click();await expect(dialog.locator('.kw-history-entry')).toHaveCount(3);
  await page.locator('#history-entry-h-new').click();await expect(dialog.getByText('Sem cebola',{exact:true})).toBeVisible();
  await expect(dialog.locator('.kw-history-total')).toContainText('42,00');
  await expect(dialog.getByText('Cancelado',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Voltar ao histórico',exact:true}).click();await expect(dialog.locator('.kw-history-entry')).toHaveCount(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await dialog.getByRole('button',{name:'Fechar',exact:true}).click();await expect(page.locator('#mesa-card-7')).toBeVisible();
});

test('ajuda abre pronta para escrever e preserva texto em falha ou fechamento, sem enviar sozinha', async ({ page }) => {
  const state=await open(page);await page.locator('#open-sidebar-btn').click();await page.locator('#drawer-open-customer-support').click();
  const dialog=page.getByRole('dialog',{name:'Ajuda e feedback KÔMA',exact:true});const message=dialog.getByRole('textbox',{name:'Sua mensagem',exact:true});
  await expect(message).toBeFocused();await expect(message).toBeInViewport();
  await message.fill('Quero melhorar a busca das mesas.');
  expect(state.feedback).toEqual([]);
  await dialog.getByRole('button',{name:'Fechar',exact:true}).click();
  await page.locator('#open-sidebar-btn').click();await page.locator('#drawer-open-customer-support').click();
  await expect(message).toHaveValue('Quero melhorar a busca das mesas.');
  await dialog.getByRole('button',{name:'Enviar dúvida',exact:true}).click();
  await expect(dialog.getByText('Falha simulada. Tente novamente.',{exact:true})).toBeVisible();
  await expect(message).toHaveValue('Quero melhorar a busca das mesas.');
  state.feedbackFails=false;await dialog.getByRole('button',{name:'Enviar dúvida',exact:true}).click();
  await expect(dialog.getByText('Mensagem recebida',{exact:true})).toBeVisible();
  expect(state.feedback).toHaveLength(2);expect(state.feedback[0]).toEqual({kind:'question',message:'Quero melhorar a busca das mesas.',page_path:'/'});
});


test('histórico aberto acompanha websocket sem duplicar linhas nem consultar enquanto fechado', async ({ page }) => {
  const state = await open(page);expect(state.reads).toBe(0);
  await page.locator('#open-sidebar-btn').click();await page.locator('#drawer-open-history').click();
  await expect(page.locator('.kw-history-entry')).toHaveCount(2);
  state.socket!.send(JSON.stringify({event:'tables_updated'}));
  await expect.poll(() => state.reads).toBe(2);
  await expect(page.locator('.kw-history-entry')).toHaveCount(2);
  await page.getByRole('dialog',{name:'Meu histórico',exact:true}).getByRole('button',{name:'Fechar',exact:true}).click();
  state.socket!.send(JSON.stringify({event:'tables_updated'}));
  await page.waitForTimeout(200);
  expect(state.reads).toBe(2);
});
