import { expect, type Page, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function navigate(page: Page, label: string) {
  const targetLabel = label === 'Vendas' ? 'Vender' : label === 'Relatórios' ? 'Resultados' : label;
  const gestaoItems = ['Caixa', 'Estoque', 'Clientes', 'Equipe'];

  if (gestaoItems.includes(label)) {
    const subButton = page.getByRole('button', { name: new RegExp(`^${label}(?: \\d+)?$`) });
    if (!await subButton.isVisible()) {
      const openMenu = page.getByRole('button', { name: 'Abrir menu principal' });
      if (await openMenu.isVisible()) await openMenu.click();
      const gestaoButton = page.getByRole('button', { name: 'Gestão' });
      if (await gestaoButton.isVisible()) await gestaoButton.click();
    }
  }

  const button = page.getByRole('button', { name: new RegExp(`^(?:${targetLabel}|${label})(?: \\d+)?$`) });
  if (!await button.isVisible()) {
    const openMenu = page.getByRole('button', { name: 'Abrir menu principal' });
    if (await openMenu.isVisible()) await openMenu.click();
  }
  await button.click();
}

async function open(page: Page) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
}

test('caixa não baixa código ou CSS de rotas independentes', async ({ page }) => {
  const paths: string[] = [];
  page.on('request', request => paths.push(new URL(request.url()).pathname));
  await open(page);
  expect(paths.filter(path => /\/(?:CardapioPage|LandingPage|SuperAdminGate|CaixaAtivarPage|MotoboyPwaPage)[-.]/.test(path))).toEqual([]);
});

test('falha de rota exige recarga explícita e recupera sem atravessar autenticação', async ({ page }) => {
  await page.route('**/*CaixaAtivarPage*', route => route.abort('failed'), { times: 1 });
  await page.goto('/ativar');
  await expect(page.getByRole('alert')).toContainText('Não foi possível abrir ativação');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Recarregar página' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Recarregar página' }).click();
  await expect(page.getByRole('heading', { name: 'Ative sua Conta' })).toBeVisible();
  await page.goto('/super-admin');
  await expect(page.getByTestId('superadmin-login')).toBeVisible();
  await expect(page.locator('#superadmin-root')).toHaveCount(0);
});

test('mesa preserva formulário após falha e usa os mesmos dados na repetição', async ({ page }) => {
  await open(page);
  const bodies: unknown[] = [];
  await page.route('**/mesas/', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: bodies.length === 1 ? 503 : 200, json: bodies.length === 1 ? { detail: 'Falha controlada de mesa' } : { id: 31 } });
  });
  await navigate(page, 'Configurações');
  await page.getByRole('button', { name: 'Mesas', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar mesa', exact: true }).click();
  const form = page.locator('form').filter({ has: page.getByPlaceholder('Ex: 31') });
  await form.getByPlaceholder('Ex: 31').fill('31');
  await form.getByPlaceholder('Ex: 4').fill('6');
  await form.getByPlaceholder('Ex.: Varanda, Deck ou Mesa VIP').fill('Varanda de teste');
  await form.getByRole('button', { name: 'Adicionar mesa', exact: true }).click();
  await expect(form).toContainText('Falha controlada de mesa');
  await expect(form.getByPlaceholder('Ex: 31')).toHaveValue('31');
  await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await navigate(page, 'Vendas');
  await navigate(page, 'Configurações');
  await page.getByRole('button', { name: 'Adicionar mesa', exact: true }).click();
  await expect(form.getByPlaceholder('Ex.: Varanda, Deck ou Mesa VIP')).toHaveValue('Varanda de teste');
  await form.getByRole('button', { name: 'Adicionar mesa', exact: true }).click();
  await expect(form).toBeHidden();
  expect(bodies).toEqual([{ id: 31, capacidade: 6, nome: 'Varanda de teste' }, { id: 31, capacidade: 6, nome: 'Varanda de teste' }]);
});

