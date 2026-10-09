import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('CRM ranks buyers, filters inactivity, searches formatted phones and preserves edit flow', async ({ page }, testInfo) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/fidelidade/clientes', route => route.fulfill({ json: [
    { id: 'new', nome: 'Sem compras', telefone: '85912340000', saldo_pontos: 0, saldo_cashback: 0, pedidos_concluidos: 0, dias_sem_comprar: null, segmento_relacionamento: 'SEM_COMPRA' },
    { id: 'loyal', nome: 'Ana Frequente', telefone: '85999998888', saldo_pontos: 50, saldo_cashback: 0, primeira_compra_em: '2026-09-01T12:00:00Z', ultima_compra_em: '2026-10-05T12:00:00Z', intervalo_medio_dias: 3, pedidos_concluidos: 12, dias_sem_comprar: 4, segmento_relacionamento: 'ATIVO', valor_pago_total: 600, ticket_medio_pago: 50, produtos_favoritos: [{produto_id: 'burger', nome: 'Burger da casa', unidades: 18}] },
    { id: 'absent', nome: 'Bruno Ausente', telefone: '85911112222', saldo_pontos: 10, saldo_cashback: 0, intervalo_medio_dias: 10, pedidos_concluidos: 3, dias_sem_comprar: 75, segmento_relacionamento: 'REATIVAR', valor_pago_total: 120, ticket_medio_pago: 40 },
    ...Array.from({ length: 27 }, (_, i) => ({ id: `empty-${i}`, nome: `Cadastro ${i}`, telefone: '85900000000', saldo_pontos: 0, saldo_cashback: 0, pedidos_concluidos: 0, dias_sem_comprar: null, segmento_relacionamento: 'SEM_COMPRA' })),
  ] }));
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  if (testInfo.project.name.startsWith('mobile')) await page.getByRole('button', { name: 'Abrir menu completo' }).click();
  await page.locator('.cashier-sidebar:visible').getByRole('button', { name: /^Clientes(?: \d+)?$/ }).click();
  const records = page.locator(testInfo.project.name.startsWith('mobile') ? 'article:visible' : 'tbody:visible tr');
  await expect(records.first()).toContainText('Ana Frequente');
  await expect(records.first()).toContainText('Burger da casa');
  await expect(records.first()).toContainText('600,00');
  await records.first().getByText('Ver hábitos de Ana Frequente', { exact: true }).click();
  await expect(records.first()).toContainText('01/09/2026');
  await expect(records.first()).toContainText('3 dias');
  await page.getByText('Oportunidades de relacionamento', { exact: true }).click();
  await page.getByRole('button', { name: /Fora do ritmo habitual/ }).click();
  await expect(records).toHaveCount(1);
  await expect(records.first()).toContainText('Bruno Ausente');
  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  await expect(page.getByText('Saúde do relacionamento e frequência')).not.toBeVisible();
  await page.getByLabel('Ordenar clientes', { exact: true }).selectOption('absent');
  await expect(records.first()).toContainText('Bruno Ausente');
  await page.getByRole('button', { name: 'Reativar (+60 dias)', exact: true }).click();
  await expect(records).toHaveCount(1);
  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  await page.getByLabel('Buscar clientes').fill('(85) 99999-8888');
  await expect(records).toHaveCount(1);
  await records.first().getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByText('Editar Cliente CRM')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByLabel('Buscar clientes').fill('');
  await page.getByLabel('Ordenar clientes', { exact: true }).selectOption('orders');
  await expect(records).toHaveCount(25);
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect(records).toHaveCount(5);
  await page.getByLabel('Buscar clientes').fill('Ana Frequente');
  await expect(records).toHaveCount(1);
  await expect(records.first()).toContainText('Ana Frequente');
  await page.getByLabel('Buscar clientes').fill('');
  await expect(records).toHaveCount(25);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => document.querySelector('.cashier-main')?.scrollTo(0, 0));
  await page.getByLabel('Ordenar clientes', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/home/testuser/Documents/Codex/2026-10-09/vam/outputs/crm-${testInfo.project.name}.png`, fullPage: true });
});
