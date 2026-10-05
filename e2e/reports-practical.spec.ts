import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('reports preserve explicit civil interval across tabs and reload', async ({ page }, info) => {
  test.skip(!['mobile-390', 'desktop-1366'].includes(info.project.name));
  await mockCashierBackend(page);
  await page.route('**/relatorios/visao-geral?*', async route => {
    const url = new URL(route.request().url());
    const rows = [
      { data: '2026-10-02', total: 514, bruto: 514, estornos: 0, quantidade_pedidos: 27 },
      { data: '2026-10-03', total: 657, bruto: 657, estornos: 0, quantidade_pedidos: 29 },
      { data: '2026-10-04', total: 603, bruto: 603, estornos: 0, quantidade_pedidos: 21 },
    ].filter(row => row.data >= url.searchParams.get('data_inicio')! && row.data <= url.searchParams.get('data_fim')!);
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const accounts = rows.reduce((sum, row) => sum + row.quantidade_pedidos, 0);
    await route.fulfill({ json: { faturamento_total: total, vendas_brutas: total, estornos: 0,
      total_pedidos: accounts, ticket_medio: accounts ? total / accounts : 0, clientes_ativos: 72,
      meta_mensal: 0, vendas_por_dia: rows,
      horarios_pico: rows.length ? [{ hora: '15h', total_pedidos: 29, faturamento: 749 }] : [],
      comparativo_anterior: { tem_base_anterior: false } } });
  });
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'relatorios');
    sessionStorage.setItem('koma_active_subtab', 'visao_geral');
  });
  const reportRequests: string[] = [];
  page.on('request', request => { if (request.method() === 'GET' && request.url().includes('/relatorios/visao-geral?')) reportRequests.push(request.url()); });
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: /Alterar período:/ }).click();
  await page.getByLabel('Data Início:').fill('2026-10-02');
  await page.getByLabel('Data Fim:').fill('2026-10-04');
  await page.getByRole('button', { name: /Aplicar/ }).click();
  await expect(page.getByRole('button', { name: 'Alterar período: 02/10/2026 — 04/10/2026' })).toBeVisible();
  await page.getByRole('button', { name: 'Contas', exact: true }).click();
  for (const tab of ['Financeiro', 'Produtos', 'Equipe', 'Visão Geral']) {
    await page.getByRole('button', { name: tab, exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Alterar período: 02/10/2026 — 04/10/2026' })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole('button', { name: 'Alterar período: 02/10/2026 — 04/10/2026' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar', exact: true })).toBeEnabled();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  for (const label of ['Hoje', 'Ontem', 'Últimos 7 dias', 'Últimos 15 dias', 'Últimos 30 dias']) {
    await page.getByRole('button', { name: /Alterar período:/ }).click();
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Alterar período:/ })).toBeVisible();
  }
  expect(reportRequests.length).toBeLessThanOrEqual(9);
  await expect(page.getByRole('button', { name: 'Exportar', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /Alterar período:/ }).scrollIntoViewIfNeeded();
  if (process.env.KOMA_REPORT_SCREENSHOTS) {
    await mkdir(process.env.KOMA_REPORT_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: `${process.env.KOMA_REPORT_SCREENSHOTS}/relatorios-${info.project.name}.png`, fullPage: true });
  }

});
