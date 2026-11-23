import { expect, test } from '@playwright/test';
import { cashierConfig, mockCashierBackend } from './fixtures/cashier';

for (const profile of ['generic', 'marmitaria'] as const) {
  test(`${profile}: remove desconto direto, salva null e mantém preço normal ao reabrir`, async ({ page }) => {
    await mockCashierBackend(page);
    // Esta fixture abre diretamente o cadastro; a sessão padrão de Caixa
    // repõe a aba "operacao" e esconderia a lista de produtos.
    await page.addInitScript(() => {
      sessionStorage.setItem('koma_caixa_token', 'playwright-e2e-token');
      sessionStorage.setItem('koma_active_operational_portal', 'caixa');
      sessionStorage.setItem('koma_caixa_id', 'caixa-e2e');
      sessionStorage.setItem('koma_caixa_name', 'Caixa E2E');
      sessionStorage.setItem('koma_caixa_role', 'caixa');
      localStorage.setItem('token', 'playwright-e2e-token');
      sessionStorage.setItem('koma_active_tab', 'cardapio');
      sessionStorage.setItem('koma_active_subtab', 'produtos');
    });

    const category = { id: 'cat-pratos', nome: 'Pratos', destino_impressao: 'COZINHA' };
    const product = {
      id: 'promo-1',
      nome: 'Prato promocional',
      preco: 20,
      preco_promocional: 14,
      categoria_id: category.id,
      ativo: true,
      destaque: false,
      imagem: '',
      descricao: '',
    };
    let savedPayload: Record<string, unknown> | null = null;

    await page.route('**/caixa/configuracoes', route =>
      route.fulfill({ json: { ...cashierConfig, operation_profile: profile } }));
    await page.route('**/produtos/catalogo', route =>
      route.fulfill({ json: { categorias: [category], produtos: [product] } }));
    await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: [] }));
    await page.route('**/produtos/promo-1', async route => {
      expect(route.request().method()).toBe('PUT');
      savedPayload = route.request().postDataJSON() as Record<string, unknown>;
      Object.assign(product, savedPayload);
      await route.fulfill({ json: product });
    });

    await page.goto('/?view=caixa');
    const row = page.locator('article').filter({
      has: page.getByRole('heading', { name: 'Prato promocional', exact: true }),
    });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Editar', exact: true }).click();

    const editor = page.getByRole('dialog', { name: 'Editar produto' });
    const promoInput = editor.getByLabel('Preço promocional (Por R$)');
    await expect(promoInput).toHaveValue('14,00');
    await expect(editor.getByRole('button', { name: 'Remover desconto' })).toBeVisible();

    // "0,00" não pode bloquear o cancelamento: é interpretado como sem promoção.
    await promoInput.fill('0');
    await expect(promoInput).toHaveValue('');
    await promoInput.fill('1500');
    await expect(promoInput).toHaveValue('15,00');

    await editor.getByRole('button', { name: 'Remover desconto' }).click();
    await expect(promoInput).toHaveValue('');
    await expect(editor.getByText('Sem desconto: será cobrado o preço normal do produto.')).toBeVisible();
    await editor.getByRole('button', { name: 'Salvar alterações' }).click();

    await expect.poll(() => savedPayload).toMatchObject({
      preco: 20,
      preco_promocional: null,
    });
    await expect(editor).toHaveCount(0);
    expect(product.preco_promocional).toBeNull();

    await row.getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Editar produto' })
      .getByLabel('Preço promocional (Por R$)')).toHaveValue('');
  });
}
