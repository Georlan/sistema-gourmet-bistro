import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend } from './fixtures/cashier';

const key = 'koma_drafts_v4:99001:quick-waiter';
const plain = { id: 'plain-joao', produtoId: '101', nome: 'Hambúrguer', preco: 45, quantidade: 1, observacao: '', clienteNome: 'João' };
const customized = { ...plain, id: 'custom-ana', observacao: 'Sem cebola', clienteNome: 'Ana' };
async function open(page: Page, drafts = [plain, customized, { ...plain, id: 'plain-ana', clienteNome: 'Ana' }], associatedOrderClient?: string) {
  await mockCashierBackend(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.addInitScript(({ drafts, key }) => {
    sessionStorage.setItem('koma_waiter_token', 'quick-fixture-token');
    sessionStorage.setItem('koma_waiter_id', 'quick-waiter');
    sessionStorage.setItem('koma_waiter_name', 'Garçom Teste');
    sessionStorage.setItem('koma_user_role', 'garcom');
    sessionStorage.setItem('koma_active_operational_portal', 'garcom');
    sessionStorage.setItem('koma_operator_session_garcom', JSON.stringify({ expiresAt: Date.now() + 86400000, token: 'quick-fixture-token', user: { id: 'quick-waiter', nome: 'Garçom Teste', role: 'garcom', restaurante_id: 99001 } }));
    localStorage.setItem(key, JSON.stringify({ 10: drafts }));
  }, { drafts, key });
  await page.route('**/produtos/catalogo', route => route.fulfill({ json: {
    categorias: [{ id: 'burgers', nome: 'Hambúrgueres', destino_impressao: 'COZINHA' }],
    produtos: [{ id: '101', nome: 'Hambúrguer', preco: 45, ativo: true, categoria_id: 'burgers' },
      { id: 'combo', nome: 'Combo', preco: 55, ativo: true, categoria_id: 'burgers', grupos_modificadores: [{ id: 'drink', nome: 'Bebida', min_selecoes: 1, max_selecoes: 1, tipo: 'obrigatorio', opcoes: [{ id: 'cola', nome: 'Cola', preco_adicional: 0, ativo: true }] }] }],
  } }));
  if (associatedOrderClient) await page.route('**/comandas/detalhes/todos**', route => route.fulfill({ json: [{
    id: 'table-10-check', restaurante_id: 99001, mesa_id: 10, garcom_id: 'quick-waiter',
    tipo: 'Consumo no Local', numero_pedido: 10, fechada: false, valor_pago: 0, criado_em: new Date().toISOString(),
    itens: [{ id: 'served-item', produto_id: '101', preco_unit: 45, status: 'entregue', pago: false, cliente_nome: associatedOrderClient, produto: { id: '101', nome: 'Hambúrguer', preco: 45 } }],
  }] }));
  await page.goto('/?view=garcom');
  await page.locator(associatedOrderClient ? '#mesa-card-launch-10' : '#mesa-card-10').click();
  if (drafts.length > 0) await page.getByRole('button', { name: 'Mais itens', exact: true }).click();
}
const drafts = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}')[10] || [], key);

