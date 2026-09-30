import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { formatCardapioApiError } from '../src/cardapio/orderApiErrors';

test('formats FastAPI validation arrays into readable checkout guidance', () => {
  const message = formatCardapioApiError({
    detail: [
      {
        type: 'string_too_short',
        loc: ['body', 'cliente_telefone'],
        msg: 'String should have at least 10 characters',
      },
      {
        type: 'greater_than_equal',
        loc: ['body', 'itens', 1, 'quantidade'],
        msg: 'Input should be greater than or equal to 1',
      },
    ],
  });

  assert.match(message, /Telefone: preenchimento incompleto\./);
  assert.match(message, /Item 2 — Quantidade: valor abaixo do permitido\./);
  assert.doesNotMatch(message, /\[object Object\]/);
});

test('keeps server string details and safe fallback behavior', () => {
  assert.equal(
    formatCardapioApiError({ detail: 'Restaurante fechado.' }),
    'Restaurante fechado.',
  );
  assert.equal(
    formatCardapioApiError(null, 'Falha segura.'),
    'Falha segura.',
  );
});

test('checkout uses the formatter for failed order submissions', () => {
  const source = readFileSync(
    new URL('../src/cardapio/components/CardapioDigital.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /formatCardapioApiError/);
  assert.match(source, /throw new Error\(formatCardapioApiError\(data\)\)/);
  assert.match(source, /authRequestErrorMessage/);
  assert.doesNotMatch(source, /error instanceof Error\s*\? error\.message/);
});

test('formats cashier fields and nested modifier validation without exposing values', () => {
  const message = formatCardapioApiError({ detail: [
    { loc: ['body', 'itens', 0, 'modificador_ids', 2], type: 'string_type', input: 123 },
    { loc: ['body', 'delivery_forma_pagamento'], type: 'literal_error' },
    { loc: ['body', 'delivery_telefone'], type: 'string_too_short', input: 'private-phone' },
  ] });
  assert.equal(message, 'Revise os dados do pedido: Item 1 — Complementos: valor inválido. Forma de pagamento: opção inválida. Telefone: preenchimento incompleto.');
  assert.doesNotMatch(message, /private-phone|123|\[object Object\]/);
});
