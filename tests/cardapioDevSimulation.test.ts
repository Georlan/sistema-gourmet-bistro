import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDevPreviewRuntime,
  isLocalOpenStoreSimulation,
  isLocalOrderSimulation,
  readDevBrandColorOverride,
} from '../src/cardapio/devSimulation.ts';

test('produção (isDev=false) bloqueia todas as simulações e overrides mesmo com query params', () => {
  assert.equal(isDevPreviewRuntime(false), false);
  assert.equal(isLocalOpenStoreSimulation('?simular=aberto', false), false);
  assert.equal(isLocalOrderSimulation('?simular=aberto', false), false);
  assert.equal(isLocalOrderSimulation('?simular=pedido', false), false);
  assert.equal(readDevBrandColorOverride('?cor=ec4899', false), null);
});

test('ambiente dev/E2E (isDev=true) sem opt-in explícito mantém loja e pedidos 100% reais', () => {
  assert.equal(isDevPreviewRuntime(true), true);
  assert.equal(isLocalOpenStoreSimulation('', true), false);
  assert.equal(isLocalOpenStoreSimulation('?restaurante_id=6', true), false);
  assert.equal(isLocalOpenStoreSimulation('?simular=fechado', true), false);
  assert.equal(isLocalOrderSimulation('', true), false);
  assert.equal(isLocalOrderSimulation('?simular=fechado', true), false);
  assert.equal(readDevBrandColorOverride('', true), null);
});

test('ambiente dev com opt-in explícito ativa simulação e preview de cor válida', () => {
  assert.equal(isLocalOpenStoreSimulation('?simular=aberto', true), true);
  assert.equal(isLocalOrderSimulation('?simular=aberto', true), true);
  assert.equal(isLocalOpenStoreSimulation('?simular=pedido', true), false);
  assert.equal(isLocalOrderSimulation('?simular=pedido', true), true);
  assert.equal(readDevBrandColorOverride('?cor=ec4899', true), '#ec4899');
  assert.equal(readDevBrandColorOverride('?cor=%23f0a', true), '#ff00aa');
  assert.equal(readDevBrandColorOverride('?cor=javascript:alert(1)', true), null);
});
