import { expect, test } from '@playwright/test';

test('link extras to proteins, preserve prices and refresh both groups after a source pause', async ({ page }) => {
  const groups = [
    { id: 'proteins', nome: 'Proteínas', tipo: 'opcional', min_selecoes: 0, max_selecoes: 2, produto_ids: [], opcoes: [{ id: 'chicken', nome: 'Frango', preco_adicional: 0, ativo: true }] },
    { id: 'extras', nome: 'Adicionais pagos', tipo: 'opcional', min_selecoes: 0, max_selecoes: 20, produto_ids: ['g'], opcoes: [{ id: 'extra', nome: 'Frango adicional', preco_adicional: 7, ativo: true }] },
  ] as any[];
  await page.route('**/addon-test/cardapio/modificadores/**', async route => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'PUT') {
      const payload = request.postDataJSON();
      expect(payload.grupo_origem_id).toBe('proteins');
      expect(payload.preco_novo_adicional).toBe(5);
      expect(payload.preco_novo_ovo).toBe(2);
      expect(payload.opcoes[0].preco_adicional).toBe(7);
      Object.assign(groups[1], payload);
      groups[1].opcoes[0].opcao_origem_id = 'chicken';
      return route.fulfill({ json: groups[1] });
    }
    if (request.method() === 'PATCH') {
      groups[0].opcoes[0].ativo = false;
      groups[1].opcoes[0].ativo = false;
      return route.fulfill({ json: groups[0].opcoes[0] });
    }
    return route.fulfill({ json: url.endsWith('/grupos') ? groups : [] });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const reactUrl = '/.vite/e2e/deps/react.js';
    const domUrl = '/.vite/e2e/deps/react-dom_client.js';
    const componentUrl = '/src/components/cardapio/ComplementosTab.tsx';
    const { default: React } = await import(reactUrl);
    const { default: ReactDOM } = await import(domUrl);
    const { default: ComplementosTab } = await import(componentUrl);
    const host = document.createElement('div');
    host.id = 'complements-test';
    document.body.replaceChildren(host);
    ReactDOM.createRoot(host).render(React.createElement(ComplementosTab, { apiBaseUrl: '/addon-test', authHeaders: {}, produtos: [], marmitariaCadastro: true }));
  });
  await page.getByRole('button', { name: 'Cadastros', exact: true }).click();
  await expect(page.getByText('Adicionais pagos', { exact: true })).toBeVisible();
  await page.locator('.break-inside-avoid').filter({ has: page.getByRole('heading', { name: 'Adicionais pagos', exact: true }) }).getByTitle('Editar', { exact: true }).click();
  await page.getByLabel('Sincronizar adicionais com').selectOption('proteins');
  await expect(page.getByLabel('Preço de novos adicionais')).toHaveValue('5');
  await page.getByRole('button', { name: 'Atualizar Grupo' }).click();
  await expect(page.getByText('Sincronizado com Proteínas.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pausar Frango adicional', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pausar Frango', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reativar Frango', exact: true })).toBeVisible();
  await expect(page.getByText('Pausado', { exact: true })).toHaveCount(2);
});
