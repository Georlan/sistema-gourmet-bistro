import { expect, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const now = new Date().toISOString();

const mockMotoboy = {
  id: 42,
  nome: 'Lucas Motoboy',
  telefone: '11999998888',
};

const mockDeliveryOrder = {
  id: 'cmd-delivery-101',
  numero_pedido: 101,
  cliente_nome: 'Ana Oliveira',
  delivery_telefone: '11988887777',
  delivery_endereco: 'Av. Paulista, 1000 - Bela Vista',
  delivery_taxa: 8.0,
  delivery_status: 'transito',
  total: 68.0,
  valor_pago: 0,
  valor_a_cobrar: 68.0,
  itens_resumo: '1x X-Burger Artesanal + 1x Suco de Laranja',
  criado_em: now,
};

test.describe('PWA do Entregador - Resiliência na Confirmação de Entrega', () => {
  test('Caso A: backend não processou o POST; após timeout de 12s, GET reconcilia e mantém card operável sem tela cheia de loading', async ({ page }) => {
    let postCallCount = 0;
    let getCallCount = 0;

    await page.route(`${API_ORIGIN}/**`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      const { pathname } = url;

      if (pathname === '/comandas/motoboys/painel-entregador') {
        getCallCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            motoboy: mockMotoboy,
            entregas: [mockDeliveryOrder],
          }),
        });
        return;
      }

      if (pathname === '/comandas/motoboys/pedidos/cmd-delivery-101/confirmar-entrega') {
        postCallCount += 1;
        // Simula request pendurada (sem resposta)
        return;
      }

      await route.fulfill({ status: 200, body: '{}' });
    });

    // 1. Abre o link válido do PWA com token
    await page.goto('/entregador#token=test-motoboy-token');

    // 2. Confirma carregamento normal
    await expect(page.locator('text=Lucas Motoboy')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Ana Oliveira')).toBeVisible();
    const initialGetCalls = getCallCount;
    expect(initialGetCalls).toBeGreaterThanOrEqual(1);

    // 3. Clica em "Confirmar Entrega Realizada"
    const confirmButton = page.getByRole('button', { name: /Confirmar Entrega Realizada/i });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // Validação 1: botão entra em Confirmando... e fica desabilitado
    await expect(page.getByRole('button', { name: /Confirmando/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Confirmando/i })).toBeDisabled();
    expect(postCallCount).toBe(1);

    if (page.viewportSize()?.width === 390) {
      await page.screenshot({ path: '/home/testuser/.gemini/antigravity/brain/7af21423-1a1c-472c-912d-77c093671571/motoboy_mobile_confirming.png' });
    }

    // Validação 2: não é possível disparar outra confirmação concorrente enquanto confirma
    const confirmingBtn = page.getByRole('button', { name: /Confirmando/i });
    await confirmingBtn.click({ force: true }).catch(() => {});
    expect(postCallCount).toBe(1);

    // Validação 3: durante a espera de 12s, o botão continua Confirmando... e a tela NÃO entra em loading de tela cheia
    await expect(page.getByText('Carregando painel do entregador...')).toHaveCount(0);
    await expect(page.locator('text=Ana Oliveira')).toBeVisible();

    // Validação 4: aguarda o timeout de 12 segundos da requisição no frontend
    // Feedback deve aparecer informando que demorou e que o painel será atualizado
    const feedbackToast = page.getByText(/A confirmação demorou demais/i);
    await expect(feedbackToast).toBeVisible({ timeout: 15000 });

    if (page.viewportSize()?.width === 390) {
      await page.screenshot({ path: '/home/testuser/.gemini/antigravity/brain/7af21423-1a1c-472c-912d-77c093671571/motoboy_mobile_timeout_toast.png' });
    }

    // Validação 5: o POST NÃO é reenviado automaticamente
    expect(postCallCount).toBe(1);

    // Validação 6: o frontend consulta o painel por GET para reconciliação
    await expect.poll(() => getCallCount).toBeGreaterThan(initialGetCalls);

    // Validação 7: a tela inteira NÃO deve entrar em loading de tela cheia durante a reconciliação
    await expect(page.getByText('Carregando painel do entregador...')).toHaveCount(0);

    // Validação 8: o card de Ana Oliveira NÃO desaparece e reaparece
    await expect(page.locator('text=Ana Oliveira')).toBeVisible();

    // Validação 9: somente após a reconciliação a interface volta para estado operável
    // No Caso A, a entrega continua pendente e o botão volta a ficar habilitado para nova tentativa manual
    const reenabledButton = page.getByRole('button', { name: /Confirmar Entrega Realizada/i });
    await expect(reenabledButton).toBeVisible({ timeout: 5000 });
    await expect(reenabledButton).toBeEnabled();

    if (page.viewportSize()?.width === 390) {
      await page.screenshot({ path: '/home/testuser/.gemini/antigravity/brain/7af21423-1a1c-472c-912d-77c093671571/motoboy_mobile_caso_a_reconciled.png' });
    } else if (page.viewportSize()?.width === 1024) {
      await page.screenshot({ path: '/home/testuser/.gemini/antigravity/brain/7af21423-1a1c-472c-912d-77c093671571/motoboy_desktop_caso_a_reconciled.png' });
    }
  });

  test('Caso B: backend processou a entrega durante o timeout; GET reconcilia e card desaparece sem segundo POST', async ({ page }) => {
    let postCallCount = 0;
    let getCallCount = 0;
    let backendProcessed = false;

    await page.route(`${API_ORIGIN}/**`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      const { pathname } = url;

      if (pathname === '/comandas/motoboys/painel-entregador') {
        getCallCount += 1;
        // Se backend já processou, lista de entregas pendentes vem vazia
        const entregas = backendProcessed ? [] : [mockDeliveryOrder];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            motoboy: mockMotoboy,
            entregas,
          }),
        });
        return;
      }

      if (pathname === '/comandas/motoboys/pedidos/cmd-delivery-101/confirmar-entrega') {
        postCallCount += 1;
        // Backend processa a entrega com sucesso internamente, mas a resposta HTTP fica presa/perdida
        backendProcessed = true;
        return;
      }

      await route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto('/entregador#token=test-motoboy-token');
    await expect(page.locator('text=Lucas Motoboy')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Ana Oliveira')).toBeVisible();
    const initialGetCalls = getCallCount;

    const confirmButton = page.getByRole('button', { name: /Confirmar Entrega Realizada/i });
    await confirmButton.click();

    await expect(page.getByRole('button', { name: /Confirmando/i })).toBeVisible();

    // Aguarda o timeout de 12s
    const feedbackToast = page.getByText(/A confirmação demorou demais/i);
    await expect(feedbackToast).toBeVisible({ timeout: 15000 });

    // O GET de reconciliação percebe que a entrega já foi concluída
    await expect.poll(() => getCallCount).toBeGreaterThan(initialGetCalls);

    // O card deve desaparecer e a mensagem de "Tudo Entregue!" deve surgir
    await expect(page.locator('text=Ana Oliveira')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('text=Tudo Entregue!')).toBeVisible();

    if (page.viewportSize()?.width === 390) {
      await page.screenshot({ path: '/home/testuser/.gemini/antigravity/brain/7af21423-1a1c-472c-912d-77c093671571/motoboy_mobile_caso_b_empty.png' });
    } else if (page.viewportSize()?.width === 1024) {
      await page.screenshot({ path: '/home/testuser/.gemini/antigravity/brain/7af21423-1a1c-472c-912d-77c093671571/motoboy_desktop_caso_b_empty.png' });
    }

    // NÃO pode surgir uma segunda confirmação automática
    expect(postCallCount).toBe(1);

    // Não deve haver toast enganoso de sucesso pós-timeout
    await expect(page.getByText('Entrega confirmada com sucesso.')).toHaveCount(0);
  });

  test('Refresh manual (F5) não leva a estado contraditório e preserva sessão do entregador', async ({ page }) => {
    await page.route(`${API_ORIGIN}/**`, async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/comandas/motoboys/painel-entregador') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            motoboy: mockMotoboy,
            entregas: [mockDeliveryOrder],
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, body: '{}' });
    });

    // Acessa pelo link inicial com query ou hash
    await page.goto('/?view=entregador#token=test-motoboy-token');
    await expect(page.locator('text=Lucas Motoboy')).toBeVisible({ timeout: 10000 });

    // Simula refresh manual do navegador (F5 / page.reload)
    await page.reload();

    // Deve continuar no painel do entregador, sem desviar para tela de login de garçom ou landing
    await expect(page.locator('text=Lucas Motoboy')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Ana Oliveira')).toBeVisible();
    await expect(page.locator('text=Salão')).toHaveCount(0);
    await expect(page.locator('text=Entrar como Garçom')).toHaveCount(0);
  });
});
