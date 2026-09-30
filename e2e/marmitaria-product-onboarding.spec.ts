import { expect, test } from '@playwright/test';
import { cashierConfig, mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('cadastro único reaproveita G e configura P/M na mesma categoria com preço e escolhas', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'produtos');
  });
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  const categories = [{ id: 'quentinhas', nome: 'Quentinhas', destino_impressao: 'COZINHA' }];
  const products: Record<string, unknown>[] = [{ id: 'original-g', nome: 'Quentinha G', categoria_id: 'quentinhas', preco: 10, ativo: true }];
  let sizes: Record<string, unknown>[] = [{ ...products[0], tamanho: 'G', regras: [], configurado: false }];
  const requests: Array<{ method: string; id: string }> = [];
  const groups = ['Proteínas', 'Guarnições'].map((nome, index) => ({
    id: `group-${index}`, nome, tipo: 'opcional', min_selecoes: 0, max_selecoes: 3,
    opcoes: ['Frango', 'Carne', 'Peixe'].map((name, i) => ({ id: `option-${index}-${i}`, nome: name, ativo: true, preco_adicional: 0 })), produto_ids: [], categoria_ids: [],
  }));
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, nicho: 'generico', operation_profile: 'marmitaria' } }));
  await page.route('**/produtos/catalogo', route => route.fulfill({ json: { categorias: categories, produtos: products } }));
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: groups }));
  await page.route('**/cardapio/modificadores/categorias-hierarquia', route => route.fulfill({ json: categories }));
  let failNext = false;
  await page.route('**/cardapio/marmitaria/tamanhos**', async route => {
    const method = route.request().method();
    if (method === 'GET') { await route.fulfill({ json: { enabled: true, tamanhos: sizes } }); return; }
    if (failNext) { failNext = false; await route.fulfill({ status: 409, json: { detail: 'Este tamanho já está cadastrado. Edite a marmita existente.' } }); return; }
    const payload = route.request().postDataJSON();
    const id = method === 'PUT' ? route.request().url().split('/').at(-1)! : `marmita-${payload.tamanho}`;
    requests.push({ method, id });
    const saved = { ...payload, id, categoria_id: 'quentinhas', configurado: true };
    sizes = [...sizes.filter(size => size.id !== id), saved];
    const product = { ...saved, marmitaria_tamanho: payload.tamanho.toLowerCase() };
    const position = products.findIndex(item => item.id === id);
    if (position >= 0) products[position] = product; else products.push(product);
    await route.fulfill({ status: method === 'POST' ? 201 : 200, json: saved });
  });
  await page.goto('/?view=caixa');
  const panel = page.getByRole('region', { name: 'Cadastro de marmitas' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Configurar marmita G', exact: true })).toHaveText(/10,00/);
  for (const [size, price, count] of [['G', '2800', 2], ['P', '1200', 1], ['M', '2000', 2]] as const) {
    await panel.getByRole('button', { name: `${size === 'G' ? 'Configurar' : 'Cadastrar'} marmita ${size}`, exact: true }).click();
    await panel.getByLabel('Preço da marmita').fill(price);
    for (const [index, choices] of [[0, count], [1, 3]]) {
      await panel.getByRole('button', { name: 'Adicionar escolhas' }).click();
      await panel.getByLabel(`Grupo ${index + 1}`, { exact: true }).selectOption(`group-${index}`);
      await panel.getByLabel(`Quantidade do grupo ${index + 1}`).fill(String(choices));
    }
    await panel.getByLabel('Disponível para venda').check();
    await panel.getByRole('button', { name: 'Salvar marmita' }).click();
    await expect(panel.getByRole('form')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: `Configurar marmita ${size}`, exact: true })).toBeEnabled();
  }
  expect(requests[0]).toEqual({ method: 'PUT', id: 'original-g' });
  expect(products).toHaveLength(3);
  expect(new Set(products.map(product => product.categoria_id))).toEqual(new Set(['quentinhas']));
  expect(sizes.find(size => size.id === 'original-g')?.preco).toBe(28);
  const large = sizes.find(size => size.id === 'original-g')!;
  expect(large.regras).toEqual([
    { grupo_id: 'group-0', minimo: 2, maximo: 2, modo_selecao: 'tipos' },
    { grupo_id: 'group-1', minimo: 3, maximo: 3, modo_selecao: 'tipos' },
  ]);
  await panel.getByRole('button', { name: 'Configurar marmita G', exact: true }).click();
  await panel.getByLabel('Permitir repetir grupo 1').check();
  failNext = true;
  await panel.getByRole('button', { name: 'Salvar marmita' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Este tamanho já está cadastrado. Edite a marmita existente.');
  await expect(panel.getByLabel('Preço da marmita')).toHaveValue(/28/);
  await panel.getByRole('button', { name: 'Salvar marmita' }).click();
  await expect(panel.getByRole('form')).toHaveCount(0);
  expect(products).toHaveLength(3);
  // Fotos e descrição continuam editando o mesmo produto, sem outro cadastro.
  await panel.getByRole('button', { name: 'Foto e descrição de Quentinha G', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Foto e descrição da marmita' });
  await expect(details.getByLabel('Nome do produto')).toHaveValue('Quentinha G');
  await expect(details.getByLabel('Nome do produto')).toHaveAttribute('readonly', '');
  await details.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('article').filter({ has: page.getByRole('heading', { name: 'Quentinha G', exact: true }) })).toHaveCount(0);
  const widths = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  expect(widths[1]).toBeLessThanOrEqual(widths[0] + 1);
  await page.getByRole('button', { name: 'Complementos', exact: true }).last().click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Cadastrar marmita/ })).toHaveCount(0);
});

