import { test, expect } from '@playwright/test';
import { mockCashierBackend, seedCashierSession, cashierConfig } from './fixtures/cashier';

test('catalog search, alphabetical daily choices, add and remove preserve a failed edit', async ({ page }, info) => {
  test.skip(!['desktop-1366', 'mobile-390'].includes(info.project.name));
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, operation_profile: 'marmitaria' } }));
  const groups = [
    { id: 'proteins', nome: 'Proteínas', tipo: 'opcional', min_selecoes: 0, max_selecoes: 2, produto_ids: [], opcoes: [
      { id: 'chicken', nome: 'Frango cozido', preco_adicional: 0, ativo: true },
      { id: 'beef', nome: 'Acém cozido', preco_adicional: 0, ativo: false },
      { id: 'rib', nome: 'Costela cozida', preco_adicional: 0, ativo: false },
    ] },
    { id: 'extras', nome: 'Adicionais pagos', grupo_origem_id: 'proteins', tipo: 'opcional', min_selecoes: 0, max_selecoes: 20, produto_ids: [], opcoes: [{ id: 'rib-extra', opcao_origem_id: 'rib', nome: 'Costela cozida adicional', preco_adicional: 7, ativo: false }] },
  ] as any[];
  let writes = 0;
  let createdGroups = 0;
  await page.route('**/cardapio/modificadores/grupos', route => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      expect(payload.nome).toBe('Molhos');
      expect(payload.opcoes.map((option: any) => option.nome)).toEqual(['Molho caseiro']);
      createdGroups++;
      const group = { ...payload, id: 'sauces', opcoes: payload.opcoes.map((option: any) => ({ ...option, id: 'sauce' })) };
      groups.push(group);
      return route.fulfill({ json: group });
    }
    return route.fulfill({ json: groups });
  });
  await page.route('**/cardapio/modificadores/categorias-hierarquia', route => route.fulfill({ json: [] }));
  await page.route('**/cardapio/modificadores/grupos/proteins', route => {
    writes++;
    const payload = route.request().postDataJSON();
    expect(payload.opcoes.map((option: any) => option.nome)).toEqual(writes === 3 ? ['Peixe cozido', 'Acém cozido', 'Frango cozido', 'Porco cozido'] : ['Porco cozido', 'Acém cozido', 'Frango cozido']);
    expect(payload.opcoes.find((option: any) => option.nome === 'Acém cozido').id).toBe('beef');
    if (writes === 1) return route.fulfill({ status: 503, json: { detail: 'Falha temporária no cadastro.' } });
    groups[0].opcoes = payload.opcoes.map((option: any) => ({ ...option, id: option.id || (option.nome === 'Porco cozido' ? 'new-pork' : 'new-fish') }));
    groups[1].opcoes = [{ id: 'pork-extra', opcao_origem_id: 'new-pork', nome: 'Porco cozido adicional', preco_adicional: 5, ativo: true }];
    return route.fulfill({ json: groups[0] });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'cardapio');
    sessionStorage.setItem('koma_active_subtab', 'complementos');
  });
  await page.goto('/?view=caixa');
  const proteins = page.getByRole('region', { name: 'Opções de Proteínas' });
  await expect(proteins).toBeVisible();
  expect(await proteins.getByRole('checkbox').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(['Acém cozido — Proteínas', 'Costela cozida — Proteínas', 'Frango cozido — Proteínas']);
  await proteins.getByRole('button', { name: 'Cadastrar / editar' }).click();
  await expect(page.getByLabel('Sincronizar adicionais com')).not.toBeVisible();
  await page.getByLabel('Nome da nova opção').fill(' acem cozido ');
  await page.getByRole('button', { name: 'Adicionar à lista', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Essa opção já está na lista' })).toBeVisible();
  expect(writes).toBe(0);
  await page.getByLabel('Nome da nova opção').fill('');
  if (process.env.KOMA_ADD_SCREENSHOTS) {
    await page.locator('#complement-group-form').evaluate(form => { form.scrollTop = 0; });
    await page.screenshot({ path: `${process.env.KOMA_ADD_SCREENSHOTS}/complementos-novo-cadastro-${info.project.name}.png`, fullPage: true });
  }
  await page.getByLabel('Buscar opção neste grupo').fill('costela');
  const costela = page.getByPlaceholder('Nome da opção (ex: Bacon Crocante)');
  await expect(costela).toHaveCount(1);
  await expect(costela).toHaveValue('Costela cozida');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Remover opção', exact: true }).click();
  expect(writes).toBe(0);
  await page.getByLabel('Nome da nova opção').fill('Porco cozido');
  await page.getByLabel('Nome da nova opção').press('Enter');
  await expect(page.getByLabel('Nome da nova opção')).toHaveValue('');
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Atualizar Grupo', exact: true }).click();
  await expect(page.getByText('Falha temporária no cadastro.', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Nome da opção (ex: Bacon Crocante)').first()).toHaveValue('Porco cozido');
  await page.getByRole('button', { name: 'Atualizar Grupo', exact: true }).click();
  await expect(proteins.getByRole('checkbox', { name: 'Porco cozido — Proteínas' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Costela cozida adicional — Adicionais pagos' })).toHaveCount(0);
  expect(writes).toBe(2);
  await proteins.getByRole('button', { name: 'Cadastrar / editar' }).click();
  await page.getByLabel('Nome da nova opção').fill('Peixe cozido');
  await page.getByRole('button', { name: 'Atualizar Grupo', exact: true }).click();
  await expect(proteins.getByRole('checkbox', { name: 'Peixe cozido — Proteínas' })).toBeVisible();
  expect(writes).toBe(3);
  await page.getByRole('button', { name: 'Cadastros', exact: true }).click();
  await page.getByRole('button', { name: 'Novo Grupo', exact: true }).click();
  await page.getByLabel('Nome da nova opção').fill('Rascunho');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(createdGroups).toBe(0);
  await page.getByRole('button', { name: 'Novo Grupo', exact: true }).click();
  await expect(page.getByLabel('Nome da nova opção')).toHaveValue('');
  await page.getByPlaceholder('Ex: Queijos e Cremosos, Molhos, Ponto da Carne').fill('Molhos');
  await page.getByLabel('Nome da nova opção').fill('Molho caseiro');
  await page.getByRole('button', { name: 'Criar Grupo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Molhos', exact: true })).toBeVisible();
  expect(createdGroups).toBe(1);
  if (process.env.KOMA_DAILY_SCREENSHOTS) {
    // Representative menu size from the reference screenshots; synthetic data only.
    const proteinNames = ['Acém cozido', 'Bisteca', 'Calabresa acebolada', 'Costela cozida', 'Costela suína cozida', 'Coxa e sobrecoxa assada', 'Fígado acebolado', 'Fígado de boi', 'Filé de frango acebolado', 'Filé de frango ao molho branco', 'Frango cozido', 'Linguiça', 'Ovo frito', 'Peixe cozido', 'Picadinho suíno cozido', 'Porco cozido', 'Porco trinchado', 'Suíno trinchado'];
    groups[0].opcoes = proteinNames.map((nome, index) => ({ id: `demo-protein-${index}`, nome, preco_adicional: 0, ativo: index % 3 !== 0 }));
    groups[1].opcoes = groups[0].opcoes.map((option: any) => ({ ...option, id: `${option.id}-extra`, opcao_origem_id: option.id, nome: `${option.nome} adicional`, preco_adicional: option.nome === 'Ovo frito' ? 2 : 5 }));
    groups.push({ id: 'sides', nome: 'Guarnições', tipo: 'opcional', min_selecoes: 0, max_selecoes: 20, produto_ids: [], opcoes: ['Arroz à grega', 'Arroz colorido', 'Arroz de leite', 'Arroz refogado', 'Baião', 'Cuscuz', 'Cuscuz temperado', 'Farofa', 'Feijão de corda', 'Feijoada', 'Macarrão', 'Purê'].map((nome, index) => ({ id: `side-${index}`, nome, ativo: index % 3 !== 0, preco_adicional: 0 })) });
    groups.push({ id: 'salads', nome: 'Saladas', tipo: 'opcional', min_selecoes: 0, max_selecoes: 20, produto_ids: [], opcoes: ['Batata doce', 'Salada tropical', 'Salada verde', 'Verdura de maionese', 'Vinagrete'].map((nome, index) => ({ id: `salad-${index}`, nome, ativo: index > 0, preco_adicional: 0 })) });
    await page.reload();
    await expect(page.getByRole('checkbox')).toHaveCount(53);
    await page.screenshot({ path: `${process.env.KOMA_DAILY_SCREENSHOTS}/complementos-compactos-${info.project.name}.png`, fullPage: true });
  }
});
