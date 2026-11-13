import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function openNewOrder(page: Parameters<typeof mockCashierBackend>[0]) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'balcao');
  });
  await page.goto('/?view=caixa');
  await expect(page.getByPlaceholder('Buscar item, descrição ou código')).toBeVisible();
}

test('PDV: quick-add and personalize are independent on desktop and mobile', async ({ page }) => {
  await openNewOrder(page);

  const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first();
  await expect(card).toBeVisible();

  const add = card.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' });
  const customize = card.getByRole('button', { name: 'Personalizar Risoto da casa' });
  await expect(add).toBeVisible();
  await expect(customize).toBeVisible();
  await expect(card.locator('.cashier-pdv-product-card__price')).toContainText('42,00');

  await add.click();
  await expect(card.locator('.cashier-pdv-product-card__quantity')).toHaveText('1');
  await expect(page.getByText('Personalizar item', { exact: true })).toHaveCount(0);

  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await page.getByRole('button', { name: /Carrinho \(1\)/ }).click();
  }
  await expect(page.locator('.cashier-pdv-cart__line').first()).toContainText('Risoto da casa');
  await expect(page.locator('.cashier-pdv-cart__total')).toContainText('42,00');

  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await page.getByRole('button', { name: 'Escolher itens' }).click();
  }
  await customize.click();
  await expect(page.getByText('Personalizar item', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar personalização' }).click();
});

test('PDV: readable product action and visible focus without horizontal overflow', async ({ page }) => {
  await openNewOrder(page);
  const card = page.getByTestId('cashier-pdv-product-card').first();
  const fontSize = await card.locator('.cashier-pdv-product-card__name').evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(13);

  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(el => el.clientWidth));

  const focusButton = card.getByRole('button', { name: /Personalizar/ });
  await page.keyboard.press('Tab');
  await focusButton.focus();
  await expect(focusButton).toBeFocused();
  const outline = await focusButton.evaluate(el => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});

test('PDV mobile cart dock stays above bottom navigation and supports a quick return to the catalog', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1366) >= 1024, 'Touch dock contract for narrow phone viewports');
  await openNewOrder(page);

  const switcher = page.getByRole('group', { name: 'Navegação e atendimento do novo pedido' });
  await expect(switcher.getByRole('button', { name: 'Escolher itens' })).toHaveAttribute('aria-current', 'page');

  const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first();
  await card.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();

  const dock = page.locator('.cashier-pdv-mobile-cart-cta');
  const navigation = page.locator('.cashier-mobile-bottom-bar');
  await expect(dock).toBeVisible();
  await expect(navigation).toBeVisible();

  const dockBox = await dock.boundingBox();
  const navBox = await navigation.boundingBox();
  expect(dockBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect((dockBox?.y ?? 0) + (dockBox?.height ?? 0)).toBeLessThanOrEqual((navBox?.y ?? 0) + 1);

  await dock.click();
  await expect(page.locator('#pdv-order-panel')).toBeVisible();
  await expect(dock).toHaveCount(0);
  await expect(switcher.getByRole('button', { name: /Carrinho \(1\)/ })).toHaveAttribute('aria-current', 'page');

  const cartRow = page.locator('.cashier-pdv-cart__line').first();
  await expect(cartRow).toContainText('Risoto da casa');
  await cartRow.getByRole('button', { name: 'Aumentar quantidade de Risoto da casa' }).click();
  await expect(page.locator('.cashier-pdv-cart__total')).toContainText('84,00');

  await switcher.getByRole('button', { name: 'Escolher itens' }).click();
  await expect(card.locator('.cashier-pdv-product-card__quantity')).toHaveText('2');
  await expect(dock).toBeVisible();
});

