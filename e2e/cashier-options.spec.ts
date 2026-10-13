import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

const operatorName = 'Administradora do Restaurante com Nome Completo Muito Longo';

async function openOptions(page: import('@playwright/test').Page, theme: 'light' | 'dark', size: 'grande' | 'gigante') {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.addInitScript(({ theme, size, name }) => {
    localStorage.setItem('@koma:theme', theme);
    localStorage.setItem('koma_font_size', size);
    sessionStorage.setItem('koma_caixa_name', name);
  }, { theme, size, name: operatorName });
  await page.goto('/?view=caixa');
  if ((page.viewportSize()?.width ?? 1366) < 1024) await page.getByRole('button', { name: 'Abrir menu principal', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir conta e preferências', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Conta e preferências' });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const [theme, size] of [['light', 'grande'], ['dark', 'gigante']] as const) {
  test(`preferences stay readable in ${theme} with ${size} text`, async ({ page }) => {
    const dialog = await openOptions(page, theme, size);
    await expect(dialog.getByText(operatorName, { exact: true })).toBeVisible();
    await expect(dialog.getByText('Status do Salão ao Vivo')).toHaveCount(0);
    await expect(dialog.getByText('Modo PDV Imersivo')).toHaveCount(0);
    await expect(dialog.getByText(/Dark Engine|Multi-Tenant/)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Atualizar pedidos', exact: true })).not.toBeVisible();
    await expect(dialog.locator('section').first()).toHaveJSProperty('scrollWidth', await dialog.locator('section').first().evaluate(el => el.clientWidth));
    for (const button of await dialog.getByRole('button').all()) {
      if (!await button.isVisible()) continue;
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(await button.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath(`preferencias-${theme}-${size}.png`) });
    await dialog.getByRole('button', { name: 'Padrão', exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('koma_font_size'))).toBe('padrao');
    await dialog.getByRole('button', { name: theme === 'light' ? 'Escuro' : 'Claro', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-koma-theme', theme === 'light' ? 'dark' : 'light');
    await dialog.getByText('Recuperação', { exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Atualizar pedidos', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    const opener = (page.viewportSize()?.width ?? 1366) < 1024 ? page.locator('#btn-mobile-caixa-sidebar-open') : page.getByRole('button', { name: 'Abrir conta e preferências', exact: true });
    await expect(opener).toBeFocused();
  });
}

for (const denied of [false, true]) {
  test(`sound test reports browser permission ${denied ? 'denied' : 'allowed'} without claiming audible output`, async ({ page }) => {
    await page.addInitScript((denied) => {
      const w = window as any;
      w.testNotes = 0;
      class FakeAudioContext {
        state = 'suspended'; currentTime = 0; destination = {};
        async resume() { if (denied) throw new Error('blocked'); this.state = 'running'; }
        async close() { this.state = 'closed'; }
        createOscillator() { return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() { w.testNotes++; }, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      }
      w.AudioContext = FakeAudioContext;
    }, denied);
    const dialog = await openOptions(page, 'dark', 'grande');
    const before = await page.evaluate(() => (window as any).testNotes);
    await dialog.getByRole('button', { name: 'Testar som', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText(denied ? 'O navegador não liberou o áudio' : 'Confira se ouviu o bip');
    if (denied) expect(await page.evaluate(() => (window as any).testNotes)).toBe(before);
    else await expect.poll(() => page.evaluate(() => (window as any).testNotes)).toBeGreaterThan(before);
  });
}
