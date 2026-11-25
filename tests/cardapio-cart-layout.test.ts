import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const cart = source('../src/cardapio/components/CardapioCartDrawer.tsx');
const menuV2 = source('../src/cardapio/v2/MenuV2Experience.tsx');
const css = source('../src/cardapio/v2/komaMenu.css');
const ordersDrawer = source('../src/cardapio/components/CardapioOrdersDrawer.tsx');
const profileModal = source('../src/cardapio/components/CardapioUserProfileModal.tsx');
const authModal = source('../src/cardapio/components/CardapioAuthModal.tsx');

test('sacola e abas ficam abaixo do dock permanente (z-60), e modais bloqueantes ficam acima (>=70)', () => {
  const stickyNavLayer = Number(css.match(/\.km-sticky-nav\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  const dockLayer = Number(css.match(/\.km-dock-wrap\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  const cartLayer = Number(cart.match(/className="fixed inset-0 z-\[(\d+)\]/)?.[1]);
  const ordersLayer = Number(ordersDrawer.match(/className="fixed inset-0 z-(\d+)/)?.[1]);
  const profileLayer = Number(profileModal.match(/className="fixed inset-0 z-(\d+)/)?.[1]);
  const authLayer = Number(authModal.match(/zIndex:\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(stickyNavLayer) && Number.isFinite(dockLayer) && Number.isFinite(cartLayer));
  assert.equal(dockLayer, 60, 'dock permanente deve ficar em z-index 60');
  assert.ok(cartLayer > stickyNavLayer, 'sacola deve ficar acima das categorias sticky');
  assert.ok(cartLayer < dockLayer, 'sacola deve ficar abaixo do dock permanente');
  assert.ok(ordersLayer < dockLayer, 'pedidos deve ficar abaixo do dock permanente');
  assert.ok(profileLayer < dockLayer, 'perfil deve ficar abaixo do dock permanente');
  assert.ok(authLayer < dockLayer, 'login deve ficar abaixo do dock permanente');
  assert.doesNotMatch(authModal, /createPortal\(/, 'auth modal não pode aplicar inert em #root bloqueando o dock');

  for (const overlay of ['CardapioDigital', 'CardapioProductModal', 'CardapioPromotionWizard', 'CardapioStoreInfoDrawer', 'CardapioBenefitsDrawer']) {
    const content = source(`../src/cardapio/components/${overlay}.tsx`);
    const layer = Number(content.match(/fixed inset-0 z-\[(\d+)\]/)?.[1]);
    assert.ok(Number.isFinite(layer), `${overlay} deve definir z-[>=70]`);
    assert.ok(cartLayer < layer, `${overlay} deve ficar acima da sacola`);
    assert.ok(dockLayer < layer, `${overlay} deve ficar acima do dock`);
  }

  const page = source('../src/cardapio/CardapioPage.tsx');
  assert.match(page, /isTabSheetOpen\s*=\s*Boolean\(/);
  assert.match(page, /isBlockingModalOpen\s*=\s*Boolean\(/);
  assert.match(page, /dockHidden=\{isBlockingModalOpen\}/);
  assert.match(page, /id="page-pix-payment-modal-backdrop"[\s\S]*?z-\[75\]|z-\[75\][^>]*id="page-pix-payment-modal-backdrop"/);
});

test('sacola móvel acompanha a altura disponível, separa fisicamente a região de toque do dock em <768px', () => {
  assert.doesNotMatch(cart, /pb-\[86px\]/);
  assert.match(cart, /max-h-\[94dvh\]/);
  assert.equal((cart.match(/min-h-0[^"\n]*overflow-y-auto/g) ?? []).length, 2);
  assert.match(cart, /className="flex shrink-0 items-center justify-between/);
  assert.match(cart, /className="shrink-0 border-t[^"\n]*pb-3[^"\n]*md:pb-5/);
  assert.match(css, /#cart-overlay\s*\{[^}]*bottom:\s*calc\(76px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(css, /#cart-drawer-container\s*\{[^}]*max-height:\s*100%/);
  assert.match(css, /\.km-dock-wrap\s*\{[^}]*pointer-events:\s*auto/);
  assert.match(ordersDrawer, /pb-\[calc\(90px\+env\(safe-area-inset-bottom,0px\)\)\][^"\n]*md:pb-5/);
  assert.match(profileModal, /pb-\[calc\(90px\+env\(safe-area-inset-bottom,0px\)\)\][^"\n]*md:pb-6/);
  assert.match(authModal, /pb-\[calc\(88px\+env\(safe-area-inset-bottom,0px\)\)\]!\s*md:pb-6!/);
});

test('confirmação do pedido usa grid-cols-2 no mobile e safe-area no container rolável', () => {
  const digital = source('../src/cardapio/components/CardapioDigital.tsx');
  assert.match(digital, /createdOrder \? "h-auto max-h-\[94dvh\]" : "h-\[calc\(100dvh-16px\)\] max-h-\[calc\(100dvh-16px\)\]"/);
  assert.match(digital, /pb-\[calc\(1\.25rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
  assert.match(digital, /className="mt-3\.5 grid w-full max-w-md grid-cols-2 gap-2\.5 text-left"/);
});

test('fechar continua sendo um botão nomeado com alvo de toque de 44px', () => {
  assert.match(cart, /<button\s+type="button"\s+onClick=\{onClose\}[^>]*min-h-\[44px\][^>]*min-w-\[44px\][^>]*aria-label="Fechar sacola"[^>]*id="btn-close-cart"/);
  assert.match(cart, /if \(event.target === event.currentTarget\) onClose\(\)/);
});

test('aviso de item adicionado não encobre ações da sacola ou da confirmação', () => {
  const page = source('../src/cardapio/CardapioPage.tsx');
  assert.match(page, /\{notice && !isCartOpen && !isCheckoutOpen && \(/);
  assert.match(page, /onClose=\{\(\) => \{ setIsCartOpen\(false\); setCouponToApply\(""\); \}\}/);
});

test('gatilhos da sacola priorizam toque mobile e não disputam camada com o chat', () => {
  assert.match(menuV2, /!hasOpenOverlay && activeDockTab === "home" && cartCount > 0/);
  assert.match(css, /\.km-bag-fab-wrap\s*\{[^}]*z-index:\s*44;/);
  assert.match(ordersDrawer, /bottom-\[calc\(6\.75rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
  assert.match(ordersDrawer, /fixed right-4 z-40/);
});

test('ações sociais/táteis do cabeçalho mantêm alvo mínimo de 44px no celular', () => {
  assert.match(css, /\.km-soft-icon-btn\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/);
});
