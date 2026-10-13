import { expect, test } from '@playwright/test';
import { API_ORIGIN, openOperationalScenario } from './fixtures/operational';

test('pagamento misto não duplica retry e espera saldo confirmado pelo servidor', async ({ page }) => {
  await openOperationalScenario(page, { subtab: 'mesas', canonicalIdentity: true, statuses: ['entregue', 'entregue'] });
  const attempts: { valor: number; metodo: string; idempotency_key: string; item_ids: unknown }[] = [];
  let firstAttemptFails = true;
  await page.route(`${API_ORIGIN}/caixa/mesas/7/pagar`, async route => {
    const body = route.request().postDataJSON();
    attempts.push(body);
    if (firstAttemptFails) {
      firstAttemptFails = false;
      await route.fulfill({ status: 503, json: { detail: 'Tente novamente' } });
      return;
    }
    await route.fulfill({ json: { valor: body.valor, status: 'aprovado' } });
  });

  const card = page.locator('article[data-table-status="occupied"]');
  await card.getByRole('button', { name: 'Ver comanda', exact: true }).click();
  await page.getByRole('dialog', { name: 'Consumo local · Mesa 07', exact: true })
    .getByRole('button', { name: 'Receber', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Dividir pagamento' }).check();
  const value = page.getByRole('textbox', { name: /valor/i });
  await expect(value).toHaveValue('');
  await page.getByRole('button', { name: 'Pix', exact: true }).click();
  await value.fill('200,00');
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  await expect(page.getByText('Informe o valor desta parte, maior que zero e até o saldo restante.', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(0);

  await value.fill('50,00');
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  await expect(page.getByText('Tente novamente', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toMatchObject({ valor: 50, metodo: 'pix', item_ids: null });
  expect(attempts[0].idempotency_key).toBe(attempts[1].idempotency_key);

  // The fixture intentionally does not mutate the backend order projection.
  // A second charge must remain blocked until a new canonical paid balance arrives.
  await expect(page.getByText(/Conferindo o saldo atualizado com o servidor/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Sincronizando saldo/ })).toBeDisabled();
  expect(attempts).toHaveLength(2);
});

test('Pix e dinheiro sequenciais dependem de duas projeções financeiras do backend', async ({ page }) => {
  await openOperationalScenario(page, { subtab: 'mesas', canonicalIdentity: true, statuses: ['entregue', 'entregue'] });
  let paidOnServer = 0;
  const payments: { valor: number; metodo: string; idempotency_key: string }[] = [];
  const item = (id: number, price: number) => ({
    id: `item-phase7-${id}`,
    lancamento_id: `launch-phase7-${id}`,
    produto_id: `product-phase7-${id}`,
    preco_unit: price,
    status: 'entregue',
    pago: false,
    cliente_nome: 'Consumo Geral',
    observacao: '',
    produto: { id: `product-phase7-${id}`, nome: `Prato ${id}`, preco: price, ativo: true },
  });
  await page.route(`${API_ORIGIN}/comandas/detalhes/todos**`, async route => {
    await route.fulfill({ json: [{
      id: 'check-phase7-24',
      restaurante_id: 99001,
      mesa_id: 7,
      garcom_id: 'cashier-phase7',
      criada_por: { nome: 'Operador Fase 7' },
      tipo: 'Consumo no Local',
      numero_pedido: 24,
      fechada: false,
      valor_pago: paidOnServer,
      criado_em: new Date(Date.now() - 12 * 60_000).toISOString(),
      status_comanda: null,
      lancamentos: [1, 2].map(id => ({
        id: `launch-phase7-${id}`,
        display_number: `24-${String.fromCharCode(64 + id)}`,
        comanda_id: 'check-phase7-24',
        origem: 'garcom',
      })),
      itens: [item(1, 112), item(2, 48)],
    }] });
  });
  await page.route(`${API_ORIGIN}/caixa/mesas/7/pagar`, async route => {
    const body = route.request().postDataJSON();
    payments.push(body);
    paidOnServer += body.valor;
    await route.fulfill({ json: { valor: body.valor, status: 'aprovado' } });
  });

  await page.locator('article[data-table-status="occupied"]')
    .getByRole('button', { name: 'Ver comanda', exact: true }).click();
  await page.getByRole('dialog', { name: 'Consumo local · Mesa 07', exact: true })
    .getByRole('button', { name: 'Receber', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Dividir pagamento' }).check();
  const value = page.getByRole('textbox', { name: /valor/i });
  await page.getByRole('button', { name: 'Pix', exact: true }).click();
  await value.fill('50,00');
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  await expect(page.getByText(/Saldo restante: R\$\s*110,00/)).toBeVisible();
  await page.getByRole('button', { name: 'Dinheiro', exact: true }).click();
  await expect(value).toHaveValue('110,00');
  await page.getByRole('button', { name: /Receber esta parte/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Dividir pagamento' })).toHaveCount(0);
  expect(payments.map(p => ({valor:p.valor,metodo:p.metodo}))).toEqual([
    { valor: 50, metodo: 'pix' },
    { valor: 110, metodo: 'dinheiro' },
  ]);
  expect(payments[0].idempotency_key).not.toBe(payments[1].idempotency_key);
});

test('planeja dinheiro, Pix e cartão; confirma três pagamentos sem quitar antes da última parte', async ({ page }) => {
  await openOperationalScenario(page, { subtab: 'mesas', canonicalIdentity: true, statuses: ['entregue', 'entregue'] });
  let paidOnServer = 0;
  const received: { valor: number; metodo: string; idempotency_key: string }[] = [];
  const item = (id: number, price: number) => ({
    id: `item-phase7-${id}`,
    lancamento_id: `launch-phase7-${id}`,
    produto_id: `product-phase7-${id}`,
    preco_unit: price,
    status: 'entregue',
    pago: false,
    cliente_nome: 'Consumo Geral',
    observacao: '',
    produto: { id: `product-phase7-${id}`, nome: `Prato ${id}`, preco: price, ativo: true },
  });
  await page.route(`${API_ORIGIN}/comandas/detalhes/todos**`, async route => {
    await route.fulfill({ json: [{
      id: 'check-phase7-24',
      restaurante_id: 99001,
      mesa_id: 7,
      garcom_id: 'cashier-phase7',
      criada_por: { nome: 'Operador Fase 7' },
      tipo: 'Consumo no Local',
      numero_pedido: 24,
      fechada: false,
      valor_pago: paidOnServer,
      criado_em: new Date(Date.now() - 12 * 60_000).toISOString(),
      status_comanda: null,
      lancamentos: [1, 2].map(id => ({
        id: `launch-phase7-${id}`,
        display_number: `24-${String.fromCharCode(64 + id)}`,
        comanda_id: 'check-phase7-24', origem: 'garcom',
      })),
      itens: [item(1, 112), item(2, 48)],
    }] });
  });
  await page.route(`${API_ORIGIN}/caixa/mesas/7/pagar`, async route => {
    const body = route.request().postDataJSON();
    received.push(body);
    paidOnServer += body.valor;
    await route.fulfill({ json: { valor: body.valor, status: 'aprovado' } });
  });

  await page.locator('article[data-table-status="occupied"]')
    .getByRole('button', { name: 'Ver comanda', exact: true }).click();
  await page.getByRole('dialog', { name: 'Consumo local · Mesa 07', exact: true })
    .getByRole('button', { name: 'Receber', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Dividir pagamento' }).check();
  await page.getByRole('button', { name: /Planejar divisão/ }).click();
  const plan = page.getByTestId('split-payment-plan');
  await expect(plan).toBeVisible();
  await plan.getByRole('button', { name: 'Adicionar forma' }).click();
  await plan.getByRole('combobox', { name: 'Forma da parte 1' }).selectOption('dinheiro');
  await plan.getByRole('textbox', { name: 'Valor da parte 1' }).fill('10,00');
  await plan.getByRole('combobox', { name: 'Forma da parte 2' }).selectOption('pix');
  await plan.getByRole('textbox', { name: 'Valor da parte 2' }).fill('40,00');
  await plan.getByRole('combobox', { name: 'Forma da parte 3' }).selectOption('cartao_debito');
  await plan.getByRole('textbox', { name: 'Valor da parte 3' }).fill('110,00');
  await expect(plan.getByText('Falta distribuir')).toBeVisible();
  await expect(plan.getByText(/Informe uma forma e valor positivo por parte/)).toHaveCount(0);

  await page.getByRole('button', { name: /Receber Dinheiro/ }).click();
  await expect(plan.getByRole('combobox', { name: 'Forma da parte 1' })).toHaveValue('pix');
  await expect(page.getByText(/Saldo restante: R\$\s*150,00/)).toBeVisible();
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ valor: 10, metodo: 'dinheiro' });

  await page.getByRole('button', { name: /Receber Pix/ }).click();
  await expect(plan.getByRole('combobox', { name: 'Forma da parte 1' })).toHaveValue('cartao_debito');
  await expect(page.getByText(/Saldo restante: R\$\s*110,00/)).toBeVisible();
  expect(received).toHaveLength(2);

  await page.getByRole('button', { name: /Receber Débito/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Dividir pagamento' })).toHaveCount(0);
  expect(received.map(x => ({ valor: x.valor, metodo: x.metodo }))).toEqual([
    { valor: 10, metodo: 'dinheiro' },
    { valor: 40, metodo: 'pix' },
    { valor: 110, metodo: 'cartao_debito' },
  ]);
  assertDistinctKeys(received.map(x => x.idempotency_key));
});

function assertDistinctKeys(keys: string[]) {
  expect(new Set(keys).size).toBe(keys.length);
}

