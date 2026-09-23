import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const cart = source('../src/cardapio/components/CardapioCartDrawer.tsx');
const page = source('../src/cardapio/CardapioPage.tsx');
const css = source('../src/cardapio/cardapioPublic.css');
const ordersDrawer = source('../src/cardapio/components/CardapioOrdersDrawer.tsx');

test('sacola fica acima do cabeçalho sem cobrir identificação ou checkout', () => {
  const headerLayer = Number(css.match(/\.cardapio-public-header\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  const cartLayer = Number(cart.match(/className="fixed inset-0 z-\[(\d+)\]/)?.[1]);
  assert.ok(Number.isFinite(headerLayer) && Number.isFinite(cartLayer));
  assert.ok(cartLayer > headerLayer);

  for (const overlay of ['CardapioAuthModal', 'CardapioDigital']) {
    const content = source(`../src/cardapio/components/${overlay}.tsx`);
    const layer = Number(content.match(/className="fixed inset-0 z-(\d+)/)?.[1]);
    assert.ok(cartLayer < layer, `${overlay} deve ficar acima da sacola`);
  }
});

test('sacola móvel acompanha a altura disponível e mantém rolagem interna flexível', () => {
  assert.match(css, /@media \(max-width: 639px\)\s*\{\s*#cart-drawer-container\s*\{[^}]*max-height: 94vh;\s*max-height: 94dvh;/);
  assert.equal((cart.match(/min-h-0[^"\n]*overflow-y-auto/g) ?? []).length, 2);
  assert.match(cart, /className="flex shrink-0 items-center justify-between/);
  assert.match(cart, /className="shrink-0 border-t/);
});

test('fechar continua sendo um botão nomeado com alvo de toque de 44px', () => {
  assert.match(cart, /<button\s+type="button"\s+onClick=\{onClose\}[^>]*min-h-\[44px\][^>]*min-w-\[44px\][^>]*aria-label="Fechar sacola"[^>]*id="btn-close-cart"/);
  assert.match(cart, /if \(event.target === event.currentTarget\) onClose\(\)/);
});

test('aviso de item adicionado não encobre ações da sacola ou da confirmação', () => {
  assert.match(page, /\{notice && !isCartOpen && !isCheckoutOpen && \(/);
  assert.match(page, /onClose=\{\(\) => \{ setIsCartOpen\(false\); setCouponToApply\(""\); \}\}/);
});

test('gatilhos da sacola priorizam toque mobile e não disputam camada com o chat', () => {
  assert.match(page, /cartCount > 0 && !hasOpenOverlay/);
  assert.match(page, /bottom-\[calc\(1\.25rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
  assert.match(page, /z-\[44\]/);
  assert.match(page, /touch-manipulation select-none/);
  assert.match(page, /onClick=\{openCart\}/);
  assert.match(ordersDrawer, /bottom-\[calc\(6\.75rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
  assert.match(ordersDrawer, /fixed right-4 z-40/);
});

test('sacola do cabeçalho tem alvo de toque de 44px no celular', () => {
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.cardapio-public-icon-button\.is-cart\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*touch-action:\s*manipulation;/);
});
