import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOrderSubmissionFingerprint,
  normalizePendingOrderSubmissions,
  resolveOrderSubmissionKey,
  upsertPendingOrderSubmission,
  type PendingOrderSubmission,
} from '../src/cardapio/orderSubmission';

const baseRequest = {
  restaurante_id: 901,
  itens: [{ produto_id: 'p1', quantidade: 1, observacao: '', modificador_ids: [] }],
  cliente_nome: 'Cliente',
  cliente_telefone: '81999990000',
  endereco_entrega: 'Rua A, 10',
  taxa_entrega: 7,
  forma_pagamento: 'na_entrega',
  forma_pagamento_detalhe: 'dinheiro',
  troco_para: 50,
  bairro: 'Centro',
  cupom_codigo: 'PRIMEIRA',
  usar_cashback: false,
  tipo_pedido: 'delivery',
  scheduled_for: null,
};

test('identificação da tentativa cobre pagamento, descontos e dados de entrega', () => {
  const original = buildOrderSubmissionFingerprint(baseRequest);
  for (const changed of [
    { forma_pagamento_detalhe: 'cartao_debito' },
    { troco_para: 100 },
    { endereco_entrega: 'Rua B, 20' },
    { bairro: 'Retiro' },
    { cupom_codigo: 'CLIENTE10' },
    { usar_cashback: true },
    { tipo_pedido: 'retirada' },
  ]) {
    assert.notEqual(
      buildOrderSubmissionFingerprint({ ...baseRequest, ...changed }),
      original,
    );
  }
});

test('timeout reutiliza a chave apenas quando a intenção do pedido é a mesma', () => {
  const fingerprint = buildOrderSubmissionFingerprint(baseRequest);
  const pending: PendingOrderSubmission = { key: 'same-attempt', fingerprint, createdAt: 1_000 };
  const args = {
    fingerprint,
    now: 1_100,
    ttlMs: 500,
    pending,
    currentKey: 'current-attempt',
    currentFingerprint: fingerprint,
    createKey: () => 'new-attempt',
  };

  assert.equal(resolveOrderSubmissionKey(args), 'same-attempt');
  assert.equal(resolveOrderSubmissionKey({
    ...args,
    fingerprint: `${fingerprint}-changed`,
  }), 'new-attempt');
  assert.equal(resolveOrderSubmissionKey({
    ...args,
    now: 2_000,
    pending: null,
  }), 'current-attempt');
});

test('tentativas diferentes coexistem e voltar à primeira preserva sua chave', () => {
  const firstFingerprint = buildOrderSubmissionFingerprint(baseRequest);
  const secondFingerprint = buildOrderSubmissionFingerprint({
    ...baseRequest,
    forma_pagamento_detalhe: 'cartao_debito',
  });
  let submissions = upsertPendingOrderSubmission([], {
    key: 'attempt-a', fingerprint: firstFingerprint, createdAt: 1_000,
  }, 1_000, 10_000);
  submissions = upsertPendingOrderSubmission(submissions, {
    key: 'attempt-b', fingerprint: secondFingerprint, createdAt: 2_000,
  }, 2_000, 10_000);

  const restored = normalizePendingOrderSubmissions(
    { submissions },
    2_100,
    10_000,
  ).find((item) => item.fingerprint === firstFingerprint) ?? null;
  assert.equal(resolveOrderSubmissionKey({
    fingerprint: firstFingerprint,
    now: 2_100,
    ttlMs: 10_000,
    pending: restored,
    currentKey: 'attempt-b',
    currentFingerprint: secondFingerprint,
    createKey: () => 'duplicate-risk',
  }), 'attempt-a');
});

test('armazenamento migra formato antigo, remove expirados e limita crescimento', () => {
  assert.deepEqual(normalizePendingOrderSubmissions({
    key: 'legacy-key', fingerprint: 'legacy-fingerprint', createdAt: 900,
  }, 1_000, 500), [{
    key: 'legacy-key', fingerprint: 'legacy-fingerprint', createdAt: 900,
  }]);

  const submissions = Array.from({ length: 12 }, (_, index) => ({
    key: `key-${index}`,
    fingerprint: `fingerprint-${index}`,
    createdAt: index === 0 ? 100 : 1_000 + index,
  }));
  const normalized = normalizePendingOrderSubmissions(
    { submissions },
    2_000,
    1_500,
  );
  assert.equal(normalized.length, 8);
  assert.doesNotMatch(normalized.map((item) => item.key).join(','), /key-0/);
  assert.equal(normalized[0].key, 'key-11');
});
