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

test('cardápio da mesa usa um único scroll vertical e mantém navegação e revisão acessíveis', () => {
  const panel = source('src/components/MenuPanel.tsx');

  assert.match(panel, /id="menu-panel-root"/);
  assert.match(panel, /scrollIntoView\(\{ block: 'start', behavior: 'auto' \}\)/);
  assert.doesNotMatch(panel, /mesa-details-scroll-body/);
  assert.doesNotMatch(panel, /sm:max-h-\[58vh\] sm:overflow-y-auto/);
  assert.doesNotMatch(panel, /sm:max-h-\[42vh\] sm:overflow-y-auto/);
  assert.match(panel, /className="sticky bottom-0 z-40 border-t border-emerald-500\/20/);
  assert.doesNotMatch(panel, /fixed inset-x-0 bottom-0 z-\[70\]/);
});

test('categorias do cardápio têm navegação horizontal explícita no desktop', () => {
  const panel = source('src/components/MenuPanel.tsx');

  assert.match(panel, /id="menu-category-strip"/);
  assert.match(panel, /scrollCategories\(-1\)/);
  assert.match(panel, /scrollCategories\(1\)/);
  assert.match(panel, /left: direction \* 260/);
  assert.match(panel, /snap-x snap-proximity/);
  assert.match(panel, /Ver categorias anteriores/);
  assert.match(panel, /Ver próximas categorias/);
});

test('modal de personalização reserva espaço para o conteúdo passar acima do footer sticky', () => {
  const panel = source('src/components/MenuPanel.tsx');

  assert.match(
    panel,
    /max-h-\[92dvh\][^\n]*p-4 pb-24 sm:p-6 sm:pb-24[^\n]*overscroll-contain/,
  );
  assert.match(panel, /sticky bottom-0 z-20/);
  assert.match(panel, /Adicionar ao pedido/);
});
