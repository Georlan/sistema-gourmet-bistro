import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend } from './fixtures/cashier';

const addons = {
  id: 'addons', nome: 'Adicionais', min_selecoes: 0, max_selecoes: 4,
  tipo: 'opcional', recomendado: true,
  opcoes: ['Bacon', 'Cebola caramelizada', 'Cheddar', 'Ovo', 'Queijo coalho'].map((nome, index) => ({
    id: `addon-${index}`, grupo_id: 'addons', nome, preco_adicional: [4, 3, 3.5, 2.5, 5][index], ativo: true,
  })),
};
const beverage = {
  id: 'beverage', nome: 'Bebida', min_selecoes: 1, max_selecoes: 1,
  tipo: 'obrigatorio', recomendado: true,
  opcoes: [{ id: 'cola', grupo_id: 'beverage', nome: 'Coca-Cola lata', preco_adicional: 0, ativo: true }],
};

async function setup(page: Page) {
  await mockCashierBackend(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_waiter_token', 'layout-fixture-token');
    sessionStorage.setItem('koma_waiter_id', 'layout-waiter');
    sessionStorage.setItem('koma_waiter_name', 'Garçom Layout');
    sessionStorage.setItem('koma_user_role', 'garcom');
    sessionStorage.setItem('koma_active_operational_portal', 'garcom');
    localStorage.removeItem('koma_drafts_vFinal_v3');
  });
  await page.route('**/produtos/catalogo', route => route.fulfill({ json: {
    categorias: [{ id: 'burgers', nome: 'Hambúrgueres', destino_impressao: 'COZINHA' }],
    produtos: [
      { id: 'combo', nome: 'Combo Bacon', preco: 39.9, ativo: true, categoria_id: 'burgers', descricao: 'Hambúrguer + fritas individuais + bebida.', grupos_modificadores: [addons, beverage] },
      { id: 'burger', nome: 'D8 Bacon', preco: 29.9, ativo: true, categoria_id: 'burgers', descricao: 'Pão brioche, smash bovino e bacon.', grupos_modificadores: [addons] },
    ],
  } }));
  await page.goto('/?view=garcom');
  await page.locator('#mesa-card-10').click();
  await expect(page.locator('#customize-product-btn-combo')).toBeVisible();
}

async function assertSeparatedFooter(page: Page) {
  const geometry = await page.evaluate(() => {
    const rect = (id: string) => {
      const node = document.querySelector(`[data-testid="${id}"]`)!;
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return { dialog: rect('waiter-product-config'), body: rect('waiter-product-config-body'), footer: rect('waiter-product-config-footer'), width: innerWidth, height: innerHeight };
  });
  expect(geometry.body.bottom).toBeLessThanOrEqual(geometry.footer.top + 1);
  expect(geometry.footer.bottom).toBeLessThanOrEqual(geometry.height + 1);
  expect(geometry.footer.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.footer.right).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.footer.top).toBeGreaterThan(geometry.dialog.top);
}

async function scrollBody(page: Page, position: 'top' | 'middle' | 'bottom') {
  await page.getByTestId('waiter-product-config-body').evaluate((node, position) => {
    node.scrollTop = position === 'top' ? 0 : position === 'middle' ? (node.scrollHeight - node.clientHeight) / 2 : node.scrollHeight;
  }, position);
  await assertSeparatedFooter(page);
}

test('combo: bebida obrigatória primeiro, rodapé separado, adicionais e edição preservados', async ({ page }, testInfo) => {
  await setup(page);
  await page.locator('#customize-product-btn-combo').click();
  const dialog = page.getByTestId('waiter-product-config');
  const footer = page.getByTestId('waiter-product-config-footer');
  await expect(dialog.getByTestId('modifier-group').first()).toHaveAttribute('data-group-id', 'beverage');
  await expect(footer.getByRole('button', { name: 'Complete as escolhas' })).toBeDisabled();
  await scrollBody(page, 'top');
  await dialog.getByRole('button', { name: 'Adicionar uma unidade de Coca-Cola lata', exact: true }).click();
  await expect(footer.getByRole('button', { name: 'Adicionar ao pedido', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Adicionar uma unidade de Bacon', exact: true }).click();
  await expect(dialog.getByText('R$ 43,90', { exact: true })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Remover uma unidade de Bacon', exact: true }).click();
  await expect(dialog.getByText('R$ 39,90', { exact: true })).toHaveCount(1);
  await scrollBody(page, 'middle');
  await scrollBody(page, 'bottom');
  const lastAddon = dialog.getByRole('button', { name: 'Adicionar uma unidade de Queijo coalho', exact: true });
  await lastAddon.scrollIntoViewIfNeeded();
  await assertSeparatedFooter(page);
  await lastAddon.click();
  await expect(dialog.getByLabel('1 unidade(s) de Queijo coalho', { exact: true })).toBeVisible();
  await dialog.locator('#config-item-obs').fill('Sem cebola');
  await page.screenshot({ path: testInfo.outputPath('combo-config-footer.png') });
  await footer.getByRole('button', { name: 'Adicionar ao pedido', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.locator('#open-draft-cart-btn').click();
  await expect(page.getByText('R$ 44,90', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Editar Combo Bacon', exact: true }).click();
  await expect(dialog.locator('#config-item-obs')).toHaveValue('Sem cebola');
  await expect(dialog.getByLabel('1 unidade(s) de Coca-Cola lata', { exact: true })).toHaveText('1');
  await expect(dialog.getByLabel('1 unidade(s) de Queijo coalho', { exact: true })).toHaveText('1');
  await dialog.getByRole('button', { name: 'Remover uma unidade de Queijo coalho', exact: true }).click();
  await footer.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('R$ 39,90', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Editar Combo Bacon', exact: true }).click();
  await dialog.locator('#config-item-obs').fill('Alteração cancelada');
  await footer.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Combo Bacon', exact: true }).click();
  await expect(dialog.locator('#config-item-obs')).toHaveValue('Sem cebola');
});

test('hambúrguer: último adicional clicável e cancelar não cria rascunho', async ({ page }, testInfo) => {
  await setup(page);
  await page.locator('#customize-product-btn-burger').click();
  const dialog = page.getByTestId('waiter-product-config');
  const footer = page.getByTestId('waiter-product-config-footer');
  await expect(footer.getByRole('button', { name: 'Adicionar ao pedido', exact: true })).toBeEnabled();
  await scrollBody(page, 'top');
  await scrollBody(page, 'middle');
  await scrollBody(page, 'bottom');
  await dialog.getByRole('button', { name: 'Adicionar uma unidade de Queijo coalho', exact: true }).click();
  await expect(dialog.getByLabel('1 unidade(s) de Queijo coalho', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('burger-config-footer.png') });
  await footer.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#open-draft-cart-btn')).toHaveCount(0);
});
