import pathModule from 'node:path';
import { expect, test } from '@playwright/test';

for (const path of ['/w/a#' + 'A'.repeat(32), '/whatsapp/avisos#token=' + 'B'.repeat(76), '/whatsapp/avisos#token=synthetic.legacy.jwt']) {
  test(`descadastro identifica a loja e exige confirmação: ${path.split('#')[0]} ${path.length}`, async ({ page }, testInfo) => {
    const seen: Array<{ path: string; token: string }> = [];
    await page.route('**/api/cardapio/whatsapp/opt-out**', async route => {
      const request = route.request();
      const requestPath = new URL(request.url()).pathname;
      seen.push({ path: requestPath, token: request.postDataJSON().token });
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: requestPath.endsWith('/preview') ? '{"restaurant_name":"D8 Burger"}' : '{"disabled":true}' });
    });
    await page.goto(path);
    await expect(page).toHaveURL(path.startsWith('/w/a') ? /\/w\/a$/ : /\/whatsapp\/avisos$/);
    const button = page.getByRole('button', { name: 'Parar avisos de D8 Burger', exact: true });
    await expect(button).toBeEnabled();
    expect(seen.every(r => r.path.endsWith('/preview'))).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(path.split('#')[1]);
    if (process.env.KOMA_VISUAL_OUTPUT_DIR && path.startsWith('/w/a')) {
      await page.screenshot({ path: pathModule.join(process.env.KOMA_VISUAL_OUTPUT_DIR, `descadastro-${testInfo.project.name}.png`), fullPage: true });
    }
    await button.click();
    await expect(page.getByRole('heading', { name: 'Avisos desativados' })).toBeVisible();
    if (process.env.KOMA_VISUAL_OUTPUT_DIR && path.startsWith('/w/a')) {
      await page.screenshot({ path: pathModule.join(process.env.KOMA_VISUAL_OUTPUT_DIR, `confirmado-${testInfo.project.name}.png`), fullPage: true });
    }
    expect(seen.filter(r => !r.path.endsWith('/preview'))).toHaveLength(1);
    await expect(page.getByText('Você não receberá novos avisos de D8 Burger neste número.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('link sem capability não permite descadastro', async ({ page }) => {
  await page.goto('/w/a');
  await expect(page.getByRole('alert')).toHaveText('Abra o link de descadastro recebido na mensagem.');
  await expect(page.getByRole('button')).toHaveCount(0);
});

test('falha na prévia bloqueia confirmação', async ({ page }) => {
  await page.route('**/api/cardapio/whatsapp/opt-out/preview', route => route.fulfill({status:404, body:'{}'}));
  await page.goto('/w/a#' + 'C'.repeat(32));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button')).toBeDisabled();
});
