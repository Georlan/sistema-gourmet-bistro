import { expect, test } from '@playwright/test';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasOverflow).toBe(false);
}

test.describe('checkout público de adesão KÔMA', () => {
  test('seleciona plano e ciclo, sincroniza a URL e separa método ativo de previews', async ({ page }) => {
    await page.goto('/contratar');

    await expect(page.getByRole('heading', { name: 'Escolha o KÔMA certo para sua operação.' })).toBeVisible();

    const planGroup = page.getByRole('radiogroup', { name: 'Escolha um plano KÔMA' });
    const proPlan = planGroup.getByRole('radio', { name: /^Pro\b/ });
    const premiumPlan = planGroup.getByRole('radio', { name: /^Premium\b/ });

    await expect(proPlan).toHaveAttribute('aria-checked', 'true');
    await premiumPlan.click();
    await expect(premiumPlan).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/\/contratar\/premium\?cobranca=mensal$/);

    const billingGroup = page.getByRole('radiogroup', { name: 'Ciclo de cobrança' });
    const annualBilling = billingGroup.getByRole('radio', { name: /^Anual\b/ });
    await annualBilling.click();
    await expect(annualBilling).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/\/contratar\/premium\?cobranca=anual$/);
    await expect(page.getByText('Economize 10%', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Ative seu restaurante.' })).toBeVisible();

    const paymentGroup = page.getByRole('radiogroup', { name: 'Forma de pagamento disponível' });
    await expect(paymentGroup.getByRole('radio', { name: /^Cartão de crédito\b/ })).toBeVisible();
    await expect(paymentGroup.getByRole('radio')).toHaveCount(1);

    const pixPreview = page.getByRole('button', { name: /^Pix anual à vista\b/ });
    await expect(pixPreview).toBeVisible();
    await expect(page.getByRole('button', { name: /^NuPay\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Mercado Pago\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Anual parcelado no cartão\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Boleto bancário\b/ })).toBeVisible();

    await pixPreview.click();
    await expect(page.getByText('Pix anual à vista · em validação', { exact: true })).toBeVisible();
    await expect(page.getByText(/Este preview não gera cobrança/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceitar e registrar contratação' })).toBeDisabled();

    await expectNoHorizontalOverflow(page);
  });

  test('mensal preserva o trial e apresenta Pix Automático e NuPay como próximos meios', async ({ page }) => {
    await page.goto('/contratar/pocket?cobranca=mensal');

    const planGroup = page.getByRole('radiogroup', { name: 'Escolha um plano KÔMA' });
    await expect(planGroup.getByRole('radio', { name: /^Pocket\b/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('7 dias sem mensalidade fixa no cartão.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Continuar' }).click();
    const paymentGroup = page.getByRole('radiogroup', { name: 'Forma de pagamento disponível' });
    await expect(paymentGroup.getByRole('radio', { name: /^Cartão de crédito\b/ })).toBeVisible();
    await expect(paymentGroup.getByRole('radio')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Pix Automático\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^NuPay\b/ })).toBeVisible();
    await expect(page.getByText('Pix anual à vista')).toHaveCount(0);
    await expect(page.getByText('7 dias sem mensalidade fixa. A taxa por pedidos online pagos continua aplicável.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /^Pix Automático\b/ }).click();
    await expect(page.getByText('Pix Automático · em breve', { exact: true })).toBeVisible();
    await expect(page.getByText(/Não usaremos comprovante de Pix agendado/)).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });
});
