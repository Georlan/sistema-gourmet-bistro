import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

async function capture(page: Page, name: string) {
  const directory = process.env.KOMA_PRINT_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${test.info().project.name}-${name}.png`), fullPage: true });
}

const localId = 'local-print-fixture';
const printer = { name: 'KA7 local', connection: 'bluetooth', configured: true, paired: true, spp: true,
  dispatchable: true, available: false, present: false };
const agent = (id: string) => ({ agent_id: id, online: true, diagnostics_fresh: true, printer_dispatchable: true,
  printer_diagnostics: { printers: [{ ...printer, name: id === localId ? printer.name : 'Remote POS80' }] } });
const monitor = { generated_at: new Date().toISOString(), online_threshold_seconds: 90,
  agents: [agent('remote-fixture'), agent(localId)], physical_completion_tracking: false,
  summary: { online_agents: 2, active_agents: 2, pending: 0, claimed: 0, printing: 0, failed: 0, delayed: 0 },
  jobs: [], history_jobs: [], queue_jobs: [], latest_spooler_success: null };

async function setup(page: Page, permission: 'prompt' | 'denied' | 'granted' | 'unsupported') {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(state => {
    sessionStorage.setItem('koma_active_tab', 'impressao_salao');
    sessionStorage.setItem('koma_active_subtab', 'impressao');
    const status = Object.assign(new EventTarget(), { state });
    (window as any).setPrintPermission = (next: string) => { status.state = next as any; status.dispatchEvent(new Event('change')); };
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
      query: async () => { if (status.state === 'unsupported') throw new TypeError('unsupported'); return status; },
    } });
  }, permission);
  await page.route('**/api/print-agents/monitor?*', route => route.fulfill({ json: monitor }));
  const reads: string[] = [], writes: string[] = [];
  page.on('request', request => { if (!['GET', 'OPTIONS'].includes(request.method())) writes.push(request.url()); });
  await page.route(/http:\/\/127\.0\.0\.1:176\d{2}\/agent\/identity/, async route => {
    reads.push(route.request().url());
    if (!route.request().url().includes(':17654/')) return route.abort('connectionrefused');
    await route.fulfill({ json: { service: 'koma-print-agent', status: 'ready', agent_id: localId } });
  });
  await page.goto('/?view=caixa');
  await expect(page.locator('#printing-status-heading')).toBeVisible({ timeout: 15_000 });
  return { reads, writes };
}

test('permission denied is explicit and never adopts an online remote agent', async ({ page }) => {
  const { reads, writes } = await setup(page, 'denied');
  await expect(page.getByText('O navegador bloqueou a conexão com o KÔMA Print.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Imprimir teste', exact: true })).toBeDisabled();
  await expect(page.getByText('Remote POS80')).toHaveCount(0);
  await expect(page.getByText('Impressoras não verificadas', { exact: true })).toBeVisible();
  await expect(page.getByText('Nenhuma impressora encontrada neste computador.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Verificar acesso do navegador', exact: true }).click();
  expect(reads).toHaveLength(0); expect(writes).toHaveLength(0);
  await capture(page, 'permission-denied');
});

test('prompt does not scan automatically; user click connects without pairing or printing', async ({ page }) => {
  const { reads, writes } = await setup(page, 'prompt');
  await expect(page.getByText('Autorize a conexão com o KÔMA Print.', { exact: true })).toBeVisible();
  expect(reads).toHaveLength(0);
  await capture(page, 'permission-request');
  // Browser fixture grants as the user's explicit request reaches the bridge.
  await page.route('http://127.0.0.1:17654/agent/identity', async route => {
    reads.push(route.request().url());
    await page.evaluate(() => (window as any).setPrintPermission('granted'));
    await route.fulfill({ json: { service: 'koma-print-agent', status: 'ready', agent_id: localId } });
  });
  await page.getByRole('button', { name: 'Conectar KÔMA Print', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Imprimir teste', exact: true })).toBeEnabled();
  await expect(page.getByText('KA7 local', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Remote POS80')).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

for (const permission of ['granted', 'unsupported'] as const) {
  test(`${permission} preserves automatic discovery and on-demand Bluetooth`, async ({ page }) => {
    const { writes } = await setup(page, permission);
    await expect(page.getByRole('button', { name: 'Imprimir teste', exact: true })).toBeEnabled();
    await expect(page.getByText('Remote POS80')).toHaveCount(0);
    expect(writes).toHaveLength(0);
  });
}

test('permission revocation clears local identity and regrant reconciles automatically', async ({ page }) => {
  const { writes } = await setup(page, 'granted');
  const testPrint = page.getByRole('button', { name: 'Imprimir teste', exact: true });
  await expect(testPrint).toBeEnabled();
  await page.evaluate(() => (window as any).setPrintPermission('denied'));
  await expect(testPrint).toBeDisabled();
  await expect(page.getByText('O navegador bloqueou a conexão com o KÔMA Print.', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).setPrintPermission('granted'));
  await expect(testPrint).toBeEnabled();
  expect(writes).toHaveLength(0);
});

test('duplicate clicks coalesce; permission revoked during discovery rejects a late response', async ({ page }) => {
  const { reads, writes } = await setup(page, 'prompt');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('http://127.0.0.1:17654/agent/identity', async route => {
    reads.push(route.request().url()); await gate;
    await route.fulfill({ json: { service: 'koma-print-agent', status: 'ready', agent_id: localId } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Conectar KÔMA Print', exact: true }).evaluate(button => {
    (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click();
  });
  await expect.poll(() => reads.filter(url => url.includes(':17654/')).length).toBe(1);
  await page.evaluate(() => (window as any).setPrintPermission('denied'));
  release();
  await expect(page.getByText('O navegador bloqueou a conexão com o KÔMA Print.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Imprimir teste', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test('changing session while permission lookup is pending never adopts the previous session', async ({ page }) => {
  // Test-only owner; this HTML is not an entry in the production build.
  await page.goto('/e2e/fixtures/print-scope.html');
  await expect(page.locator('output')).toHaveText('checking');
  await page.getByRole('button', { name: 'Switch session' }).click();
  await expect(page.locator('output')).toHaveText('permission_denied');
  await page.evaluate(() => (window as any).releaseOld());
  await expect(page.locator('output')).toHaveText('permission_denied');
  expect(await page.evaluate(() => (window as any).reads)).toBe(0);
});

test('reset to Ask during a read immediately invalidates identity and rejects the late response', async ({ page }) => {
  await page.goto('/e2e/fixtures/print-scope.html?mode=reset');
  await expect(page.locator('output')).toHaveText('ready');
  await page.clock.install();
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 100);
  await page.getByRole('button', { name: 'Refresh identity' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseRead)).toBe('function');
  await page.evaluate(() => (window as any).resetPermission());
  try { await expect(page.locator('output')).toHaveText('permission_prompt'); }
  finally { await page.evaluate(() => (window as any).releaseRead()); }
  await expect(page.locator('output')).toHaveText('permission_prompt');
});
