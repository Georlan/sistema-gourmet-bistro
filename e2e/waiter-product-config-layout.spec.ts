import { expect, Page, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const APP_ORIGIN = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;

async function openCombo(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_waiter_token', 'waiter-layout-token');
    sessionStorage.setItem('koma_active_operational_portal', 'garcom');
    sessionStorage.setItem('koma_waiter_id', 'waiter-layout');
    sessionStorage.setItem('koma_waiter_name', 'Garçom Layout');
    sessionStorage.setItem('koma_user_role', 'garcom');
  });
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === APP_ORIGIN) return route.continue();
    if (url.origin !== API_ORIGIN) return route.abort();
    let body: unknown = [];
    if (url.pathname === '/mesas/') body = [{ id: 3, nome: 'Mesa 3', capacidade: 4, status: 'livre' }];
    if (url.pathname === '/atendimentos/mesas/3') body = { familias: [] };
    if (url.pathname === '/caixa/configuracoes') body = { perm_garcom_editar: true };
    if (url.pathname === '/produtos/catalogo') body = {
      categorias: [{ id: 'combos', nome: 'Combos', destino_impressao: 'COZINHA' }],
      produtos: [{ id: 'combo-bacon', nome: 'Combo Bacon', preco: 39.9, ativo: true, categoria_id: 'combos', descricao: 'Bacon + fritas individuais + bebida.', grupos_modificadores: [
        { id: 'extras', nome: 'Adicionais', tipo: 'opcional', min_selecoes: 0, max_selecoes: 4, recomendado: true, opcoes: Array.from({ length: 12 }, (_, i) => ({ id: `extra-${i}`, nome: `Adicional ${i + 1}`, preco_adicional: 2, ativo: true })) },
        { id: 'drink', nome: 'Bebida do combo', tipo: 'obrigatorio', min_selecoes: 1, max_selecoes: 1, recomendado: true, opcoes: [{ id: 'coke', nome: 'Coca-Cola lata', preco_adicional: 0, ativo: true }] },
      ] }],
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/?view=garcom');
  await page.locator('#mesa-card-3').click();
  await page.getByRole('button', { name: 'Configurar Combo Bacon', exact: true }).click();
}

for (const viewport of [
  { name: 'narrow', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test(`combo choices and footer stay usable at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openCombo(page);
    const dialog = page.getByRole('dialog', { name: 'Combo Bacon', exact: true });
    await expect(dialog).toBeVisible();
    const drink = dialog.getByText('Bebida do combo', { exact: true });
    const extras = dialog.getByText('Adicionais', { exact: true });
    const drinkBox = await drink.boundingBox();
    const extrasBox = await extras.boundingBox();
    expect(drinkBox!.y).toBeLessThan(extrasBox!.y);
    const confirm = dialog.getByRole('button', { name: 'Complete as escolhas', exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('button', { name: 'Adicionar uma unidade de Coca-Cola lata', exact: true }).click();
    const add = dialog.getByRole('button', { name: 'Adicionar ao pedido', exact: true });
    await expect(add).toBeEnabled();
    const last = dialog.getByRole('button', { name: 'Adicionar uma unidade de Adicional 12', exact: true });
    await last.scrollIntoViewIfNeeded();
    const lastBox = await last.boundingBox();
    const footerBox = await add.boundingBox();
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(footerBox!.y);
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(footerBox!.x + footerBox!.width).toBeLessThanOrEqual(viewport.width);
    await testInfo.attach(`combo-${viewport.name}`, { body: await page.screenshot(), contentType: 'image/png' });
    await last.click();
    const client = dialog.getByLabel('Identificar cliente (opcional)');
    await client.fill('Cliente Summit');
    const clientBox = await client.boundingBox();
    const footerAfterScroll = await add.boundingBox();
    expect(clientBox!.y + clientBox!.height).toBeLessThanOrEqual(footerAfterScroll!.y);
    await add.click();
    await expect(dialog).toHaveCount(0);
    await page.locator('#open-draft-cart-btn').click();
    await page.getByRole('button', { name: 'Editar Combo Bacon', exact: true }).click();
    await expect(dialog.getByLabel('Identificar cliente (opcional)')).toHaveValue('Cliente Summit');
    await expect(dialog.getByLabel('1 unidade(s) de Coca-Cola lata', { exact: true })).toHaveText('1');
    await expect(dialog.getByLabel('1 unidade(s) de Adicional 12', { exact: true })).toHaveText('1');
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
