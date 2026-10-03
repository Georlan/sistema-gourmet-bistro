import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

for (const failure of [false, true]) {
  test(`conversão de retirada em entrega ${failure ? 'rejeita estado antigo sem mudar UI' : 'revisa total e atualiza modalidade e CTA'}`, async ({ page }) => {
    await mockCashierBackend(page);
    await seedCashierSession(page);
    let type = 'Retirada';
    let fee = 0;
    let commits = 0;
    const order = () => ({
      id: 'conversion-e2e', restaurante_id: 99001, numero_pedido: 87, tipo: type,
      identificador: 'Cliente conversão', fechada: false, garcom_id: 'caixa-e2e', valor_pago: 0,
      delivery_status: 'producao', delivery_taxa: fee, delivery_telefone: '85999999999',
      delivery_forma_pagamento: 'dinheiro', motoboy_id: null, criado_em: new Date().toISOString(),
      lancamentos: [{ id: 'conversion-launch', origem: 'cardapio', status: 'producao' }],
      itens: [{ id: 'conversion-item', produto_id: '101', produto: { nome: 'Risoto da casa' },
        preco_unit: 42, pago: false, status: 'preparando', lancamento_id: 'conversion-launch' }],
    });
    await page.route('**/comandas/delivery/ativos', route => route.fulfill({ json: [order()] }));
    await page.route('**/comandas/delivery/pendentes', route => route.fulfill({ json: [] }));
    await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({ json: [order()] }));
    await page.route('**/comandas/conversion-e2e/modalidade/opcoes', route => route.fulfill({ json: { options: [type === 'Retirada' ? 'delivery' : 'pickup'], address_snapshot: null } }));
    await page.route('**/comandas/conversion-e2e/modalidade/previa', async route => {
      const payload = route.request().postDataJSON();
      expect(payload.fulfillment).toBe('delivery');
      expect(payload.address_snapshot.logradouro).toBe('Rua das Flores');
      expect(payload.address_snapshot.numero).toBe('10');
      await route.fulfill({ json: { token: 'preview-test', previous_fee: 0, delivery_fee: 7, previous_total: 42, total: 49 } });
    });
    await page.route('**/comandas/conversion-e2e/modalidade', async route => {
      commits += 1;
      expect(route.request().postDataJSON().token).toBe('preview-test');
      if (failure) await route.fulfill({ status: 409, json: { detail: 'O pedido mudou. Recalcule.' } });
      else { type = 'Delivery'; fee = 7; await route.fulfill({ json: order() }); }
    });
    await page.goto('/?view=caixa');
    const digitalTab = page.getByRole('tab', { name: /^Digitais/ });
    if ((page.viewportSize()?.width || 1366) <= 768) {
      await expect(digitalTab).toBeVisible();
      await digitalTab.click();
    }
    const card = page.locator('.orders-card--digital').filter({ hasText: 'Cliente conversão' });
    await card.click();
    const detail = page.locator('.orders-detail-modal');
    await expect(detail.getByRole('button', { name: 'Marcar pronto para retirada' })).toBeVisible();
    await detail.getByRole('button', { name: 'Alterar tipo do pedido' }).click();
    const dialog = page.getByRole('dialog', { name: 'Alterar tipo do pedido' });
    await dialog.locator('#conversion-address-logradouro').fill('Rua das Flores');
    await dialog.locator('#conversion-address-numero').fill('10');
    await dialog.getByRole('textbox', { name: 'Motivo da alteração', exact: true }).fill('Cliente pediu entrega');
    await dialog.getByRole('button', { name: 'Calcular e revisar' }).click();
    await expect(dialog.getByRole('status')).toContainText('R$ 49,00');
    expect(commits).toBe(0);
    await expect(dialog.locator('#conversion-address-logradouro')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Confirmar alteração' }).click();
    if (failure) {
      await expect(dialog.getByRole('alert')).toContainText('Alteração não confirmada');
      await expect(detail.getByRole('button', { name: 'Marcar pronto para retirada' })).toBeVisible();
      expect(type).toBe('Retirada');
      await expect(dialog.getByRole('button', { name: 'Calcular e revisar' })).toBeVisible();
    } else {
      await expect(dialog).toHaveCount(0);
      await expect(card).toContainText('R$ 49,00');
      await card.click();
      await expect(detail.getByRole('button', { name: 'Marcar como pronto', exact: true })).toBeVisible();
      await expect(detail.getByRole('button', { name: 'Marcar pronto para retirada' })).toHaveCount(0);
    }
    expect(commits).toBe(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}
