import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend } from './fixtures/cashier';

async function setup(page: Page, withDrafts = true) {
  await mockCashierBackend(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.addInitScript(({ withDrafts }) => {
    if (sessionStorage.getItem('app-owner-fixture')) return;
    sessionStorage.setItem('app-owner-fixture', '1');
    localStorage.setItem('koma_waiter_token', 'app-owner-fixture-token');
    localStorage.setItem('koma_waiter_id', 'waiter-app-owner');
    localStorage.setItem('koma_waiter_name', 'Operador de teste');
    if (withDrafts) {
      const draft = (id: number) => [{ id: `draft-${id}`, produtoId: '101', nome: 'Risoto da casa', preco: 42, quantidade: 2, observacao: 'Sem cebola', clienteNome: 'Cliente de teste' }];
      localStorage.setItem('koma_drafts_vFinal_v3', JSON.stringify({ 7: draft(7), 8: draft(8) }));
    }
  }, { withDrafts });
}

async function reviewDraft(page: Page, id = 7) {
  if (!await page.locator('#modal-outer-overlay').isVisible()) await page.locator(`#mesa-card-${id}`).click();
  await page.getByRole('tab', { name: /Cardápio/ }).click();
  await expect(page.getByRole('heading', { name: 'Revisar Pedido', exact: true })).toBeVisible();
}
const submit = (page: Page) => page.locator('[id^="submit-draft-order-btn"]:visible');

test('rascunho e chave de lançamento sobrevivem à falha, recarga e repetição', async ({ page }) => {
  await setup(page);
  const writes: any[] = [];
  await page.route('**/comandas/cmd-e2e-7/lancamentos', async route => {
    writes.push(route.request().postDataJSON());
    await route.fulfill({ status: writes.length === 1 ? 503 : 200, json: writes.length === 1 ? { detail: 'Falha controlada' } : { dispensado_impressao: true } });
  });
  await page.goto('/?view=garcom');
  await reviewDraft(page);
  await expect(page.getByLabel(/Cliente do pedido/)).toHaveValue('Cliente de teste');
  await submit(page).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.locator('#modal-outer-overlay')).toBeVisible();
  await reviewDraft(page);
  await expect(page.getByPlaceholder('Ex: sem cebola, molho à parte...')).toHaveValue('Sem cebola');
  await page.reload();
  // The selected table is restored asynchronously; do not click its card behind the restored modal.
  await expect(page.locator('#modal-outer-overlay')).toBeVisible();
  await reviewDraft(page);
  await expect(page.getByLabel(/Cliente do pedido/)).toHaveValue('Cliente de teste');
  await submit(page).click();
  await expect.poll(() => writes.length).toBe(2);
  await expect(page.locator('#modal-outer-overlay')).toBeHidden();
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0].idempotency_key).toEqual(expect.any(String));
  expect(writes[0].garcom_id).toBe('waiter-app-owner');
  expect(writes[0].itens).toEqual(Array.from({ length: 2 }, () => ({ produto_id: '101', observacao: 'Sem cebola', cliente_nome: 'Cliente de teste' })));
});

test('envio pendente bloqueia outro lançamento e preserva rascunhos de outras mesas', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  await page.route('**/comandas/cmd-e2e-7/lancamentos', async route => {
    writes++;
    await pending;
    await route.fulfill({ status: 503, json: { detail: 'Envio recusado no teste' } });
  });
  await page.goto('/?view=garcom');
  await reviewDraft(page);
  await submit(page).click();
  await expect.poll(() => writes).toBe(1);
  await expect(page.locator('#modal-outer-overlay')).toBeHidden();
  await reviewDraft(page, 8);
  await expect(submit(page)).toBeDisabled();
  expect(writes).toBe(1);
  release();
  await expect(page.getByRole('heading', { name: /Mesa 7/ })).toBeVisible();
  await reviewDraft(page);
  await expect(submit(page)).toBeEnabled();
  await page.locator('#close-mesa-modal-btn').click();
  await reviewDraft(page, 8);
  await expect(page.getByLabel(/Cliente do pedido/)).toHaveValue('Cliente de teste');
  await expect(submit(page)).toBeEnabled();
});

test('catálogo mantém compatibilidade de deploy sem liberar produtos inativos', async ({ page }) => {
  await setup(page, false);
  await page.route('**/produtos/catalogo', route => route.fulfill({ status: 404, json: {} }));
  await page.route('**/produtos/', route => route.fulfill({ json: [
    { id: '101', nome: 'Produto legado ativo', preco: 42, categoria_id: 'legacy-cat', ativo: true },
    { id: '102', nome: 'Produto legado inativo', preco: 12, categoria_id: 'legacy-cat', ativo: false },
  ] }));
  await page.route('**/produtos/categorias', route => route.fulfill({ json: [{ id: 'legacy-cat', nome: 'Categoria legada' }] }));
  await page.goto('/?view=garcom');
  await page.locator('#mesa-card-10').click();
  await expect(page.getByText('Produto legado ativo', { exact: true })).toBeVisible();
  await expect(page.getByText('Produto legado inativo', { exact: true })).toHaveCount(0);
});

test('401 no responsável de pedidos retorna ao login pelo contexto de sessão', async ({ page }) => {
  await setup(page, false);
  await page.route('**/comandas/detalhes/todos?fechada=false', route => route.fulfill({ status: 401, json: { detail: 'Sessão de teste expirada' } }));
  await page.goto('/?view=garcom');
  await expect(page.getByRole('button', { name: /Entrar/ })).toBeVisible();
  await expect(page.locator('#mesa-card-7')).toHaveCount(0);
});