test('edição e exclusão de mesa usam o ID escolhido e aguardam confirmação', async ({ page }) => {
  await open(page);
  const writes: { method: string; body: unknown }[] = [];
  await page.route('**/mesas/10', async route => {
    writes.push({ method: route.request().method(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, json: { id: 10 } });
  });
  await navigate(page, 'Configurações');
  await page.getByRole('button', { name: 'Mesas', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Mesa 10' }).click();
  const form = page.locator('form').filter({ has: page.getByPlaceholder('Mesa 10') });
  await form.getByPlaceholder('Mesa 10').fill('Terraço');
  await form.getByPlaceholder('Ex: 4').fill('8');
  await form.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(form).toBeHidden();
  expect(writes).toEqual([{ method: 'PUT', body: { capacidade: 8, nome: 'Terraço' } }]);
  await page.getByRole('button', { name: 'Editar Mesa 10' }).click();
  await form.getByRole('button', { name: 'Remover mesa do salão', exact: true }).click();
  expect(writes).toHaveLength(1);
  // Confirmation replaces the editable fields, so the old form locator no longer matches.
  await expect(page.getByText('Remover Mesa 10?', { exact: true })).toBeVisible();
  await test.info().attach('table-removal-confirmation', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Editar Mesa 10', exact: true })).toBeHidden();
  expect(writes[1]?.method).toBe('DELETE');
});

test('ingrediente conserva rascunho após erro e não muda o contrato monetário', async ({ page }) => {
  await open(page);
  const bodies: unknown[] = [];
  await page.route('**/estoque/insumos', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: bodies.length === 1 ? 503 : 200, json: { detail: 'Falha controlada de ingrediente' } });
  });
  page.on('dialog', dialog => dialog.accept());
  await navigate(page, 'Estoque');
  await page.getByRole('button', { name: 'Novo ingrediente', exact: true }).click();
  const form = page.locator('form').filter({ has: page.getByPlaceholder('ex: Contra Filé') });
  await form.getByPlaceholder('ex: Contra Filé').fill('Ingrediente de teste');
  await form.getByPlaceholder('ex: kg, un, l').fill('kg');
  await form.getByRole('button', { name: 'Criar Ingrediente', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(1);
  await expect(form.getByPlaceholder('ex: Contra Filé')).toHaveValue('Ingrediente de teste');
  await page.evaluate(() => window.dispatchEvent(new Event('koma-open-impressoras')));
  await expect(form).toBeHidden();
  await navigate(page, 'Estoque');
  await expect(form.getByPlaceholder('ex: Contra Filé')).toHaveValue('Ingrediente de teste');
  await form.getByRole('button', { name: 'Criar Ingrediente', exact: true }).click();
  await expect(form).toBeHidden();
  expect(bodies).toEqual([
    { nome: 'Ingrediente de teste', estoque_minimo: 10, estoque_maximo: 50, unidade_medida: 'kg', preco_medio_custo: 0 },
    { nome: 'Ingrediente de teste', estoque_minimo: 10, estoque_maximo: 50, unidade_medida: 'kg', preco_medio_custo: 0 },
  ]);
});

test('taxa compartilhada preserva o percentual entre telas e não altera permissões', async ({ page }) => {
  await open(page);
  const updates: unknown[] = [];
  await page.route('**/caixa/configuracoes', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    updates.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, json: {} });
  });
  await navigate(page, 'Configurações');
  await page.getByRole('button', { name: 'Taxa de Serviço', exact: true }).click();
  await page.getByRole('spinbutton').fill('12');
  await expect.poll(() => updates.length).toBe(1);
  expect(updates).toEqual([{ taxa_servico_padrao: 12 }]);
  await navigate(page, 'Vendas');
  await navigate(page, 'Configurações');
  await expect(page.getByRole('spinbutton')).toHaveValue('12');
  await test.info().attach('shared-service-tax', { body: await page.screenshot(), contentType: 'image/png' });
  expect(updates).toHaveLength(1);
});
