import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockCashierBackend, seedCashierSession, cashierConfig } from './fixtures/cashier';

test('daily marmitaria selection reviews once, preserves draft on failure and synchronizes extras', async ({ page }, info) => {
  test.skip(!['desktop-1366', 'mobile-390'].includes(info.project.name));
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'marmitaria' } }));
  const groups = [
    { id: 'proteins', nome: 'Proteínas', tipo: 'opcional', min_selecoes: 0, max_selecoes: 2, produto_ids: [], opcoes: [{ id: 'chicken', nome: 'Frango cozido', preco_adicional: 0, ativo: true }, { id: 'beef', nome: 'Acém cozido', preco_adicional: 0, ativo: false }] },
    { id: 'sides', nome: 'Guarnições', tipo: 'opcional', min_selecoes: 0, max_selecoes: 20, produto_ids: [], opcoes: [{ id: 'rice', nome: 'Arroz refogado', preco_adicional: 0, ativo: true }] },
    { id: 'salads', nome: 'Saladas', tipo: 'opcional', min_selecoes: 0, max_selecoes: 20, produto_ids: [], opcoes: [{ id: 'salad', nome: 'Vinagrete', preco_adicional: 0, ativo: true }] },
    { id: 'extras', nome: 'Adicionais pagos', grupo_origem_id: 'proteins', tipo: 'opcional', min_selecoes: 0, max_selecoes: 20, produto_ids: [], opcoes: [{ id: 'chicken-extra', opcao_origem_id: 'chicken', nome: 'Frango cozido adicional', preco_adicional: 5, ativo: true }] },
  ];
  let writes = 0;
  let failNext = true;
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: groups }));
  await page.route('**/cardapio/modificadores/categorias-hierarquia', route => route.fulfill({ json: [] }));
  await page.route('**/cardapio/modificadores/cardapio-diario', async route => {
    writes++;
    const request = route.request();
    expect(request.method()).toBe('PATCH');
    expect(request.postDataJSON()).toEqual({ opcoes: [
      { id: 'chicken', ativo: false, ativo_anterior: true },
      { id: 'beef', ativo: true, ativo_anterior: false },
    ] });
    if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { detail: 'Falha temporária ao salvar.' } }); }
    groups[0].opcoes[0].ativo = false;
    groups[0].opcoes[1].ativo = true;
    groups[3].opcoes[0].ativo = false;
    return route.fulfill({ json: { atualizadas: 2 } });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'complementos');
  });
  await page.goto('/?view=caixa');
  await expect(page.getByRole('heading', { name: 'O que vamos servir?' })).toBeVisible();
  const chicken = page.getByRole('checkbox', { name: 'Frango cozido — Proteínas', exact: true });
  const beef = page.getByRole('checkbox', { name: 'Acém cozido — Proteínas', exact: true });
  await expect(chicken).toBeChecked();
  await expect(beef).not.toBeChecked();
  const extras = page.getByRole('region', { name: 'Opções de Adicionais pagos' });
  const extra = extras.getByRole('article', { name: 'Frango cozido adicional — Adicionais pagos' });
  await expect(extras.getByRole('checkbox')).toHaveCount(0);
  await expect(extras.getByRole('button', { name: 'Cadastrar / editar' })).toHaveCount(0);
  await expect(extras.getByText('Automático', { exact: true })).toBeVisible();
  await expect(extra).toContainText('Disponível');
  await extra.click();
  expect(writes).toBe(0);
  await expect(page.getByRole('button', { name: 'Revisar alterações', exact: true })).toBeDisabled();
  await chicken.uncheck(); await beef.check();
  expect(writes).toBe(0);
  await expect(extra).toContainText('Pausado');
  await expect(extra).toContainText('R$ 5,00');
  await expect(page.getByRole('button', { name: 'Cadastros', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Revisar alterações', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Revisão do cardápio diário' })).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Salvar cardápio do dia', exact: true }).click();
  await expect(page.getByText('Falha temporária ao salvar.', { exact: false })).toBeVisible();
  await expect(beef).toBeChecked();
  await page.getByRole('button', { name: 'Salvar cardápio do dia', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revisar alterações', exact: true })).toBeDisabled();
  await expect(chicken).not.toBeChecked(); await expect(beef).toBeChecked();
  expect(writes).toBe(2);
  await page.getByLabel('Buscar opção do cardápio diário').fill('acem');
  await expect(beef).toBeVisible(); await expect(chicken).toHaveCount(0);
  await page.getByLabel('Buscar opção do cardápio diário').fill('');
  await page.getByLabel('Filtrar opções do dia').selectOption('pausadas');
  await expect(chicken).toBeVisible(); await expect(beef).toHaveCount(0);
  await page.getByLabel('Filtrar opções do dia').selectOption('todos');
  (groups[3].opcoes as any[]).push({ id: 'manual-extra', nome: 'Farofa extra', preco_adicional: 3, ativo: false });
  await page.reload();
  const manualExtra = extras.getByRole('checkbox', { name: 'Farofa extra — Adicionais pagos', exact: true });
  await expect(manualExtra).toBeEnabled();
  await expect(extras.getByRole('checkbox')).toHaveCount(1);
  await manualExtra.check();
  await expect(page.getByRole('button', { name: 'Revisar alterações', exact: true })).toBeEnabled();
  expect(writes).toBe(2);
  await page.getByRole('button', { name: 'Desfazer seleção', exact: true }).click();
  if (process.env.KOMA_DAILY_SCREENSHOTS) {
    await mkdir(process.env.KOMA_DAILY_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: `${process.env.KOMA_DAILY_SCREENSHOTS}/cardapio-diario-${info.project.name}.png`, fullPage: true });
  }
});
