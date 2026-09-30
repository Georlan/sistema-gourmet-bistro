import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('cozinha mostra identidade de cada lançamento e mantém FIFO e conclusão por item', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => sessionStorage.setItem('koma_caixa_role', 'cozinha'));
  const now = Date.now();
  const orders = [{ id: 'check-kitchen', numero_pedido: 81, mesa_id: 0, tipo: 'Retirada',
    garcom_id: 'cashier', criada_por: { nome: 'Caixa Demo' }, criado_em: new Date(now - 30 * 60000).toISOString(),
    delivery_status: 'producao', lancamentos: [], itens: [
      { id: 'new-rice', produto_id: 'rice', produto: { nome: 'Arroz da Brasa' }, status: 'preparando',
        lancamento_id: 'new-launch', lancamento_display_number: '81', lancamento_origem: 'caixa',
        lancamento_responsavel_nome: 'Caixa Demo', lancamento_timestamp: new Date(now - 2 * 60000).toISOString(),
        preco_unit: 35, observacao: 'Sem cebola', modificadores: [{ id: 'extra', nome: 'Queijo extra', preco: 3 }] },
      { id: 'old-rice', produto_id: 'rice', produto: { nome: 'Arroz anterior' }, status: 'preparando',
        lancamento_id: 'old-launch', lancamento_display_number: '80', lancamento_origem: 'garcom',
        lancamento_responsavel_nome: 'Sarah', lancamento_timestamp: new Date(now - 16 * 60000).toISOString(), preco_unit: 35 },
    ] }];
  await page.route('**/comandas/detalhes/todos*', route => route.fulfill({ json: orders }));
  await page.goto('/?view=caixa');
  const first = page.locator('#kitchen-card-old-rice');
  const second = page.locator('#kitchen-card-new-rice');
  await expect(first).toContainText('Pedido #80');
  await expect(first).toContainText('Sarah');
  await expect(first).toContainText('Atrasado · 1º na fila');
  await expect(second).toContainText('Pedido #81');
  await expect(second).toContainText('Retirada');
  await expect(second).toContainText('Caixa Demo');
  await expect(second).toContainText('Normal · 2º na fila');
  await expect(second).toContainText('Queijo extra');
  await expect(second).toContainText('Sem cebola');
  expect(await first.evaluate(el => el.getBoundingClientRect().top)).toBeLessThanOrEqual(await second.evaluate(el => el.getBoundingClientRect().top));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../kitchen-preview-' + test.info().project.name + '.png', fullPage: true });
  let finished = false;
  await page.route('**/comandas/itens/new-rice/status?status=pronto', async route => { finished = true; await route.fulfill({ json: { status: 'pronto' } }); });
  await second.getByRole('button', { name: 'Concluir Preparo' }).click();
  await expect.poll(() => finished).toBe(true);
});