test('PDV mobile search and quantity controls remain comfortably touchable', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1366) >= 1024, 'Phone touch-target contract');
  await openNewOrder(page);
  const search = page.getByPlaceholder('Buscar item, descrição ou código');
  const searchBox = await search.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(searchBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  const categories = page.locator('.cashier-pdv-category');
  await expect(categories.first()).toHaveAttribute('aria-pressed', 'true');
  const categoryBox = await categories.first().boundingBox();
  expect(categoryBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('PDV lets the operator edit items and launch from a single order view', async ({ page }) => {
  await openNewOrder(page);
  const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first();
  await card.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();

  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await page.getByRole('button', { name: 'Carrinho (1)' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Pedido atual' })).toBeVisible();
  const panel = page.locator('.cashier-pdv-cart');
  const line = panel.getByTestId('cashier-pdv-cart-line');
  await expect(line).toHaveCount(1);
  await expect(panel.getByText('Identificação do cliente', { exact: true })).toBeVisible();
  await expect(panel.locator('#pdv-submit-btn')).toBeEnabled();
  await expect(page.locator('#pdv-review-btn')).toBeHidden();

  await line.locator('.cashier-pdv-cart__notes summary').click();
  await line.getByRole('textbox', { name: 'Observação de Risoto da casa' }).fill('Sem cebola');
  await expect(line.locator('.cashier-pdv-cart__notes summary')).toContainText('Sem cebola');
  await expect(panel.locator('.cashier-pdv-cart__total')).toContainText('42,00');

  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await page.getByRole('button', { name: 'Escolher itens' }).click();
    await expect(card.locator('.cashier-pdv-product-card__quantity')).toHaveText('1');
    await page.getByRole('button', { name: 'Carrinho (1)' }).click();
    await expect(line).toContainText('Sem cebola');
    await expect(panel.locator('#pdv-submit-btn')).toBeVisible();
  }
});

test('PDV F4 first exposes or focuses the submit button without launching a sale', async ({ page }) => {
  await openNewOrder(page);
  let saleCount = 0;
  page.on('request', request => { if (request.url().includes('/cardapio/modificadores/venda-direta')) saleCount += 1; });
  await page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first()
    .getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();

  await page.keyboard.press('F4');
  await expect(page.getByRole('heading', { name: 'Pedido atual' })).toBeVisible();
  await expect(page.locator('#pdv-submit-btn')).toBeFocused();
  expect(saleCount).toBe(0);

  await page.keyboard.press('F3');
  const mobile = (page.viewportSize()?.width ?? 1366) < 1280;
  if (mobile) {
    await expect(page.getByRole('combobox', { name: 'Tipo de atendimento' })).toHaveValue('dine_in');
  } else {
    await expect(page.getByRole('button', { name: 'Consumo local' })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.locator('#pdv-target-table')).toBeVisible();
  await expect(page.locator('#pdv-target-table')).toBeFocused();

  await page.keyboard.press('F2');
  if (mobile) {
    await expect(page.getByRole('combobox', { name: 'Tipo de atendimento' })).toHaveValue('pickup');
  } else {
    await expect(page.locator('.cashier-pdv-cart__modality-option').filter({ hasText: 'Retirada' })).toHaveAttribute('aria-pressed', 'true');
  }
  expect(saleCount).toBe(0);
});

test('PDV has no horizontal overflow at 320px and 430px with optional fields', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1366) >= 1024, 'Mobile-only widths');
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 760 });
    await openNewOrder(page);
    const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first();
    await card.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
    await page.getByRole('button', { name: /Carrinho \(1\)/ }).click();
    await expect(page.locator('#pdv-submit-btn')).toBeVisible();
    const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.getByRole('combobox', { name: 'Tipo de atendimento' }).selectOption('delivery');
    await expect(page.locator('#pdv-customer-phone-input')).toBeVisible();
    await expect(page.locator('#pdv-delivery-address-logradouro')).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
  }
});

test('mobile operator changes fulfillment without leaving the editable cart', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1366) >= 1280, 'Mobile and tablet task switcher');
  await openNewOrder(page);
  const service = page.getByRole('combobox', { name: 'Tipo de atendimento' });
  await expect(service).toHaveValue('pickup');
  const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first();
  await service.selectOption('dine_in');
  await card.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
  await page.getByRole('button', { name: 'Carrinho (1)' }).click();
  await expect(page.locator('#pdv-submit-btn')).toBeVisible();
  await expect(page.locator('#pdv-target-table')).toBeVisible();
  await expect(page.locator('.cashier-pdv-cart__modality-section')).toBeHidden();

  await service.selectOption('delivery');
  await expect(page.locator('#pdv-target-table')).toHaveCount(0);
  await expect(page.locator('#pdv-customer-phone-input')).toBeVisible();
  await expect(page.locator('#pdv-customer-name-input')).toBeVisible();
  await expect(page.locator('#pdv-delivery-address-logradouro')).toBeVisible();
  await expect(page.locator('.cashier-pdv-cart__modality-section')).toBeHidden();
  await expect(page.getByTestId('cashier-pdv-cart-line')).toHaveCount(1);
  await page.getByRole('button', { name: 'Escolher itens' }).click();
  await expect(card.locator('.cashier-pdv-product-card__quantity')).toHaveText('1');
  await page.getByRole('button', { name: 'Carrinho (1)' }).click();
  await expect(service).toHaveValue('delivery');
});

