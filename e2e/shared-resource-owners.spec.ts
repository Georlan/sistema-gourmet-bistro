import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function setup(page: Page) {
  // Behavior tests must not depend on the availability of the external font CDN.
  // Production styles are unchanged; visual density is covered by the salon suites.
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
}

async function open(page: Page) {
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
}

async function navigate(page: Page, label: string) {
  const sidebar = page.locator('.cashier-sidebar:visible');
  if (!await sidebar.isVisible()) await page.getByRole('button', { name: 'Abrir menu principal' }).click();
  await sidebar.getByRole('button', { name: new RegExp('^' + label + '(?: \\d+)?$') }).click();
}

function cashierSubnavButton(page: Page, name: string) {
  return page.locator('.cashier-subnav').getByRole('button', { name, exact: true });
}

const profile = {
  id: 99001, nome: 'Restaurante de teste', endereco: 'Rua de teste',
  status_override: 'Forçado Aberto', formas_pagamento_aceitas: ['Pix'],
  socials: {}, horarios_funcionamento: [], logo_url: '', banner_url: '',
};
// Development StrictMode probes mount/cleanup/mount; production mounts once.
const mountReads = process.env.KOMA_E2E_PREVIEW === 'true' ? 1 : 2;
const catalog = (name: string) => ({
  categorias: [{ id: 'cat-pratos', nome: 'Pratos', destino_impressao: 'COZINHA' }],
  produtos: [
    { id: '101', nome: name, preco: 42, categoria_id: 'cat-pratos', ativo: true },
    { id: '201', nome: 'Produto inativo', preco: 12, categoria_id: 'cat-pratos', ativo: false },
  ],
});

test('cardápio online usa um painel, preserva rascunho e repete publicação após erro', async ({ page }) => {
  await setup(page);
  const paths: string[] = [];
  page.on('request', request => paths.push(new URL(request.url()).pathname));
  const writes: any[] = [];
  await page.route('**/api/cardapio-digital/config', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: profile });
    writes.push(route.request().postDataJSON());
    await route.fulfill(writes.length === 1
      ? { status: 503, json: { detail: 'Publicação indisponível no teste' } }
      : { json: { ...profile, ...writes.at(-1) } });
  });
  await open(page);
  await navigate(page, 'Cardápio online');
  const name = page.getByPlaceholder('Ex.: Pizzeria Bella Italia');
  await expect(name).toHaveValue(profile.nome);
  await name.fill('Nome atualizado');
  await navigate(page, 'Vendas');
  await navigate(page, 'Cardápio online');
  await expect(name).toHaveValue('Nome atualizado');
  await page.getByRole('button', { name: 'Salvar e publicar', exact: true }).click();
  await expect(page.getByText('Publicação indisponível no teste', { exact: true })).toBeVisible();
  await expect(name).toHaveValue('Nome atualizado');
  await page.getByRole('button', { name: 'Salvar e publicar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tudo salvo', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0].nome).toBe('Nome atualizado');
  expect(paths.filter(path => path === '/api/cardapio-digital/config')).toHaveLength(mountReads + 2);
  expect(paths).not.toContain('/caixa/config-cardapio');
});

test('upload único valida arquivo e mantém logo e banner independentes', async ({ page }) => {
  await setup(page);
  await page.route('**/api/cardapio-digital/config', route => route.fulfill({ json: profile }));
  const writes: { path: string; method: string; contentType: string }[] = [];
  await page.route('**/api/cardapio-digital/assets/*', async route => {
    const path = new URL(route.request().url()).pathname;
    writes.push({ path, method: route.request().method(), contentType: route.request().headers()['content-type'] || '' });
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aObkAAAAASUVORK5CYII=';
    await route.fulfill({ json: { logo_url: image, banner_url: image } });
  });
  await open(page);
  await navigate(page, 'Cardápio online');
  await page.getByRole('button', { name: /^Marca/ }).click();
  const inputs = page.locator('input[type=file]');
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).setInputFiles({ name: 'invalido.txt', mimeType: 'text/plain', buffer: Buffer.from('teste') });
  await expect(page.getByText('Use PNG, JPG ou WEBP.', { exact: true })).toBeVisible();
  await inputs.nth(0).setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(page.getByText('A imagem deve ter no máximo 5 MB.', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  for (const index of [0, 1]) {
    await inputs.nth(index).setInputFiles({ name: 'imagem.png', mimeType: 'image/png', buffer: Buffer.from('fixture-upload') });
    await expect(page.getByText('Imagem atualizada e publicada.', { exact: true })).toHaveCount(index + 1);
  }
  expect(writes.map(write => write.path)).toEqual(['/api/cardapio-digital/assets/logo', '/api/cardapio-digital/assets/banner']);
  expect(writes.every(write => write.method === 'POST' && write.contentType.includes('multipart/form-data; boundary='))).toBe(true);
  await test.info().attach('shared-asset-uploader', { body: await page.screenshot(), contentType: 'image/png' });
});

test('catálogo administrativo e venda usam o mesmo snapshot sem GET ao trocar de aba', async ({ page }) => {
  await setup(page);
  let reads = 0;
  let name = 'Produto inicial';
  await page.route('**/produtos/catalogo', route => { reads++; return route.fulfill({ json: catalog(name) }); });
  await open(page);
  await navigate(page, 'Cardápio');
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByText('Produto inativo', { exact: true })).toBeVisible();
  const before = reads;
  await navigate(page, 'Vendas');
  await cashierSubnavButton(page, 'Novo pedido').click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByText('Produto inativo', { exact: true })).toBeHidden();
  expect(reads).toBe(before);
  name = 'Produto atualizado';
  await page.evaluate(() => window.dispatchEvent(new Event('koma-sync-all')));
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  expect(reads).toBe(before + 1);
  await navigate(page, 'Cardápio');
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  expect(reads).toBe(before + 1);
});