test('contador padrão altera apenas o cliente indicado e não recai no personalizado ao zerar', async ({ page }) => {
  await open(page);
  await expect(page.locator('#quick-entry-clients').getByRole('button', { name: 'Mesa', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#quick-entry-clients').getByRole('button', { name: 'João', exact: true }).click();
  const stepper = page.locator('#product-quick-stepper-101');
  await expect(stepper).toContainText('1');
  await expect(stepper).toHaveAttribute('aria-label', 'Quantidade padrão de Hambúrguer para João');
  await stepper.getByRole('button', { name: 'Aumentar Hambúrguer', exact: true }).click();
  await expect.poll(async () => (await drafts(page)).map((i: any) => [i.id, i.quantidade])).toEqual([['plain-joao', 2], ['custom-ana', 1], ['plain-ana', 1]]);
  await stepper.getByRole('button', { name: 'Diminuir Hambúrguer', exact: true }).click();
  await stepper.getByRole('button', { name: 'Diminuir Hambúrguer', exact: true }).click();
  await expect(page.locator('#add-product-btn-101')).toBeVisible();
  await expect.poll(async () => (await drafts(page)).map((i: any) => [i.id, i.quantidade])).toEqual([['custom-ana', 1], ['plain-ana', 1]]);
  await page.locator('#add-product-btn-101').click();
  await expect.poll(async () => (await drafts(page)).find((i: any) => i.clienteNome === 'Consumo Geral')?.quantidade).toBe(1);
  await expect.poll(async () => (await drafts(page)).filter((i: any) => i.clienteNome === 'Ana').map((i: any) => i.quantidade)).toEqual([1, 1]);
});

test('somente personalizado mantém Adicionar e cria uma unidade padrão separada', async ({ page }) => {
  await open(page, [customized]);
  await page.locator('#quick-entry-clients').getByRole('button', { name: 'Ana', exact: true }).click();
  await expect(page.locator('#product-quick-stepper-101')).toHaveCount(0);
  await page.locator('#add-product-btn-101').click();
  await expect.poll(async () => (await drafts(page)).map((i: any) => [i.observacao, i.quantidade])).toEqual([['Sem cebola', 1], ['', 1]]);
  await page.locator('#customize-product-btn-101').click();
  await expect(page.locator('#config-item-obs')).toBeVisible();
  await expect(page.locator('#config-client-name')).toHaveValue('Ana');
});

test('produto obrigatório já no rascunho continua exigindo configuração para nova unidade', async ({ page }) => {
  await open(page, [{ ...plain, id: 'configured', produtoId: 'combo', nome: 'Combo', preco: 55 }]);
  await expect(page.locator('#product-quick-stepper-combo')).toHaveCount(0);
  await page.locator('#add-product-btn-combo').click();
  await expect(page.getByRole('button', { name: 'Complete as escolhas', exact: true })).toBeDisabled();
  await expect(page.getByText('Bebida', { exact: true })).toBeVisible();
  await expect.poll(async () => (await drafts(page))[0].quantidade).toBe(1);
});


test('mesa sem nomes mantém fluxo direto e não mostra seletor de clientes', async ({ page }) => {
  await open(page, [{ ...plain, id: 'table-item', clienteNome: 'Consumo Geral' }]);
  await expect(page.locator('#quick-entry-clients')).toHaveCount(0);
  const stepper = page.locator('#product-quick-stepper-101');
  await expect(stepper).toHaveAttribute('aria-label', 'Quantidade padrão de Hambúrguer para a mesa');
  await stepper.getByRole('button', { name: 'Aumentar Hambúrguer', exact: true }).click();
  await expect.poll(async () => (await drafts(page)).map((i: any) => [i.clienteNome, i.quantidade])).toEqual([['Consumo Geral', 2]]);
});

test('troca de destino só afeta próximos itens e Mesa continua sendo o padrão', async ({ page }) => {
  await open(page);
  const clients = page.locator('#quick-entry-clients');
  await expect(clients.getByRole('button', { name: 'Mesa', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await clients.getByRole('button', { name: 'Ana', exact: true }).click();
  await page.locator('#product-quick-stepper-101').getByRole('button', { name: 'Aumentar Hambúrguer', exact: true }).click();
  await expect.poll(async () => (await drafts(page)).map((i: any) => [i.id, i.quantidade])).toEqual([['plain-joao', 1], ['custom-ana', 1], ['plain-ana', 2]]);
  await clients.getByRole('button', { name: 'Mesa', exact: true }).click();
  await page.locator('#add-product-btn-101').click();
  await expect.poll(async () => (await drafts(page)).filter((i: any) => !i.clienteNome || i.clienteNome === 'Consumo Geral').reduce((n: number, i: any) => n + i.quantidade, 0)).toBe(1);
  await expect.poll(async () => (await drafts(page)).filter((i: any) => i.clienteNome === 'Ana').map((i: any) => i.quantidade)).toEqual([1, 2]);
});

test('nome associado ao consumo da mesa aparece sem precisar de rascunho identificado', async ({ page }) => {
  await open(page, [], 'Mariana');
  const clients = page.locator('#quick-entry-clients');
  await expect(clients.getByRole('button', { name: 'Mesa', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await clients.getByRole('button', { name: 'Mariana', exact: true }).click();
  await page.locator('#add-product-btn-101').click();
  await expect.poll(async () => (await drafts(page))[0]?.clienteNome).toBe('Mariana');
});

test('ao sair o último nome associado, seletor desaparece e novo item volta para a mesa', async ({ page }) => {
  await open(page, [plain]);
  await page.locator('#quick-entry-clients').getByRole('button', { name: 'João', exact: true }).click();
  await page.locator('#product-quick-stepper-101').getByRole('button', { name: 'Diminuir Hambúrguer', exact: true }).click();
  await expect(page.locator('#quick-entry-clients')).toHaveCount(0);
  await page.locator('#add-product-btn-101').click();
  await expect.poll(async () => (await drafts(page)).map((i: any) => [i.clienteNome, i.quantidade])).toEqual([['Consumo Geral', 1]]);
});


test('personalizar para a mesa não herda o cliente do primeiro item identificado', async ({ page }) => {
  await open(page);
  await page.locator('#customize-product-btn-101').click();
  await expect(page.locator('#config-client-name')).toHaveValue('');
  await page.locator('#config-item-obs').fill('Sem molho');
  await page.getByRole('button', { name: 'Adicionar ao pedido', exact: true }).click();
  await expect.poll(async () => (await drafts(page)).filter((i: any) => i.observacao === 'Sem molho').map((i: any) => [i.clienteNome, i.quantidade])).toEqual([['Consumo Geral', 1]]);
  await expect.poll(async () => (await drafts(page)).find((i: any) => i.id === 'plain-joao')?.quantidade).toBe(1);
});
