import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

for (const viewport of viewports) {
  test(`ativação mantém labels associados aos campos no ${viewport.name}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?view=ativar');

    const email = page.getByLabel('E-mail de Login', { exact: true });
    const password = page.getByLabel('Nova Senha', { exact: true });
    const confirmation = page.getByLabel('Confirme a Senha', { exact: true });

    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(confirmation).toBeVisible();

    await page.getByText('E-mail de Login', { exact: true }).click();
    await expect(email).toBeFocused();

    await page.getByText('Nova Senha', { exact: true }).click();
    await expect(password).toBeFocused();

    await page.getByText('Confirme a Senha', { exact: true }).click();
    await expect(confirmation).toBeFocused();

    expect(consoleErrors).toEqual([]);
  });
}
