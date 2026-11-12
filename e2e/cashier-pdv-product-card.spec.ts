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
  await expect(page.locator('.cashier-pdv-cart__cart-total')).toContainText('42,00');

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

  const switcher = page.getByRole('group', { name: 'Visualização do novo pedido' });
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
  await expect(page.locator('.cashier-pdv-cart__cart-total')).toContainText('84,00');

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

test('PDV review keeps modality and customer fields separate from order item editing', async ({ page }) => {
  await openNewOrder(page);
  const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first();
  await card.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();

  if ((page.viewportSize()?.width ?? 1366) < 1280) {
    await page.getByRole('button', { name: /Carrinho \(1\)/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Itens do pedido' })).toBeVisible();
  await expect(page.locator('.cashier-pdv-cart__line')).toHaveCount(1);
  await expect(page.getByText('Identificação do cliente', { exact: true })).toHaveCount(0);

  const line = page.getByTestId('cashier-pdv-cart-line');
  await line.locator('.cashier-pdv-cart__notes summary').click();
  await line.getByRole('textbox', { name: 'Observação de Risoto da casa' }).fill('Sem cebola');
  await expect(line.locator('.cashier-pdv-cart__notes summary')).toContainText('Sem cebola');

  await page.getByRole('button', { name: 'Continuar para finalizar' }).click();
  await expect(page.getByRole('heading', { name: 'Finalizar pedido' })).toBeVisible();
  await expect(page.getByText('Identificação do cliente', { exact: true })).toBeVisible();
  await expect(page.locator('.cashier-pdv-cart__line')).toHaveCount(0);
  await expect(page.locator('.cashier-pdv-cart__total')).toContainText('42,00');

  await page.getByRole('button', { name: 'Voltar aos itens do pedido' }).click();
  await expect(line).toContainText('Sem cebola');
  await expect(page.getByRole('heading', { name: 'Itens do pedido' })).toBeVisible();
});

test('PDV F4 reviews the destination before submission and allows modality shortcuts', async ({ page }) => {
  await openNewOrder(page);
  await page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first()
    .getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();

  await page.keyboard.press('F4');
  await expect(page.getByRole('heading', { name: 'Finalizar pedido' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Lançar Pedido/i })).toBeVisible();

  await page.keyboard.press('F3');
  const mobile = (page.viewportSize()?.width ?? 1366) < 1280;
  if (mobile) {
    await expect(page.getByRole('combobox', { name: 'Tipo de atendimento' })).toHaveValue('dine_in');
  } else {
    await expect(page.getByRole('button', { name: 'Consumo local' })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByLabel('Mesa', { exact: true })).toBeVisible();

  await page.keyboard.press('F2');
  if (mobile) {
    await expect(page.getByRole('combobox', { name: 'Tipo de atendimento' })).toHaveValue('pickup');
  } else {
    await expect(page.locator('.cashier-pdv-cart__modality-option').filter({ hasText: 'Retirada' })).toHaveAttribute('aria-pressed', 'true');
  }
});

test('PDV on 320px and 430px has no horizontal overflow in cart and review', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1366) >= 1024, 'Mobile-only widths');
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 760 });
    await openNewOrder(page);
    const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first();
    await card.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
    await page.getByRole('button', { name: /Carrinho \(1\)/ }).click();
    for (const stage of ['cart', 'review'] as const) {
      if (stage === 'review') await page.getByRole('button', { name: 'Continuar para finalizar' }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
  }
});

test('mobile operator changes service context without opening the checkout form', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1366) >= 1280, 'Mobile and tablet task switcher');
  await openNewOrder(page);
  const service = page.getByRole('combobox', { name: 'Tipo de atendimento' });
  await expect(service).toBeVisible();
  await expect(service).toHaveValue('pickup');
  const card = page.getByTestId('cashier-pdv-product-card').filter({ hasText: 'Risoto da casa' }).first();

  await service.selectOption('dine_in');
  await expect(service).toHaveValue('dine_in');
  await card.getByRole('button', { name: 'Adicionar Risoto da casa rapidamente' }).click();
  await page.getByRole('button', { name: 'Carrinho (1)' }).click();
  await expect(page.getByRole('button', { name: 'Continuar para finalizar' })).toBeVisible();
  await expect(page.locator('.cashier-pdv-cart__modality-section')).toBeHidden();
  await page.getByRole('button', { name: 'Continuar para finalizar' }).click();
  await expect(page.locator('#pdv-target-table')).toBeVisible();

  await service.selectOption('delivery');
  await expect(page.locator('#pdv-target-table')).toHaveCount(0);
  await expect(page.locator('#pdv-customer-phone-input')).toBeVisible();
  await expect(page.locator('#pdv-customer-name-input')).toBeVisible();
  await expect(page.locator('.cashier-pdv-cart__modality-section')).toBeHidden();
  await expect(page.locator('.cashier-pdv-cart__review-intro')).toBeHidden();
  await page.getByRole('button', { name: 'Voltar aos itens do pedido' }).click();
  await expect(page.getByTestId('cashier-pdv-cart-line')).toHaveCount(1);
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