test('mobile service control and tasks share one row without horizontal overflow', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1366) >= 1280, 'Mobile and tablet task switcher');
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 760 });
    await openNewOrder(page);
    const tasks = page.getByRole('group', { name: 'Navegação e atendimento do novo pedido' });
    const service = tasks.getByRole('combobox', { name: 'Tipo de atendimento' });
    await expect(service).toBeVisible();
    const items = tasks.getByRole('button', { name: 'Escolher itens' });
    const taskBox = await items.boundingBox();
    const serviceBox = await service.boundingBox();
    expect(taskBox).not.toBeNull();
    expect(serviceBox).not.toBeNull();
    expect(Math.abs((taskBox?.y ?? 0) - (serviceBox?.y ?? 0))).toBeLessThan(8);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});


test('mobile unified checkout retains a sticky launch footer', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1366) >= 768, 'Phone-only sticky confirmation');
  await openNewOrder(page);
  await page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first()
    .getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
  await page.getByRole('button', { name: 'Carrinho (1)' }).click();
  const footer = page.locator('.cashier-pdv-cart__footer');
  await expect(footer).toBeVisible();
  await expect(page.locator('#pdv-submit-btn')).toBeEnabled();
  const position = await footer.evaluate((element) => getComputedStyle(element).position);
  expect(position).toBe('sticky');
  await expect(page.locator('.cashier-mobile-bottom-bar')).toBeVisible();
});


test('PDV customizer is scrollable but retains its total and confirm action at phone widths', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1366) >= 1024, 'Phone-only sizing');
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 700 });
    await openNewOrder(page);
    await page.getByRole('button', { name: 'Personalizar Risoto da casa' }).click();
    const dialog = page.getByRole('dialog', { name: 'Risoto da casa' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Fechar personalização' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Aumentar quantidade' }).click();
    await expect(dialog.locator('.cashier-pdv-config__total')).toContainText('84,00');
    await dialog.getByLabel('Observações (opcional)').fill('Sem cebola');
    const save = dialog.getByRole('button', { name: 'Adicionar ao pedido' });
    await expect(save).toBeVisible();
    const rect = await save.boundingBox();
    expect(rect).not.toBeNull();
    expect((rect?.y ?? 0) + (rect?.height ?? 0)).toBeLessThanOrEqual(701);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await save.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('pdv-added-feedback')).toHaveCount(0);
    await expect(page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first()).toHaveClass(/is-just-added/);
    await expect(page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first()
      .locator('.cashier-pdv-product-card__quantity')).toHaveText('2');
  }
});

