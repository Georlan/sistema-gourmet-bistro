import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractErrorMessage,
  isValidPixPayerEmail,
  parsePaymentBlockError,
} from '../src/components/caixa/payments/paymentPendingClient';

test('parsePaymentBlockError decodes structured HTTP 409 conflict details', () => {
  const parsed = parsePaymentBlockError(
    {
      code: 'PAYMENT_DISCONNECT_BLOCKED',
      message: 'Resolva os Pix pendentes antes de desconectar.',
      blocking_count: 2,
      blocking_total_amount: '10.50',
      categories: {
        awaiting_payment: 1,
        creation_failed: 1,
        uncertain: 0,
        provider_query_failed: 0,
      },
      blocking_items: [
        {
          id: 'intent-1',
          comanda_id: 'cmd-1',
          order_number: 102,
          amount: '4.50',
          provider: 'pagbank',
          provider_label: 'PagBank',
          situation: 'creation_failed',
          situation_label: 'Falha na criação da cobrança',
          reason_title: 'PagBank recusou permissão',
          can_close_creation_failure: true,
          can_reconcile: false,
          requires_manual_escalation: false,
        },
        {
          id: 'intent-2',
          comanda_id: 'cmd-2',
          order_number: 103,
          amount: '6.00',
          provider: 'pagbank',
          provider_label: 'PagBank',
          situation: 'awaiting_payment',
          situation_label: 'Aguardando pagamento',
          reason_title: 'Aguardando confirmação',
          can_close_creation_failure: false,
          can_reconcile: true,
          requires_manual_escalation: false,
        },
      ],
    },
    'Fallback',
  );

  assert.equal(parsed.code, 'PAYMENT_DISCONNECT_BLOCKED');
  assert.equal(parsed.message, 'Resolva os Pix pendentes antes de desconectar.');
  assert.equal(parsed.blockingCount, 2);
  assert.equal(parsed.blockingTotalAmount, '10.50');
  assert.equal(parsed.categories?.creation_failed, 1);
  assert.equal(parsed.blockingItems.length, 2);
  assert.equal(parsed.blockingItems[0]?.order_number, 102);
  assert.equal(parsed.blockingItems[0]?.can_close_creation_failure, true);
  assert.equal(parsed.blockingItems[1]?.can_reconcile, true);
});

test('parsePaymentBlockError preserves legacy string 409 details and handles nullish fallbacks', () => {
  const legacy = parsePaymentBlockError('Resolva os Pix pendentes antes de desconectar.', 'Fallback');
  assert.equal(legacy.code, null);
  assert.equal(legacy.message, 'Resolva os Pix pendentes antes de desconectar.');
  assert.equal(legacy.blockingCount, 0);
  assert.deepEqual(legacy.blockingItems, []);

  const empty = parsePaymentBlockError(undefined, 'Erro padrão');
  assert.equal(empty.message, 'Erro padrão');
  assert.equal(extractErrorMessage({ message: 'Mensagem interna' }, 'Fallback'), 'Mensagem interna');
  assert.equal(extractErrorMessage({}, 'Fallback'), 'Fallback');
});

test('isValidPixPayerEmail enforces strict ASCII PagBank/MP payer email rules', () => {
  for (const valid of ['comprador@email.com', ' Ana+Teste@exemplo.com.br ', 'a@b.co', 'a@usp.br']) {
    assert.equal(isValidPixPayerEmail(valid), true, `Expected valid: ${valid}`);
  }
  for (const invalid of [
    '',
    'a@b.c',
    'user@example.c',
    'sem-arroba',
    'x @exemplo.com',
    '..a@exemplo.com',
    'a..b@exemplo.com',
    '.a@exemplo.com',
    'a.@exemplo.com',
    'a@b..com',
    'joão@exemplo.com',
    'a@b.123',
    `${'a'.repeat(250)}@x.co`,
  ]) {
    assert.equal(isValidPixPayerEmail(invalid), false, `Expected invalid: ${invalid.slice(0, 32)}`);
  }
});
