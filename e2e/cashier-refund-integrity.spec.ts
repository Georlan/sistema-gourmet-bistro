import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

const refundablePayment = {
  id: 'pay-100',
  comanda_id: 'cmd-e2e-4',
  turno_id: 501,
  valor_original: 100,
  saldo_estornavel: 100,
  metodo_original: 'dinheiro',
  status: 'aprovado',
  criado_em: new Date().toISOString(),
  origem: 'Mesa 4',
  numero_pedido: 704,
  mesa_id: 4,
  origens_financeiras: [
    {
      comanda_id: 'cmd-e2e-4',
      label: 'Mesa 4',
      valor_original: 100,
      valor_estornado: 0,
      saldo_estornavel: 100,
    },
  ],
};

async function openRefundModal(page: Page) {
  await mockCashierBackend(page);
  await page.route('**/caixa/turno-atual/resumo', route => route.fulfill({
    status: 200,
    json: {
      turno_id: 501,
      status: 'aberto',
      operador_id: 'caixa-e2e',
      operador_nome: 'Caixa E2E',
      aberto_em: new Date().toISOString(),
      tempo_aberto_minutos: 25,
      saldo_inicial: 100,
      total_vendas: 100,
      total_dinheiro: 100,
      total_pix: 0,
      total_cartao: 0,
      total_sangrias: 0,
      total_suprimentos: 0,
      saldo_esperado_dinheiro: 200,
      total_pedidos_pagos: 1,
      atividades_recentes: [
        {
          id: 'pagamento:pay-100',
          tipo: 'recebimento',
          descricao: 'Venda recebida',
          origem: 'Mesa 4',
          metodo: 'dinheiro',
          valor: 100,
          operador_nome: 'Caixa E2E',
          criado_em: new Date().toISOString(),
        },
      ],
    },
  }));
  await page.route('**/caixa/pagamentos/pay-100/estornavel', route => route.fulfill({
    status: 200,
    json: refundablePayment,
  }));
  await page.route('**/caixa/pagamentos/estornaveis*', route => route.fulfill({
    status: 200,
    json: [refundablePayment],
  }));
  await seedCashierSession(page);
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();

  const caixaBtn = page.getByRole('button', { name: 'Caixa', exact: true }).first();
  if (await caixaBtn.isVisible()) {
    await caixaBtn.click();
  } else {
    await page.getByRole('button', { name: /Abrir menu|Menu/i }).first().click();
    await page.getByRole('button', { name: 'Caixa', exact: true }).first().click();
  }

  const refundTrigger = page.getByRole('button', { name: 'Devolver pagamento de Mesa 4' });
  await expect(refundTrigger).toBeVisible();
  await refundTrigger.click();
  const dialog = page.getByRole('dialog', { name: 'Devolver um pagamento' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Devolver de Mesa 4')).toBeVisible();
  return dialog;
}

test('preserves refund error message and reuses exact idempotency_key on retry after failure', async ({ page }) => {
  const refundRequests: Array<{ idempotency_key: string; valor: number; motivo: string }> = [];
  const dialog = await openRefundModal(page);

  await page.route('**/caixa/pagamentos/pay-100/estornar', async route => {
    const body = route.request().postDataJSON();
    refundRequests.push({
      idempotency_key: body.idempotency_key,
      valor: body.valor,
      motivo: body.motivo,
    });
    if (refundRequests.length === 1) {
      await route.fulfill({
        status: 503,
        json: { detail: 'Instabilidade temporária ao gravar devolução.' },
      });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        id: 'est-1',
        pagamento_id: 'pay-100',
        turno_id: 501,
        valor: body.valor,
        metodo_original: 'dinheiro',
        metodo_devolucao: body.metodo_devolucao,
        motivo: body.motivo,
        idempotency_key: body.idempotency_key,
        criado_em: new Date().toISOString(),
        saldo_estornavel_pagamento: 100 - body.valor,
        alocacoes: [],
      },
    });
  });

  await dialog.locator('textarea').fill('Cobrança duplicada no caixa');
  const confirmButton = dialog.getByRole('button', { name: 'Confirmar devolução' });
  await confirmButton.click();

  // Failure error must stay visible after background list refresh (never wiped by load()).
  await expect(dialog.getByRole('alert')).toContainText('Instabilidade temporária ao gravar devolução.');
  expect(refundRequests).toHaveLength(1);
  expect(refundRequests[0].idempotency_key).toBeTruthy();

  // Retrying the exact same refund payload must reuse the exact same idempotency_key.
  await confirmButton.click();
  await expect(dialog).toBeHidden();
  expect(refundRequests).toHaveLength(2);
  expect(refundRequests[1].idempotency_key).toBe(refundRequests[0].idempotency_key);
});

