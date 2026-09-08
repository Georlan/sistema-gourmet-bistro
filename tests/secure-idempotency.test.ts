import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const generator = source('../src/utils/secureIdempotency.ts');
const financialSources = [
  '../src/components/caixa/EstornoModal.tsx',
  '../src/components/caixa/checkout/useCheckoutController.ts',
  '../src/smartpos/SmartPosPaymentFlow.tsx',
  '../src/utils/operationalRequest.ts',
  '../src/cardapio/components/CardapioDigital.tsx',
].map((path) => ({ path, content: source(path) }));

test('idempotency generator uses only browser CSPRNG and fails closed', () => {
  assert.match(generator, /cryptoApi\.randomUUID/);
  assert.match(generator, /cryptoApi\.getRandomValues/);
  assert.match(generator, /refusing to create an idempotency key/);
  assert.doesNotMatch(generator, /Math\.random/);
});

test('financial and order flows share the secure idempotency generator', () => {
  for (const { path, content } of financialSources) {
    assert.match(content, /createSecureIdempotencyKey/, `${path} must use the shared secure generator`);
    assert.doesNotMatch(content, /Math\.random/, `${path} must never fall back to Math.random for idempotency`);
  }
});

test('public menu refuses to submit when secure entropy is unavailable', () => {
  const cardapio = financialSources.find(({ path }) => path.includes('CardapioDigital'))?.content ?? '';
  assert.match(cardapio, /createSecureIdempotencyKey\("order"\)/);
  assert.match(cardapio, /Não foi possível iniciar o pedido com segurança/);
  assert.match(cardapio, /let idempotencyKey: string/);
});
