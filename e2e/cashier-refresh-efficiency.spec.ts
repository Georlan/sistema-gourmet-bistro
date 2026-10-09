import { expect, test, type WebSocketRoute } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('initial board never presents the salon while the digital snapshot is still loading', async ({page}) => {
  await mockCashierBackend(page); await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, ws=>ws.onMessage(()=>{}));
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/comandas/delivery/ativos',async route=>{await gate;await route.fulfill({json:[]});});
  await page.goto('/?view=caixa');
  await expect(page.getByTestId('operational-snapshot-loading')).toBeVisible();
  await expect(page.locator('.orders-board')).toHaveCount(0);
  release();
  await expect(page.locator('.orders-board')).toBeVisible();
  await expect(page.getByTestId('operational-snapshot-loading')).toHaveCount(0);
});

test('a waiter launch refreshes its check without refetching delivery or SmartPOS',async ({page})=>{
  await mockCashierBackend(page);await seedCashierSession(page);
  let socket!:WebSocketRoute;
  await page.routeWebSocket(/\/ws\//,ws=>{socket=ws;ws.onMessage(()=>{});});
  const reads:string[]=[];
  page.on('request',request=>{if(request.method()==='GET'&&request.url().includes('127.0.0.1:8000')) reads.push(new URL(request.url()).pathname);});
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  await expect.poll(()=>reads.filter(x=>x==='/auth/smartpos/caixa/operacao').length).toBeGreaterThan(0);
  const digital=reads.filter(x=>x.startsWith('/comandas/delivery/')).length;
  const smartpos=reads.filter(x=>x==='/auth/smartpos/caixa/operacao').length;
  socket.send(JSON.stringify({event:'tables_updated',detail:{type:'lancamento_criado',comanda_id:'test-check',resource:'salon'}}));
  await expect.poll(()=>reads.some(x=>x.includes('test-check'))).toBe(true);
  await expect.poll(()=>reads.filter(x=>x.startsWith('/comandas/delivery/')).length).toBe(digital);
  expect(reads.filter(x=>x==='/auth/smartpos/caixa/operacao')).toHaveLength(smartpos);
});

test('a digital hint during bootstrap triggers a fresh snapshot before presenting the board', async ({ page }) => {
  await mockCashierBackend(page); await seedCashierSession(page);
  let socket!: WebSocketRoute;
  await page.routeWebSocket(/\/ws\//, ws => { socket = ws; ws.onMessage(() => {}); });
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/comandas/delivery/ativos', async route => {
    reads++;
    await gate;
    await route.fulfill({ json: [] });
  });
  await page.goto('/?view=caixa');
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.getByTestId('operational-snapshot-loading')).toBeVisible();
  const initialReads = reads;
  await page.evaluate(() => window.addEventListener('koma_orders_updated', () => { (window as any).__bootstrapHint = true; }, { once: true }));
  socket.send(JSON.stringify({ event: 'new_delivery_order' }));
  await page.waitForFunction(() => (window as any).__bootstrapHint === true);
  release();
  await expect(page.locator('.orders-board')).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(initialReads);
});


test('a waiter digital launch keeps the dedicated digital queue live', async ({ page }) => {
  await mockCashierBackend(page); await seedCashierSession(page);
  let socket!: WebSocketRoute;
  await page.routeWebSocket(/\/ws\//, ws => { socket = ws; ws.onMessage(() => {}); });
  let reads = 0;
  await page.route('**/comandas/delivery/ativos', route => { reads++; return route.fulfill({ json: [] }); });
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  const before = reads;
  socket.send(JSON.stringify({ event: 'tables_updated', detail: { type: 'lancamento_criado', comanda_id: 'digital-check', resource: 'digital' } }));
  await expect.poll(() => reads).toBeGreaterThan(before);
});