test('mints a fresh idempotency_key if operator changes refund reason after a failed attempt', async ({ page }) => {
  const refundRequests: Array<{ idempotency_key: string; motivo: string }> = [];
  const dialog = await openRefundModal(page);

  await page.route('**/caixa/pagamentos/pay-100/estornar', async route => {
    const body = route.request().postDataJSON();
    refundRequests.push({ idempotency_key: body.idempotency_key, motivo: body.motivo });
    if (refundRequests.length === 1) {
      await route.fulfill({ status: 409, json: { detail: 'Revise o motivo antes de reenviar.' } });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        id: 'est-3',
        pagamento_id: 'pay-100',
        turno_id: 501,
        valor: body.valor,
        metodo_original: 'dinheiro',
        metodo_devolucao: body.metodo_devolucao,
        motivo: body.motivo,
        idempotency_key: body.idempotency_key,
        criado_em: new Date().toISOString(),
        saldo_estornavel_pagamento: 0,
        alocacoes: [],
      },
    });
  });

  await dialog.locator('textarea').fill('Motivo inicial rejeitado');
  const confirmButton = dialog.getByRole('button', { name: 'Confirmar devolução' });
  await confirmButton.click();

  await expect(dialog.getByRole('alert')).toContainText('Revise o motivo antes de reenviar.');
  await dialog.locator('textarea').fill('Motivo corrigido pelo gerente');
  await confirmButton.click();

  await expect(dialog).toBeHidden();
  expect(refundRequests).toHaveLength(2);
  expect(refundRequests[1].idempotency_key).not.toBe(refundRequests[0].idempotency_key);
});

test('blocks concurrent double-submit and mid-flight dismissal, and supports Escape when idle', async ({ page }) => {
  const dialog = await openRefundModal(page);

  // Escape closes when idle.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Reopen for in-flight concurrency test.
  await page.getByRole('button', { name: 'Devolver pagamento de Mesa 4' }).click();
  await expect(dialog).toBeVisible();

  let requestCount = 0;
  let releaseRequest: (() => void) | null = null;
  await page.route('**/caixa/pagamentos/pay-100/estornar', async route => {
    requestCount += 1;
    const body = route.request().postDataJSON();
    await new Promise<void>(resolve => { releaseRequest = resolve; });
    await route.fulfill({
      status: 201,
      json: {
        id: 'est-2',
        pagamento_id: 'pay-100',
        turno_id: 501,
        valor: body.valor,
        metodo_original: 'dinheiro',
        metodo_devolucao: body.metodo_devolucao,
        motivo: body.motivo,
        idempotency_key: body.idempotency_key,
        criado_em: new Date().toISOString(),
        saldo_estornavel_pagamento: 0,
        alocacoes: [],
      },
    });
  });

  await dialog.locator('textarea').fill('Erro operacional confirmado');
  const confirmButton = dialog.getByRole('button', { name: 'Confirmar devolução' });

  // Dispatch two synchronous clicks within the same tick before React disables the button.
  await confirmButton.evaluate((btn) => {
    (btn as HTMLButtonElement).click();
    (btn as HTMLButtonElement).click();
  });

  await expect.poll(() => requestCount).toBe(1);

  // Escape and Close button must not dismiss while the refund request is in flight.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Fechar' })).toBeDisabled();

  releaseRequest?.();
  await expect(dialog).toBeHidden();
  expect(requestCount).toBe(1);
});
