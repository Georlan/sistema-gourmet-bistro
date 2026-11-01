import { expect, test, type Page } from '@playwright/test';
import { openOperationalScenario } from './fixtures/operational';

async function openAccount(page: Page) {
  await expect(page.locator('.cashier-shell')).toBeVisible();
  const opener = page.getByRole('button', { name: 'Abrir conta e preferências', exact: true });
  if (!await opener.isVisible()) await page.getByRole('button', { name: 'Abrir menu principal', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir conta e preferências', exact: true }).click();
  return page.getByRole('dialog', { name: 'Conta e preferências' });
}

for (const width of [320, 360, 390, 430, 768, 834, 1024, 1366, 1920]) {
  test(`account and two-state text control adapt to ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 740 : 900 });
    const { actions } = await openOperationalScenario(page);
    await expect(page.locator('html')).toHaveAttribute('data-koma-text-size', 'padrao');
    const text = page.locator('#btn-caixa-text-size');
    const theme = page.locator('#btn-caixa-theme');
    await expect(text).toBeVisible();
    const [t, f] = await Promise.all([theme.boundingBox(), text.boundingBox()]);
    expect(f!.x).toBeGreaterThan(t!.x);
    expect(Math.abs(f!.y - t!.y)).toBeLessThan(3);
    for (const size of ['grande', 'padrao'] as const) {
      await text.click();
      await expect(page.locator('html')).toHaveAttribute('data-koma-text-size', size);
      await expect(text).toHaveAttribute('aria-pressed', String(size === 'grande'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (const number of await page.locator('.orders-card__number:visible').all()) {
        expect(await number.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        const id = number.locator('strong');
        if (await id.count()) expect(await id.evaluate(el => el.scrollHeight <= parseFloat(getComputedStyle(el).lineHeight) + 2)).toBe(true);
      }
      const stages = page.getByRole('tablist', { name: 'Etapa dos pedidos' });
      if (await stages.isVisible()) {
        for (const tab of await stages.getByRole('tab').all()) { await tab.click(); await expect(tab).toHaveAttribute('aria-selected', 'true'); }
      } else {
        for (const column of await page.locator('.orders-column').all()) if (!await column.evaluate(el => el.classList.contains('is-channel-disabled'))) {
          await expect(column).toBeVisible();
          if (await column.locator('.orders-card').count()) expect((await column.boundingBox())!.width).toBeGreaterThan(280);
        }
      }
    }
    await text.click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-koma-text-size', 'grande');
    const dialog = await openAccount(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Tema', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Tamanho do texto', { exact: true })).toHaveCount(0);
    for (const control of await dialog.getByRole('button').all()) {
      if (await control.isVisible()) {
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await control.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
    }
    expect(await dialog.locator('.cashier-options').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`account-${width}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(actions).toHaveLength(0);
  });
}

test('text control supports keyboard and reduced motion without writes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { actions } = await openOperationalScenario(page);
  const control = page.locator('#btn-caixa-text-size');
  await control.focus(); await page.keyboard.press('Enter');
  await expect(control).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(control).toHaveAttribute('aria-pressed', 'false');
  expect(await control.locator('.cashier-text-toggle__letter').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(actions).toHaveLength(0);
});

test('account opens support ready to write and closes by backdrop', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openOperationalScenario(page);
  let dialog = await openAccount(page);
  await page.mouse.click(1000, 400);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir conta e preferências', exact: true })).toBeFocused();
  dialog = await openAccount(page);
  await dialog.getByRole('button', { name: 'Ajuda e feedback', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByPlaceholder('Escreva aqui…')).toBeFocused();
});


test('refresh uses the existing read endpoint and sound toggle persists locally', async ({ page }) => {
  await openOperationalScenario(page);
  await openAccount(page);
  const dialog = page.getByRole('dialog', { name: 'Conta e preferências' });
  const refresh = page.waitForRequest(request => new URL(request.url()).pathname === '/comandas/detalhes/todos' && request.method() === 'GET');
  await dialog.getByRole('button', { name: 'Atualizar pedidos', exact: true }).click();
  await refresh;
  await expect(page.getByRole('status').filter({ hasText: 'Consulta de atualização concluída.' })).toBeVisible();
  const sound = dialog.getByRole('switch', { name: 'Sons dos pedidos' });
  await expect(sound).toHaveAttribute('aria-checked', 'true');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('@koma:sound_enabled'))).toBe('false');
});

test('text glyph previews the next size on hover without changing the preference', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Hover is a mouse interaction.');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const { actions } = await openOperationalScenario(page);
  const control = page.locator('#btn-caixa-text-size');
  const glyph = control.locator('.cashier-text-toggle__letter');
  const transform = await glyph.evaluate(el => getComputedStyle(el).transform);
  await control.hover();
  await expect.poll(() => glyph.evaluate(el => getComputedStyle(el).transform)).not.toBe(transform);
  await expect(page.locator('html')).toHaveAttribute('data-koma-text-size', 'padrao');
  expect(actions).toHaveLength(0);
});
