import { expect, test, type WebSocketRoute } from '@playwright/test';

for (const connected of [true, false]) {
  test(`idle reads respect visibility and realtime health (${connected ? 'connected' : 'fallback'})`, async ({ page }) => {
    const calls = { smartpos: 0, config: 0, summary: 0 };
    let socket: WebSocketRoute | undefined;
    await page.clock.install();
    await page.addInitScript(() => {
      sessionStorage.setItem('koma_caixa_token', 'playwright-e2e-token');
      sessionStorage.setItem('koma_active_operational_portal', 'caixa');
      sessionStorage.setItem('koma_caixa_id', 'idle-test');
      sessionStorage.setItem('koma_caixa_name', 'Caixa Teste');
      sessionStorage.setItem('koma_caixa_role', 'caixa');
      sessionStorage.setItem('koma_active_tab', 'operacao');
      sessionStorage.setItem('koma_active_subtab', 'pedidos');
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => Boolean((window as any).__testHidden),
      });
    });
    await page.routeWebSocket(/\/ws\//, ws => {
      if (connected) socket = ws;
      else ws.close();
    });
    await page.route('http://127.0.0.1:8000/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = [];
      if (path === '/auth/smartpos/caixa/operacao') calls.smartpos++;
      if (path === '/caixa/configuracoes') {
        calls.config++;
        body = { taxa_servico_ativa: false, tipos_pedido_ativos: ['retirada', 'delivery'] };
      }
      if (path === '/caixa/turno-atual/resumo') {
        calls.summary++;
        body = { turno_id: 501, status: 'aberto' };
      }
      if (path === '/caixa/turno/atual') body = { id: 501, status: 'aberto', movimentacoes: [], pagamentos: [] };
      if (path === '/produtos/catalogo') body = { produtos: [], categorias: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('/?view=caixa');
    await expect.poll(() => calls.smartpos).toBeGreaterThan(0);
    // Allow the initial scope and connection effects to settle before counting idle reads.
    await page.clock.runFor(1000);
    const boot = { ...calls };
    await page.clock.runFor(90_000);
    await expect.poll(() => calls.smartpos).toBe(boot.smartpos + (connected ? 0 : 3));
    await expect.poll(() => calls.config).toBe(boot.config + (connected ? 0 : 6));
    await expect.poll(() => calls.summary).toBe(boot.summary + (connected ? 0 : 6));

    await page.evaluate(() => { (window as any).__testHidden = true; });
    const hidden = { ...calls };
    await page.clock.runFor(90_000);
    expect(calls).toEqual(hidden);

    await page.evaluate(() => {
      (window as any).__testHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await expect.poll(() => calls.smartpos).toBe(hidden.smartpos + 1);
    await expect.poll(() => calls.config).toBe(hidden.config + 1);
    await expect.poll(() => calls.summary).toBe(hidden.summary + 1);

    if (connected) {
      const previous = calls.smartpos;
      socket!.send(JSON.stringify({ event: 'payment_intent_updated', detail: { status: 'processando' } }));
      await expect.poll(() => calls.smartpos).toBe(previous + 1);
      await page.clock.runFor(300_000);
      await expect.poll(() => calls.smartpos).toBe(previous + 2);
    }
  });
}
