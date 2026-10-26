import { expect, test } from '@playwright/test';

for (const variant of ['editorial', 'artistic-total'] as const) {
test.describe(variant, () => {
for (const rejection of [400, 404, 503, 'network', 'invalid'] as const) {
  test(`rejeição ${rejection} fica visível e permite corrigir ou repetir sem perder a sacola`, async ({ page, context }, testInfo) => {
    const keys: string[] = [];
    const quantities: number[] = [];
    const requestIds: string[] = [];
    await page.route('http://127.0.0.1:8000/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/cardapio-digital/public') {
        await route.fulfill({ json: {
          restaurante: { id: 901, nome: 'Fixture local', aceitando_pedidos: true,
            status_override: 'Forçado Aberto', delivery_ativo: true, retirada_ativa: true,
            pagamento_online_ativo: false, formas_pagamento_aceitas: ['Dinheiro'] },
          categorias: [{ id: 1, nome: 'Lanches' }],
          produtos: [{ id: 101, nome: 'Lanche local', preco: 10, categoria_id: 1, grupos_modificadores: [] }],
        } });
      } else if (path === '/cardapio/pedidos' && route.request().method() === 'POST') {
        expect(route.request().headers()['x-request-id']).toMatch(/^[a-f0-9]{32}$/);
        requestIds.push(route.request().headers()['x-request-id']);
        keys.push(route.request().headers()['x-idempotency-key']);
        quantities.push(route.request().postDataJSON().itens[0].quantidade);
        if (keys.length === 1 && rejection === 'network') { await route.abort('failed'); return; }
        if (keys.length === 1 && rejection === 'invalid') {
          await route.fulfill({ status: 200, headers: { 'X-Request-ID': 'abc123def4567890', 'Access-Control-Expose-Headers': 'X-Request-ID' }, body: '{invalid JSON' });
          return;
        }
        await route.fulfill(keys.length === 1 ? {
          status: typeof rejection === 'number' ? rejection : 503,
          headers: { 'X-Request-ID': 'abc123def4567890', 'Access-Control-Expose-Headers': 'X-Request-ID' },
          json: { detail: rejection === 400 ? 'Confira as escolhas dos complementos.' : rejection === 404 ? 'Um complemento escolhido não está mais disponível para este produto. Volte à sacola, confira as opções e tente novamente.' : 'Serviço temporariamente indisponível.' },
        } : { status: 201, json: { comanda_id: 'local-order', numero_pedido: 101, total: 10 } });
      } else {
        await route.fulfill({ json: path.includes('populares') ? { produtos: [] } : {} });
      }
    });
    await page.goto(`/cardapio?restaurante_id=901&vitrine=${variant}`);
    await page.locator('#btn-fast-add-101').click();
    const cart = page.locator('#cart-drawer-container');
    if (!await cart.isVisible()) await page.locator('#mobile-nav-cart:visible, #btn-cart-header:visible').first().click();
    await cart.locator('#btn-confirm-order').click();
    await cart.getByRole('button', { name: /^Retirada/ }).click();
    await cart.locator('#btn-confirm-order').click();
    await cart.getByRole('button', { name: 'Dinheiro', exact: true }).click();
    await cart.locator('#btn-confirm-order').click();
    await cart.locator('#input-guest-name').fill('Fixture local');
    await cart.locator('#input-guest-phone').fill('85999999999');
    await cart.locator('#btn-confirm-order').click();
    const submit = page.locator('#btn-place-order-final');
    await submit.click();
    const error = page.locator('#checkout-submit-error');
    await expect(error).toContainText('Não foi possível confirmar o pedido');
    await expect(error).not.toContainText('Código de suporte');
    const expectedCode = rejection === 'network' ? requestIds[0].slice(0, 12) : 'abc123def456';
    await expect(error).toContainText(`Suporte: ${expectedCode}`);
    const signals = await page.evaluate(() => window.__KOMA_ANALYTICS_EVENTS__?.filter(entry => entry.event === 'public_checkout_result'));
    expect(signals?.at(-1)?.properties).toMatchObject({ restaurant_id: 901, outcome: rejection === 'network' ? 'network_error' : rejection === 'invalid' ? 'invalid_response' : 'http_error', stage: 'submission', status: rejection === 'network' ? 0 : rejection === 'invalid' ? 200 : rejection, ...(rejection === 'network' ? {} : { request_id: 'abc123def4567890' }) });
    expect(await page.evaluate(() => JSON.stringify(window.__KOMA_ANALYTICS_EVENTS__?.filter(entry => entry.event === 'public_checkout_result')))).not.toContain('85999999999');
    if (rejection === 404) {
      await expect(error).toContainText('acabou de alterar a disponibilidade');
      await expect(submit).toContainText('Revisar sacola');
    }
    const box = await error.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(page.getByText('Pedido recebido', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('checkout-error-visible.png') });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await error.getByRole('button', { name: `Copiar código de suporte ${expectedCode}` }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expectedCode);
    await expect(error).toContainText(`Copiado: ${expectedCode}`);
    if (rejection === 400 || rejection === 404) {
      if (rejection === 404) await submit.click();
      else await error.getByRole('button', { name: 'Voltar à sacola e corrigir' }).click();
      await expect(cart).toBeVisible();
      await expect(cart).toContainText('Lanche local');
      await expect(cart.locator('#input-guest-name')).toHaveValue('Fixture local');
      expect(keys).toHaveLength(1);
      await cart.getByRole('button', { name: '1. Seu pedido', exact: true }).click();
      await cart.getByRole('button', { name: 'Aumentar Lanche local', exact: true }).click();
      await cart.getByRole('button', { name: '4. Seu contato', exact: true }).click();
      await cart.locator('#btn-confirm-order').click();
      await submit.click();
      await expect(page.locator('#checkout-card')).toContainText('Pedido recebido');
      expect(quantities).toEqual([1, 2]);
      expect(keys[1]).not.toBe(keys[0]);
    } else {
      await expect(error.getByRole('button', { name: 'Voltar à sacola e corrigir' })).toHaveCount(0);
      await expect(page.getByText('Código de suporte:', { exact: false })).toHaveCount(0);
      await submit.click();
      await expect(page.locator('#checkout-card')).toContainText('Pedido recebido');
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
      expect(requestIds[1]).not.toBe(requestIds[0]);
      const results = await page.evaluate(() => window.__KOMA_ANALYTICS_EVENTS__?.filter(entry => entry.event === 'public_checkout_result'));
      expect(results?.at(-1)?.properties.outcome).toBe('accepted');
    }
  });
}

});
}
