import { expect, test } from '@playwright/test';
import { openOperationalScenario } from './fixtures/operational';

test('mesa grande permite selecionar itens sem estourar a tela', async ({ page }) => {
  const state = await openOperationalScenario(page, { subtab:'mesas', canonicalIdentity:true, statuses:Array(24).fill('entregue') });
  await page.locator('article[data-table-status="occupied"]').getByRole('button',{name:'Ver comanda',exact:true}).click();
  await page.getByRole('dialog',{name:'Mesa 07',exact:true}).getByRole('button',{name:'Receber',exact:true}).click();
  const checkout = page.getByRole('dialog',{name:'Receber pagamento'});
  await expect(checkout.getByRole('checkbox',{name:/Prato da segunda rodada/})).toHaveCount(23);
  await checkout.getByRole('checkbox',{name:/Prato da segunda rodada/}).last().click();
  await expect(checkout.getByRole('button',{name:/Receber itens selecionados/})).toContainText('48,00');
  await checkout.getByRole('button',{name:'Débito',exact:true}).click();
  await expect(checkout.getByRole('button',{name:'Débito',exact:true})).toHaveAttribute('aria-pressed','true');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  expect(state.actions.filter(action => /pagar/.test(action.path))).toHaveLength(0);
});
