import { expect, test } from '@playwright/test';

const annualPlans = [
  { plan: 'pro', monthly: 'R$ 129,00', equivalent: 'R$ 116,10', total: 'R$ 1.393,20', savings: 'R$ 154,80' },
  { plan: 'premium', monthly: 'R$ 249,00', equivalent: 'R$ 224,10', total: 'R$ 2.689,20', savings: 'R$ 298,80' },
] as const;

for (const { plan, monthly, equivalent, total, savings } of annualPlans) {
  test(`${plan}: cada clique do mensal ao anual preserva total e desconto no checkout`, async ({ page }) => {
    await page.route('**/api/contracts/payment-methods-v2', route => route.fulfill({
      json: { credit_card: true, pix: true, account_money: true, publicKey: 'TEST-public' },
    }));
    await page.goto('/#planos');
    const card = page.locator('.koma-plan-card').filter({ has: page.getByRole('heading', { name: new RegExp(plan, 'i') }) });
    await expect(card.locator('.koma-plan-price')).toHaveAttribute('aria-label', new RegExp(monthly.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(' ', '\\s*')));
    await page.getByRole('group', { name: 'Escolha entre cobrança mensal ou anual' }).getByRole('button', { name: /^Anual/ }).click();
    await expect(card.locator('.koma-plan-price')).toHaveAttribute('aria-label', new RegExp(equivalent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(' ', '\\s*')));
    await expect(card).toContainText(total);
    await expect(card).toContainText(savings);
    await card.getByRole('link', { name: new RegExp(`CONTRATAR ${plan}`, 'i') }).click();
    await expect(page).toHaveURL(new RegExp(`/contratar/${plan}\\?cobranca=anual`));
    await expect(page.getByRole('radio', { name: /^Anual/ })).toContainText(total);
    await expect(page.locator('.koma-sub-summary-price')).toContainText(equivalent);
    await expect(page.getByText('Total anual após o trial')).toBeVisible();
    await expect(page.locator('.koma-sub-summary-card').first()).toContainText(total);
    await page.getByRole('radio', { name: /^Mensal/ }).click();
    await expect(page.locator('.koma-sub-summary-price')).toContainText(monthly);
    await expect(page.getByText('Total anual após o trial')).toHaveCount(0);
    await page.getByRole('radio', { name: /^Anual/ }).click();
    await expect(page.locator('.koma-sub-summary-card').first()).toContainText(total);
    let savedCycle = '';
    await page.route('**/api/signups', async route => {
      const payload = route.request().postDataJSON();
      expect(payload.plan).toBe(plan);
      savedCycle = payload.billing_cycle;
      await route.fulfill({ status: 201, json: { id: `${plan}-annual-signup`, token: `${plan}-annual-resume`, message: 'Inscrição recebida.' } });
    });
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByLabel('Nome do restaurante', { exact: true }).fill('Bistrô Anual');
    await page.getByLabel('Seu nome', { exact: true }).fill('Ana Silva');
    await page.getByLabel('E-mail', { exact: true }).fill('ana@example.com');
    await page.getByLabel('WhatsApp', { exact: true }).fill('85999999999');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    expect(savedCycle).toBe('anual');
    await expect(page.locator('.koma-sub-summary-card').first()).toContainText(total);
  });
}