test('PDV cart animation respects reduced motion, omits add toast and customization Escape restores focus', async ({ page }) => {
  await openNewOrder(page);
  const customize = page.getByRole('button', { name: 'Personalizar Risoto da casa' }).first();
  await customize.focus();
  await customize.click();
  await expect(page.getByRole('dialog', { name: 'Risoto da casa' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Risoto da casa' })).toHaveCount(0);
  await expect(customize).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
  await expect(page.getByTestId('pdv-added-feedback')).toHaveCount(0);
  const productCard = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first();
  await expect(productCard).toHaveClass(/is-just-added/);
  await expect(productCard).toHaveCSS('animation-name', 'none');
  const count = page.locator('.cashier-pdv-mobile-switch__count');
  await expect(count).toContainText('1');
  await expect(count).toHaveClass(/is-bumped/);
  await expect(count).toHaveCSS('animation-name', 'none');
});

test('PDV optional customer/payment panels preserve checkout context without additional modals', async ({ page }) => {
  await openNewOrder(page);
  await page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await page.getByRole('button', { name: 'Carrinho (1)' }).click();
  }
  const cart = page.locator('.cashier-pdv-cart');
  await expect(cart.getByText('Identificação do cliente', { exact: true })).toBeVisible();
  await cart.locator('details').filter({ hasText: 'Identificação do cliente' }).locator('summary').click();
  await cart.getByLabel('Telefone', { exact: true }).fill('(85) 98888-7777');
  await cart.getByLabel('Nome', { exact: true }).fill('Maria');
  await cart.locator('details').filter({ hasText: 'Pagamento' }).locator('summary').click();
  await expect(cart.getByRole('group', { name: 'Forma de pagamento' })).toBeVisible();
  await expect(cart.locator('#pdv-submit-btn')).toBeEnabled();
});


test('PDV phone sales tabs are always visible, left-aligned and scrollbar-free', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1366) >= 768, 'Phone-only horizontal navigation');

  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 780 });
    await openNewOrder(page);

    const nav = page.getByRole('navigation', { name: 'Telas desta área' });
    const strip = nav.locator('.cashier-subnav__scroll');
    await expect(nav).toBeVisible();
    await expect(nav.locator('.cashier-subnav__button')).toHaveCount(6);
    await expect(page.getByRole('button', { name: /(?:Mostrar|Ocultar) telas de Vendas/ })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Novo pedido', exact: true })).toHaveAttribute('aria-current', 'page');

    // Native touch scrolling remains available, but not the grey track
    // or the empty arrow gutter before the first destination.
    await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBe(0);
    const geometry = await strip.evaluate(el => {
      const viewport = el.getBoundingClientRect();
      const first = el.querySelector('button')!.getBoundingClientRect();
      return {
        leadingGap: Math.round(first.left - viewport.left),
        track: getComputedStyle(el).scrollbarWidth,
        overflow: el.scrollWidth - el.clientWidth,
      };
    });
    expect(geometry.leadingGap).toBeGreaterThanOrEqual(-1);
    expect(geometry.leadingGap).toBeLessThanOrEqual(2);
    expect(geometry.track).toBe('none');
    expect(geometry.overflow).toBeGreaterThan(0);
    await expect(nav.locator('.cashier-subnav__arrow').first()).toBeHidden();
    await expect(nav.locator('.cashier-subnav__arrow').last()).toBeHidden();

    const maxScroll = await strip.evaluate(el => {
      const max = el.scrollWidth - el.clientWidth;
      el.scrollLeft = max;
      return max;
    });
    await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    expect(Math.abs(await strip.evaluate(el => el.scrollLeft) - maxScroll)).toBeLessThanOrEqual(1);
    await nav.getByRole('button', { name: 'Retiradas', exact: true }).click();
    await nav.getByRole('button', { name: 'Novo pedido', exact: true }).click();
    await expect(nav).toBeVisible();
    await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBe(0);
    await expect(page.getByTestId('cashier-pdv-product-card').first()).toBeVisible();

    const horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  }
});

test('PDV keeps desktop sales navigation in the existing position', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1366) < 1280, 'Desktop-only navigation baseline');
  await openNewOrder(page);
  await expect(page.getByRole('navigation', { name: 'Telas desta área' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mostrar telas de Vendas' })).toHaveCount(0);
});


test('novice cashier cannot skip a required product choice via quick add', async ({ page }) => {
  await mockCashierBackend(page);
  await page.route('http://127.0.0.1:8000/produtos/catalogo', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        categorias: [{ id: 'meals', nome: 'Refeições' }],
        produtos: [{
          id: 'required-meal',
          nome: 'Marmita P',
          preco: 20,
          ativo: true,
          categoria_id: 'meals',
          grupos_modificadores: [{
            id: 'protein',
            nome: 'Escolha a proteína',
            min_selecoes: 1,
            max_selecoes: 1,
            tipo: 'obrigatorio',
            recomendado: true,
            opcoes: [
              { id: 'chicken', grupo_id: 'protein', nome: 'Frango', preco_adicional: 0, ativo: true },
              { id: 'beef', grupo_id: 'protein', nome: 'Carne', preco_adicional: 3, ativo: true },
            ],
          }],
        }],
      }),
    });
  });
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'balcao');
  });
  await page.goto('/?view=caixa');
  const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Marmita P' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Adicionar Marmita P rapidamente' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Escolher opções de Marmita P' }).click();
  const dialog = page.getByTestId('cashier-pdv-config-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Adicionar ao pedido' })).toBeDisabled();
  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await expect(page.getByRole('button', { name: /Carrinho \(0\)/ })).toBeVisible();
  } else {
    await expect(page.getByTestId('cashier-pdv-cart-line')).toHaveCount(0);
  }
  await dialog.getByRole('button', { name: 'Selecionar Frango' }).click();
  await expect(dialog.getByRole('button', { name: 'Adicionar ao pedido' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Adicionar ao pedido' }).click();
  await expect(dialog).toBeHidden();
  await expect(card.locator('.cashier-pdv-product-card__quantity')).toHaveText('1');
  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await page.getByRole('button', { name: /Carrinho \(1\)/ }).click();
  }
  await expect(page.getByTestId('cashier-pdv-cart-line')).toContainText('Frango');
});