test('resposta antiga do catálogo não substitui refresh mais recente', async ({ page }) => {
  await setup(page);
  await open(page);
  await navigate(page, 'Cardápio');
  await expect(page.getByText('Risoto da casa', { exact: true })).toBeVisible();
  let reads = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/produtos/catalogo', async route => {
    const index = ++reads;
    if (index === 1) await pending;
    await route.fulfill({ json: catalog(index === 1 ? 'Resposta antiga' : 'Resposta atual') });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('koma-sync-all')));
  await expect.poll(() => reads).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('koma-sync-all')));
  await expect(page.getByText('Resposta atual', { exact: true })).toBeVisible();
  release();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText('Resposta atual', { exact: true })).toBeVisible();
  await expect(page.getByText('Resposta antiga', { exact: true })).toHaveCount(0);
});

test('401 antigo não encerra nova sessão, mas 401 da sessão atual retorna ao login', async ({ page }) => {
  await setup(page);
  await open(page);
  await navigate(page, 'Cardápio');
  await expect(page.getByText('Risoto da casa', { exact: true })).toBeVisible();
  let oldReads = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/produtos/catalogo', async route => {
    if (route.request().headers().authorization === 'Bearer session-new-fixture') {
      return route.fulfill({ json: catalog('Catálogo da nova sessão') });
    }
    oldReads++;
    await pending;
    await route.fulfill({ status: 401, json: { detail: 'Sessão antiga expirada' } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('koma-sync-all')));
  await expect.poll(() => oldReads).toBe(1);
  await page.evaluate(() => {
    localStorage.setItem('koma_caixa_token', 'session-new-fixture');
    localStorage.setItem('koma_caixa_id', 'operator-new-fixture');
    window.dispatchEvent(new Event('popstate'));
  });
  await expect(page.getByText('Catálogo da nova sessão', { exact: true })).toBeVisible();
  release();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText('Catálogo da nova sessão', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('koma_caixa_token'))).toBe('session-new-fixture');
  await page.route('**/produtos/catalogo', route => route.fulfill({ status: 401, json: { detail: 'Sessão atual expirada' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('koma-sync-all')));
  await expect(page.getByRole('button', { name: /Entrar/ })).toBeVisible();
  await expect(page.getByText('Catálogo da nova sessão', { exact: true })).toHaveCount(0);
});

test('estoque lê somente recursos da aba e mantém histórico completo', async ({ page }) => {
  await setup(page);
  const reads: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.startsWith('/estoque/')) reads.push(path);
  });
  await open(page);
  expect(reads).toEqual([]);
  await navigate(page, 'Estoque & compras');
  await expect(page.getByText('Arroz arbóreo', { exact: true }).first()).toBeVisible();
  expect(reads.sort()).toEqual(Array.from({ length: mountReads }, () => ['/estoque/fichas-tecnicas', '/estoque/insumos']).flat().sort());
  reads.length = 0;
  await cashierSubnavButton(page, 'Fornecedores').click();
  await expect(page.getByText('Distribuidora E2E', { exact: true }).first()).toBeVisible();
  expect(reads.sort()).toEqual(['/estoque/distribuidores', '/estoque/insumos']);
  reads.length = 0;
  await cashierSubnavButton(page, 'Histórico').click();
  await expect(page.getByText('Distribuidora E2E · NF-900', { exact: true })).toBeVisible();
  expect(reads.sort()).toEqual(['/estoque/distribuidores', '/estoque/entradas', '/estoque/insumos', '/estoque/movimentacoes', '/estoque/notas']);
});

test('permissões compartilham definição sem habilitar integrações pendentes', async ({ page }) => {
  await setup(page);
  const writes: any[] = [];
  await page.route('**/caixa/configuracoes', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    writes.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { detail: 'Permissão não salva no teste' } });
  });
  await open(page);
  await navigate(page, 'Configurações');
  await page.getByRole('button', { name: 'App do Garçom', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(7);
  await expect(page.getByRole('checkbox').and(page.locator(':disabled'))).toHaveCount(2);
  const delivery = page.getByRole('checkbox', { name: 'Permitir que garçom faça lançamentos de pedidos de delivery', exact: true });
  await expect(delivery).toBeChecked();
  // The accessible input is visually hidden; its visible label is the actual pointer target.
  await delivery.locator('..').click();
  await expect(page.getByText('Permissão não salva no teste', { exact: true })).toBeVisible();
  await expect(delivery).toBeChecked();
  expect(writes).toEqual([{ perm_garcom_delivery: false }]);
  await page.getByRole('button', { name: '2. Fechamento de Conta', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await expect(page.getByRole('checkbox').and(page.locator(':disabled'))).toHaveCount(2);
  await page.getByRole('button', { name: '3. Atendimento', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(5);
  await expect(page.getByRole('checkbox').and(page.locator(':disabled'))).toHaveCount(3);
});