test('salva preço pausado sem grupos e permite continuar o cadastro depois', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => { sessionStorage.setItem('koma_active_tab', 'cardapio'); sessionStorage.setItem('koma_active_subtab', 'produtos'); });
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'marmitaria' } }));
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: [] }));
  let saved: Record<string, unknown> | null = null;
  await page.route('**/cardapio/marmitaria/tamanhos**', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { enabled: true, tamanhos: saved ? [saved] : [] } }); return; }
    saved = { ...route.request().postDataJSON(), id: 'paused-p', configurado: true };
    await route.fulfill({ status: 201, json: saved });
  });
  await page.goto('/?view=caixa');
  const panel = page.getByRole('region', { name: 'Cadastro de marmitas' });
  await panel.getByRole('button', { name: 'Cadastrar marmita P' }).click();
  await panel.getByLabel('Preço da marmita').fill('1500');
  await expect(panel.getByLabel('Disponível para venda')).toBeDisabled();
  await panel.getByRole('button', { name: 'Salvar marmita' }).click();
  await expect(panel.getByRole('form')).toHaveCount(0);
  expect(saved).toMatchObject({ tamanho: 'P', preco: 15, ativo: false, regras: [] });
});

test('marmita antiga ativa sem escolhas pode ser pausada pelo cadastro único', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => { sessionStorage.setItem('koma_active_tab', 'cardapio'); sessionStorage.setItem('koma_active_subtab', 'produtos'); });
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'marmitaria' } }));
  await page.route('**/cardapio/modificadores/grupos', route => route.fulfill({ json: [] }));
  let saved = { id: 'old-g', tamanho: 'G', nome: 'Quentinha G', preco: 10, ativo: true, regras: [] };
  await page.route('**/cardapio/marmitaria/tamanhos**', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { enabled: true, tamanhos: [saved] } }); return; }
    expect(route.request().method()).toBe('PUT');
    expect(route.request().url()).toMatch(/old-g$/);
    saved = { ...saved, ...route.request().postDataJSON() };
    await route.fulfill({ json: saved });
  });
  await page.goto('/?view=caixa');
  const panel = page.getByRole('region', { name: 'Cadastro de marmitas' });
  await panel.getByRole('button', { name: 'Configurar marmita G', exact: true }).click();
  await expect(panel.getByLabel('Disponível para venda')).toBeEnabled();
  await panel.getByLabel('Disponível para venda').uncheck();
  await panel.getByRole('button', { name: 'Salvar marmita' }).click();
  await expect(panel.getByRole('form')).toHaveCount(0);
  expect(saved.ativo).toBe(false);
});
