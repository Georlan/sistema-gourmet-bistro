import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';
import { openOperationalScenario, showStage } from './fixtures/operational';

for (const type of ['Retirada', 'Delivery']) {
  test(`${type} starts compact, opens items locally and prints the full order`, async ({ page }) => {
    await mockCashierBackend(page); await seedCashierSession(page);
    const order = { id: 'compact-check', restaurante_id: 99001, numero_pedido: 91, tipo: type, mesa_id: null,
      identificador: 'Cliente compacto', fechada: false, valor_pago: 0, delivery_status: 'producao',
      delivery_endereco: 'Rua das Flores, 10 · Centro', delivery_forma_pagamento: 'cartao_credito',
      criado_em: new Date().toISOString(), lancamentos: [{ id: 'launch-first', origem: 'cardapio' }, { id: 'launch-second', origem: 'cardapio' }],
      itens: [{ id: 'first-item', lancamento_id: 'launch-first', produto_id: '101', produto: { nome: 'Suco de laranja' }, preco_unit: 10, pago: false, status: 'preparando' },
        { id: 'second-item', lancamento_id: 'launch-second', produto_id: '102', produto: { nome: 'Batata crocante' }, preco_unit: 20, pago: false, status: 'preparando' }] };
    await page.route('**/comandas/delivery/ativos', route => route.fulfill({ json: [order] }));
    let prints = 0;
    await page.route('**/comandas/compact-check/imprimir-recibo', route => { prints++; return route.fulfill({ json: { ok: true } }); });
    await page.goto('/?view=caixa');
    await expect(page.locator('.orders-board')).toBeVisible();
    const stages = page.getByRole('tablist', { name: 'Etapa dos pedidos' });
    if (await stages.isVisible()) await stages.getByRole('tab', { name: /Digitais/ }).click();
    await page.locator('.orders-card--digital').filter({ hasText: 'Cliente compacto' }).click();
    const modal = page.locator('.orders-detail-modal');
    await expect(modal.locator('.orders-detail-modal__items')).not.toBeVisible();
    await expect.poll(() => modal.locator('.orders-detail-modal__number img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expect(modal.getByText('Cartão de crédito', { exact: true })).toBeVisible();
    if (type === 'Delivery') await expect(modal.getByText('Rua das Flores, 10 · Centro')).toBeVisible();
    await modal.locator('.kd-items-disclosure > summary').click();
    await expect(modal.getByText('Suco de laranja', { exact: true })).toBeVisible();
    await expect(modal.getByText('Batata crocante', { exact: true })).toBeVisible();
    await modal.locator('.kd-items-disclosure > summary').click();
    await modal.getByRole('button', { name: 'Reimprimir Total', exact: true }).click();
    await expect(modal).toHaveCount(0); expect(prints).toBe(1);
  });
}

for (const width of [320, 390, 834, 1366]) {
  test(`table actions fit ${width}px and choose a destination with the keyboard`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await openOperationalScenario(page, { tableCount: 50 }); await showStage(page, 'Salão');
    await page.locator('.orders-card--salon').first().click();
    const modal = page.locator('.orders-detail-modal');
    await expect(modal.getByRole('button', { name: 'Reimprimir Total' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Conta Total' })).toBeVisible();
    await expect(modal.getByRole('combobox')).toHaveCount(0);
    await modal.getByRole('button', { name: 'Transferir', exact: true }).click();
    const panel = modal.getByRole('region', { name: 'Transferir mesa' });
    await expect(panel.getByRole('radio').first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(panel.getByRole('radio').nth(1)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(modal.getByRole('button', { name: 'Transferir', exact: true })).toBeFocused();
    expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    for (const button of await modal.getByRole('button').all()) {
      if (!await button.isVisible()) continue;
      expect(await button.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(state.actions).toHaveLength(0);
  });
}
