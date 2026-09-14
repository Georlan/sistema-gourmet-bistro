import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('card do salão separa personalização dos controles rápidos de quantidade', () => {
  const panel = source('src/components/MenuPanel.tsx');

  assert.match(panel, /id=\{`customize-product-btn-\$\{product\.id\}`\}/);
  assert.match(panel, /onClick=\{\(\) => handleOpenConfig\(product\)\}/);
  assert.match(panel, /id=\{`product-quick-stepper-\$\{product\.id\}`\}/);
  assert.match(panel, /onClick=\{\(\) => handleQuickSubtract\(product\)\}/);
  assert.match(panel, /onClick=\{\(\) => handleQuickIncrement\(product\)\}/);
  assert.match(panel, /pointer-events-none[^>]*aria-live="polite"/);
  assert.doesNotMatch(panel, /<article[^>]*id=\{`product-card-\$\{product\.id\}`\}[^>]*onClick=/);
});

test('modal interno do salão usa o contrato canônico de quantidade de adicionais', () => {
  const panel = source('src/components/MenuPanel.tsx');

  assert.match(panel, /changeModifierQuantitySelection/);
  assert.match(panel, /modifierGroupSelectionValid/);
  assert.match(panel, /onQuantityChange=\{changeModifierQuantity\}/);
  assert.doesNotMatch(panel, /onToggle=\{toggleModifier\}/);
  assert.match(panel, /quantity > 1 \? `\$\{quantity\}x ` : ''/);
});
