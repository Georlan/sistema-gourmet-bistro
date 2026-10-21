import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockCashierBackend, seedCashierSession, cashierConfig } from './fixtures/cashier';
import { navigateRelationship } from './fixtures/relationshipNavigation';

const contract = JSON.parse(readFileSync(new URL('./fixtures/crm-api-contract.json', import.meta.url), 'utf8'));

for (const theme of ['dark', 'light'] as const) {
  test(`CRM visual controls remain usable in ${theme} theme and reduced motion`, async ({page}, testInfo) => {
    await page.emulateMedia({reducedMotion:'reduce'});
    await mockCashierBackend(page);
    await seedCashierSession(page);
    await page.addInitScript(value => localStorage.setItem('@koma:theme', value), theme);
    await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
    await page.route('**/caixa/configuracoes', route => route.fulfill({json:{...cashierConfig, plano:'premium', plano_efetivo:'premium', entitlements:{...cashierConfig.entitlements, loyalty:true,coupons:true}}}));
    await page.route('**/caixa/cupons', route => route.fulfill({json:[]}));
    await page.route('**/caixa/cupons/economia/recomendacao', route => route.fulfill({json:{mode:'automatico',source:'conservative_default',suggestion:{effective_reward_percent:2,cashback_percent:2,points_per_real:1,point_value_brl:0.02},evidence:{lookback_days:30,orders_analyzed:0,cost_coverage_percent:0,known_contribution_percent:null},warnings:[],message:'Fixture isolada'}}));
    await page.route('**/fidelidade/config', route => route.fulfill({json:{ativo:true,tipo_recompensa:'PONTOS',taxa_conversao:1,valor_ponto_em_dinheiro:0.05}}));
    await page.route(/\/fidelidade\/clientes(?:\?.*)?$/, route => route.fulfill({json:contract.customers}));
    const emptySummary = structuredClone(contract.summary);
    emptySummary.resultados.retorno_apos_abordagem = {status_mensuracao:'NAO_MENSURADO',clientes_abordados_no_periodo:0};
    emptySummary.resultados.valor_pago_pedidos_associados.status_mensuracao = 'NAO_MENSURADO';
    await page.route('**/fidelidade/crm/resumo**', route => route.fulfill({json:emptySummary}));
    await page.goto('/?view=caixa');
    await expect(page.locator('.orders-board')).toBeVisible();
    if (!(await page.locator('.cashier-sidebar:visible').count())) {
      const menu = page.getByRole('button', {name:'Abrir menu completo',exact:true});
      if (await menu.isVisible()) await menu.click();
      else await page.getByRole('button', {name:'Abrir menu principal',exact:true}).click();
    }
    await page.locator('.cashier-sidebar:visible').getByRole('button',{name:/^Relacionamento(?: \d+)?$/}).click();
    await navigateRelationship(page, 'resultados');
    await expect(page.locator('html')).toHaveAttribute('data-koma-theme',theme);
    const refresh = page.getByRole('button',{name:'Atualizar resultados',exact:true});
    await page.getByLabel('Janela de atribuição pós-abordagem').focus();
    await page.keyboard.press('Tab');
    await expect(refresh).toBeFocused();
    await expect(refresh).toHaveCSS('outline-style','solid');
    await expect(page.getByRole('region',{name:'Evolução observada'})).toBeVisible();
    const start = page.getByRole('region',{name:'Começar acompanhamento'});
    await expect(start).toBeVisible();
    const cta = start.getByRole('button',{name:'Abrir campanhas',exact:true});
    const contrast = await cta.evaluate(button => {
      const style = getComputedStyle(button);
      const luminance = (color:string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v => {
          const c=v/255; return c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4;
        });
        return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
      };
      const fg=luminance(style.color),bg=luminance(style.backgroundColor);
      return (Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    if (testInfo.project.use.hasTouch) {
      const bounds=await refresh.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.locator('.koma-workspace').evaluate(el => el.scrollWidth > el.clientWidth + 1);
    expect(overflow).toBe(false);
    await expect(page.locator('.koma-workspace')).toHaveCSS('animation-name','none');
    await page.screenshot({path:testInfo.outputPath(`results-${theme}.png`),animations:'disabled'});
    await cta.click();
    await expect(page.getByRole('navigation',{name:'Etapas da campanha'})).toBeVisible();
    await navigateRelationship(page,'fidelidade');
    await expect(page.getByRole('region',{name:'Simulação da fidelidade'})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath(`benefits-${theme}.png`),animations:'disabled'});
  });
}
