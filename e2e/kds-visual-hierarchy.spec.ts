import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

const queueOrder = {
  id: 'kds-visual-fixture', restaurante_id: 99001, numero_pedido: 333, tipo: 'Retirada',
  identificador: 'Cozinha teste', fechada: false, garcom_id: 'caixa-e2e',
  delivery_status: 'producao', criado_em: new Date(Date.now() - 20 * 60_000).toISOString(),
  lancamentos: [{ id: 'kds-visual-launch', display_number: '333', origem: 'caixa', status: 'producao' }],
  itens: [
    { id: 'kds-visual-1', produto_id: '1', produto: { id: '1', nome: 'Combo Bacon', preco: 20 },
      preco_unit: 20, status: 'preparando', pago: false, lancamento_id: 'kds-visual-launch', observacao: '' },
    { id: 'kds-visual-2', produto_id: '2', produto: { id: '2', nome: 'Água Mineral 500ml', preco: 5 },
      preco_unit: 5, status: 'preparando', pago: false, lancamento_id: 'kds-visual-launch', observacao: 'Sem gelo' },
  ],
};

const contrast = (text: string, background: string) => {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  };
  const luminance = (css: string) => {
    const match = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!match) throw new Error('Expected solid computed color: ' + css);
    const [r, g, b] = match.slice(1, 4).map(Number).map(channel);
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const values = [luminance(text), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};

test('KDS uses distinct batch/individual actions, readable typography and contrast in both themes', async ({ page }, testInfo) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({ json: [queueOrder] }));
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({ json: [queueOrder] }));
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: 'Cozinha', exact: true }).first().click();

  const workspace = page.locator('.kds-workspace');
  const ticket = workspace.locator('.kds-ticket');
  await expect(ticket).toHaveAttribute('data-stage', 'preparo');
  await expect(ticket.getByRole('heading', { name: 'Pedido #333' })).toBeVisible();
  await expect(ticket.getByText('Sem gelo')).toBeVisible();

  for (const [width, theme] of [[320, 'dark'], [360, 'light'], [390, 'dark'], [430, 'light']] as const) {
    await page.setViewportSize({ width, height: 760 });
    await page.evaluate(value => { document.documentElement.dataset.komaTheme = value; }, theme);

    const primary = ticket.getByRole('button', { name: 'Concluir 2 itens do pedido #333' });
    const secondary = ticket.locator('.kds-ticket__item-action').first();
    const getPaint = (locator: typeof primary) => locator.evaluate(node => {
      const css = getComputedStyle(node);
      return { color: css.color, background: css.backgroundColor, height: node.getBoundingClientRect().height };
    });
    const [p, s] = await Promise.all([getPaint(primary), getPaint(secondary)]);
    expect(contrast(p.color, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s.color, s.background)).toBeGreaterThanOrEqual(4.5);
    expect(p.background).not.toBe(s.background);
    expect(p.height).toBeGreaterThanOrEqual(44);
    expect(s.height).toBeGreaterThanOrEqual(44);

    // The queue stage is communicated by text, not amber stripes or nested check rings.
    expect(await ticket.locator('.kds-ticket__item-indicator, .kds-ticket__action-symbol').count()).toBe(0);
    const depth = await ticket.evaluate(node => {
      const card = getComputedStyle(node);
      const header = getComputedStyle(node.querySelector<HTMLElement>('.kds-ticket__header')!);
      const timer = getComputedStyle(node.querySelector<HTMLElement>('.kds-ticket__timer')!);
      return {
        borderLeft: card.borderLeftColor,
        borderTop: card.borderTopColor,
        cardSurface: card.backgroundColor,
        headerSurface: header.backgroundColor,
        timerSurface: timer.backgroundColor,
      };
    });
    expect(depth.borderLeft).toBe(depth.borderTop);
    expect(depth.headerSurface).not.toBe(depth.cardSurface);
    expect(depth.timerSurface).toBe('rgba(0, 0, 0, 0)');

    const titleSize = await ticket.getByRole('heading', { name: 'Pedido #333' }).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    const compositionSize = await ticket.locator('.kds-ticket__observation').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(titleSize).toBeGreaterThan(compositionSize);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    if (process.env.KOMA_CAPTURE_UI) await page.screenshot({ path: testInfo.outputPath(`kds-refined-${width}-${theme}.png`) });
  }
  // Caixa text-size preferences must not push an action off the viewport.
  for (const textSize of ['grande', 'gigante'] as const) {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.evaluate(value => { document.documentElement.dataset.komaTextSize = value; }, textSize);
    await expect(ticket.getByRole('button', { name: 'Concluir 2 itens do pedido #333' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    for (const button of await ticket.locator('.kds-ticket__item-action').all()) {
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  }
});
