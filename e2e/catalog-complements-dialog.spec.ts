import { expect, test } from '@playwright/test';
import { cashierConfig, mockCashierBackend, seedCashierSession } from './fixtures/cashier';

for (const profile of ['generic', 'marmitaria', 'pizzaria', 'acai', 'churrasco']) {
  test(`${profile}: cadastro de complementos contém foco, fecha com Esc e protege o salvamento`, async ({ page }) => {
    await mockCashierBackend(page);
    await seedCashierSession(page);
    await page.addInitScript(() => {
      sessionStorage.setItem('koma_active_tab', 'cardapio');
      sessionStorage.setItem('koma_active_subtab', 'complementos');
    });
    await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: profile } }));
    await page.route('**/cardapio/modificadores/categorias-hierarquia', route => route.fulfill({ json: [] }));
    let releaseSave: (() => void) | undefined;
    let payload: Record<string, unknown> | undefined;
    const groups: Record<string, unknown>[] = [];
    await page.route('**/cardapio/modificadores/grupos', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: groups });
      payload = route.request().postDataJSON();
      await new Promise<void>(resolve => { releaseSave = resolve; });
      const group = { ...payload, id: 'local-group' };
      groups.push(group);
      await route.fulfill({ status: 201, json: group });
    });
    await page.goto('/?view=caixa');
    if (profile === 'marmitaria') await page.getByRole('button', { name: 'Cadastros', exact: true }).click();
    const opener = page.getByRole('button', { name: 'Novo Grupo', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Novo Grupo de Complementos', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Nome do Grupo', { exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'Criar Grupo', exact: true }).press('Tab');
    const close = dialog.getByRole('button', { name: 'Fechar cadastro de complementos', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    await dialog.getByLabel('Nome do Grupo', { exact: true }).fill('Escolhas locais');
    if (profile === 'marmitaria') {
      await dialog.getByLabel('Nome da nova opção', { exact: true }).fill('Opção de teste');
      await dialog.getByRole('button', { name: 'Adicionar à lista', exact: true }).click();
    } else {
      await dialog.getByLabel('Nome da opção 1', { exact: true }).fill('Opção de teste');
    }
    await dialog.getByRole('button', { name: 'Criar Grupo', exact: true }).click();
    await expect.poll(() => Boolean(releaseSave)).toBe(true);
    await expect(dialog.getByLabel('Nome do Grupo', { exact: true })).toBeDisabled();
    await expect(close).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    releaseSave?.();
    await expect(dialog).toHaveCount(0);
    expect(payload).toMatchObject({ nome: 'Escolhas locais', produto_ids: [], categoria_ids: [], opcoes: [{ nome: 'Opção de teste', preco_adicional: 0, ativo: true }] });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}


test('o dono diferencia escolhas incluídas de adicionais pagos sem mexer em regras avançadas', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'complementos');
  });
  await page.route('**/caixa/configuracoes', route => route.fulfill({
    json: { ...cashierConfig, operation_profile: 'generic' },
  }));
  await page.route('**/cardapio/modificadores/categorias-hierarquia', route => route.fulfill({ json: [] }));
  const groups: any[] = [];
  const saved: any[] = [];
  await page.route('**/cardapio/modificadores/grupos', route => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      saved.push(payload);
      const created = { ...payload, id: `group-${saved.length}`, opcoes: payload.opcoes.map((item: any, i: number) => ({ ...item, id: `option-${saved.length}-${i}` })) };
      groups.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    return route.fulfill({ json: groups });
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: 'Novo Grupo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo Grupo de Complementos' });
  await expect(dialog.getByLabel('Mínimo de seleções do grupo')).not.toBeVisible();
  await dialog.getByLabel('Nome do Grupo').fill('Ponto da carne');
  await dialog.getByRole('button', { name: 'Obrigatória · escolha uma' }).click();
  await dialog.getByLabel('Nome da opção 1').fill('Mal passado');
  await dialog.getByRole('button', { name: 'Criar Grupo' }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({
    tipo: 'obrigatorio',
    min_selecoes: 1,
    max_selecoes: 1,
    opcoes: [{ nome: 'Mal passado', preco_adicional: 0, ativo: true }],
  });
  await expect(page.getByText('Escolhas incluídas no preço')).toBeVisible();

  await page.getByRole('button', { name: 'Novo Grupo', exact: true }).click();
  await dialog.getByLabel('Nome do Grupo').fill('Extras do hambúrguer');
  await dialog.getByLabel('Nome da opção 1').fill('Bacon extra');
  await dialog.locator('input[step="0.01"]').first().fill('2');
  await dialog.getByRole('button', { name: 'Criar Grupo' }).click();
  await expect.poll(() => saved.length).toBe(2);
  expect(saved[1]).toMatchObject({
    tipo: 'opcional',
    min_selecoes: 0,
    max_selecoes: 1,
    opcoes: [{ nome: 'Bacon extra', preco_adicional: 2, ativo: true }],
  });
  await expect(page.getByText('Adicionais pagos', { exact: false })).toBeVisible();
});