test('four fixture-only cashiers stay responsive with 240 products and repeated additions', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Exercise synthetic burst once on a phone viewport');
  const numOperators = 4;
  const products = Array.from({ length: 240 }, (_, index) => ({
    id: 'burst-' + index,
    nome: 'Produto ' + index,
    preco: 10 + (index % 12),
    categoria_id: 'cat-' + (index % 24),
    ativo: true,
    grupos_modificadores: [],
  }));
  const categories = Array.from({ length: 24 }, (_, index) => ({
    id: 'cat-' + index, nome: 'Categoria ' + index,
  }));
  const sessions = await Promise.all(Array.from({ length: numOperators }, async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await mockCashierBackend(page);
    await page.route('http://127.0.0.1:8000/produtos/catalogo', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ categorias: categories, produtos: products }) });
    });
    await seedCashierSession(page);
    // The shared fixture initializes Pedidos. Navigate explicitly instead
    // of relying on browser-dependent ordering of multiple init scripts.
    let salePosts = 0;
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/cardapio/modificadores/venda-direta')) salePosts++;
    });
    return { context, page, getSalePosts: () => salePosts };
  }));
  try {
    const durations = await Promise.all(sessions.map(async ({ page }) => {
      await page.goto('/?view=caixa');
      const salesNav = page.getByRole('navigation', { name: 'Telas desta área' });
      await salesNav.getByRole('button', { name: 'Novo pedido', exact: true }).click();
      const search = page.getByRole('searchbox', { name: 'Buscar produtos do cardápio' });
      await expect(search).toBeVisible();
      const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: /^Produto 0/ }).first();
      const add = card.getByRole('button', { name: 'Adicionar Produto 0 rapidamente' });
      await expect(add).toBeVisible();
      const start = Date.now();
      for (let n = 0; n < 12; n++) await add.click();
      await expect(card.locator('.cashier-pdv-product-card__quantity')).toHaveText('12');
      await search.fill('Produto 199');
      await expect(page.getByTestId('cashier-pdv-product-card')).toHaveCount(1);
      await expect(page.getByTestId('cashier-pdv-product-card').first()).toContainText('Produto 199');
      return Date.now() - start;
    }));
    for (const { getSalePosts } of sessions) expect(getSalePosts()).toBe(0);
    const independent = sessions[1].page.getByRole('button', { name: /Carrinho \(12\)/ });
    await expect(independent).toBeVisible();
    const sorted = durations.slice().sort((a, b) => a - b);
    console.log('PDV fixture-only burst (4 independent sessions, 240 items each, 12 additions/session; not production TPS):', JSON.stringify({
      elapsedPerOperatorMs: durations,
      medianOperatorMs: sorted[2],
      maxOperatorMs: sorted[sorted.length - 1],
    }));
  } finally {
    await Promise.all(sessions.map(({ context }) => context.close()));
  }
});

test('PDV hides quick-add notification but keeps item-edit confirmation', async ({ page }) => {
  await openNewOrder(page);
  await page.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
  await expect(page.getByTestId('pdv-added-feedback')).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await page.getByRole('button', { name: 'Carrinho (1)' }).click();
  }
  await page.getByRole('button', { name: 'Editar Risoto da casa' }).click();
  const edit = page.getByRole('dialog', { name: 'Risoto da casa' });
  await expect(edit).toBeVisible();
  await edit.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByTestId('pdv-added-feedback')).toContainText('Item atualizado');
});
