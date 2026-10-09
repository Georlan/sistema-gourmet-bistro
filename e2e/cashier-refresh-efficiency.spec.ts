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

test('digital hints remain owned during a slow cashier module download', async ({ page }) => {
  await mockCashierBackend(page); await seedCashierSession(page);
  let socket!: WebSocketRoute;
  await page.routeWebSocket(/\/ws\//, ws => { socket = ws; ws.onMessage(() => {}); });
  let reads = 0;
  await page.route('**/comandas/delivery/ativos', route => { reads++; return route.fulfill({ json: [] }); });
  let moduleRequested = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/*CaixaPanel.tsx*', async route => { moduleRequested = true; await gate; await route.continue(); });
  try {
    await page.goto('/?view=caixa');
    await expect.poll(() => moduleRequested).toBe(true);
    const before = reads;
    socket.send(JSON.stringify({ event: 'new_delivery_order' }));
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(page.locator('.orders-board')).toHaveCount(0);
    release();
    await expect(page.locator('.orders-board')).toBeVisible();
  } finally { release(); }
});

test('online delivery retains unsaved fields across sidebars without replaying reads', async ({ page }) => {
  await mockCashierBackend(page); await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, ws => ws.onMessage(() => {}));
  let configReads = 0;
  page.on('request', request => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/caixa/configuracoes') configReads++;
  });
  const navigate = async (label: string) => {
    const sidebar = page.locator('.cashier-sidebar:visible');
    if (!await sidebar.isVisible()) await page.getByRole('button', { name: 'Abrir menu principal' }).click();
    await sidebar.getByRole('button', { name: new RegExp(`^${label}(?: [0-9]+)?$`) }).click();
  };
  const openDelivery = async () => {
    await navigate('Cardápio online');
    await page.locator('.cashier-subnav').getByRole('button', { name: 'Entrega', exact: true }).click();
  };
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  await openDelivery();
  const minimum = page.getByRole('spinbutton', { name: /Pedido mínimo \(R\$\)/ });
  await expect(minimum).toBeVisible();
  await minimum.fill('42');
  const before = configReads;
  await navigate('Vendas');
  await expect(page.locator('.orders-board')).toBeVisible();
  await openDelivery();
  await expect(minimum).toHaveValue('42');
  expect(configReads).toBe(before);
});
