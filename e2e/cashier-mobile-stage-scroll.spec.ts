import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('barra de etapas fixa e lista de pedidos em rolagem independente no celular', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.goto('/?view=caixa');

  const shell = page.locator('.cashier-shell--mobile-orders');
  const content = shell.locator('.cashier-content');
  const workspace = content.locator('.orders-workspace');
  const stages = workspace.getByRole('tablist', { name: 'Filas de atendimento' });
  const scroller = workspace.locator('.orders-workspace__scroll-region');
  await expect(stages).toBeVisible();

  // Garante que os planos Pocket e maiores compartilham o mesmo comportamento.
  await shell.evaluate(el => el.setAttribute('data-koma-plan', 'pocket'));
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(250);

  // A header background must stay INSIDE the rounded column corners.
  // The mobile scroll fix must not reintroduce overflow: visible on columns.
  const salonColumn = workspace.locator('.orders-column--salon');
  await expect(salonColumn).toBeVisible();
  await expect(salonColumn).toHaveCSS('overflow-x', 'clip');
  await expect(salonColumn).toHaveCSS('overflow-y', 'clip');
  const salonRadius = await salonColumn.evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius));
  expect(salonRadius).toBeGreaterThanOrEqual(16);

  const before = await stages.boundingBox();
  expect(before).not.toBeNull();
  await scroller.evaluate(el => { el.scrollTop = 700; });
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(250);

  const after = await stages.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
  expect(await content.evaluate(el => el.scrollTop)).toBe(0);

  await expect(workspace.getByRole('searchbox', { name: 'Buscar pedidos' })).toBeInViewport();
  await expect(workspace.getByRole('button', { name: 'Novos pedidos', exact: true })).toBeInViewport();
  await expect(workspace.locator('.orders-auto-accept')).toBeInViewport();

  // O conteúdo começa abaixo de todos os controles fixos, sem sobreposição.
  const gap = await workspace.evaluate(element => {
    const toolbar = element.querySelector('.orders-toolbar') as HTMLElement;
    const scroller = element.querySelector('.orders-workspace__scroll-region') as HTMLElement;
    return scroller.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(-1);

  const digital = stages.getByRole('tab', { name: /Retiradas/ });
  await digital.click();
  await expect(digital).toHaveAttribute('aria-selected', 'true');
  const digitalColumn = workspace.locator('.orders-column--digital');
  await expect(digitalColumn).toHaveClass(/is-mobile-active/);
  await expect(digitalColumn).toHaveCSS('overflow-y', 'clip');
  const salon = stages.getByRole('tab', { name: /Mesas/ });
  await salon.click();
  await expect(salon).toHaveAttribute('aria-selected', 'true');

  // O cabeçalho verde deve acompanhar o raio da coluna; com overflow visível
  // na rolagem interna, um cabeçalho sem raio produz pontas nos cantos.
  for (const label of [/Mesas/, /Retiradas/, /Entregas/]) {
    const tab = stages.getByRole('tab', { name: label });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');

    const column = workspace.locator('.orders-column.is-mobile-active');
    await expect(column).toBeVisible();
    const corners = await column.locator('.orders-column__header').evaluate(header => {
      const outer = header.parentElement;
      if (!outer) throw new Error('Coluna sem contêiner');
      const headStyle = getComputedStyle(header);
      const outerStyle = getComputedStyle(outer);
      return {
        left: parseFloat(headStyle.borderTopLeftRadius),
        right: parseFloat(headStyle.borderTopRightRadius),
        bottomLeft: parseFloat(headStyle.borderBottomLeftRadius),
        bottomRight: parseFloat(headStyle.borderBottomRightRadius),
        parentLeft: parseFloat(outerStyle.borderTopLeftRadius),
        parentRight: parseFloat(outerStyle.borderTopRightRadius),
      };
    });

    expect(corners.parentLeft).toBeGreaterThan(12);
    expect(corners.left).toBeCloseTo(corners.parentLeft - 1, 0);
    expect(corners.right).toBeCloseTo(corners.parentRight - 1, 0);
    expect(corners.bottomLeft).toBe(0);
    expect(corners.bottomRight).toBe(0);
  }
});
