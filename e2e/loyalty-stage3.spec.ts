import { expect, test, type Page } from '@playwright/test';
import { cashierConfig, mockCashierBackend, seedCashierSession } from './fixtures/cashier';
import { navigateRelationship } from './fixtures/relationshipNavigation';

type Program = {ativo:boolean;tipo_recompensa:'PONTOS'|'CASHBACK';taxa_conversao:number;valor_ponto_em_dinheiro:number};
const initial: Program = {ativo:true,tipo_recompensa:'PONTOS',taxa_conversao:1,valor_ponto_em_dinheiro:0.05};

async function enterLoyalty(page: Page) {
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  if (!(await page.locator('.cashier-sidebar:visible').count())) {
    const full=page.getByRole('button',{name:'Abrir menu completo',exact:true});
    if(await full.isVisible()) await full.click();
    else await page.getByRole('button',{name:'Abrir menu principal',exact:true}).click();
  }
  await page.locator('.cashier-sidebar:visible').getByRole('button',{name:/^Relacionamento(?: \d+)?$/}).click();
  await navigateRelationship(page,'beneficios');
  await expect(page.getByRole('region',{name:'Programa vigente'})).toBeVisible();
}

test('vigente, sugestão, rascunho, simulador e confirmação ficam isolados até a resposta do servidor', async ({page},testInfo) => {
  test.setTimeout(120_000);
  let saved={...initial}; let writes=0; let shouldFail=false;
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//,socket=>socket.onMessage(()=>{}));
  await page.route('**/caixa/configuracoes',route=>route.fulfill({json:{
    ...cashierConfig, plano:'premium', plano_efetivo:'premium',
    entitlements:{...cashierConfig.entitlements,loyalty:true,coupons:true},
  }}));
  await page.route('**/fidelidade/config',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:saved});
    writes++;
    if(shouldFail) return route.fulfill({status:503,json:{detail:'Falha temporária da fixture'}});
    saved=route.request().postDataJSON() as Program;
    return route.fulfill({json:saved});
  });
  // Cupons mounts when its tab is visited; the generic cashier mock does not
  // provide the array contract expected by that workspace.
  await page.route('**/caixa/cupons', route=>route.fulfill({json:[]}));
  await page.route('**/caixa/cupons/economia/recomendacao',route=>route.fulfill({json:{
    mode:'automatico',source:'configured_costs',
    suggestion:{effective_reward_percent:2,cashback_percent:2,points_per_real:1,point_value_brl:0.02},
    evidence:{lookback_days:60,orders_analyzed:12,cost_coverage_percent:70,known_contribution_percent:30},
    warnings:[],message:'Taxa calculada com custos conhecidos (fixture isolada)',
  }}));
  await enterLoyalty(page);
  const current=page.getByRole('region',{name:'Programa vigente'});
  const simulation=page.getByRole('region',{name:'Simulação da fidelidade'});
  await expect(simulation).toBeHidden();
  await page.getByText('Simulação financeira', {exact:true}).press('Enter');
  await expect(current).toContainText('R$ 5,00');
  await expect(simulation).toContainText('R$ 5,00');
  await current.locator('summary').filter({hasText:'Ajustar programa'}).click();
  await expect(page.getByText('Baseada em custos cadastrados (estimativa parcial)')).toBeVisible();
  await expect(page.getByText('Taxa vigente')).toBeVisible();
  await page.getByRole('button',{name:'Usar sugestão KÔMA'}).click();
  await expect(current).toContainText('Alterações pendentes');
  await expect(current).toContainText('R$ 5,00');
  await expect(simulation).toContainText('R$ 5,00');
  await page.getByRole('button',{name:'Rascunho'}).click();
  await expect(simulation).toContainText('R$ 2,00');
  // The Benefits parent is already active. Use its internal tabs directly,
  // including after a draft exists; re-clicking the parent is a different journey.
  await page.getByRole('tab', {name:'Cupons', exact:true}).click();
  await expect(page.getByRole('tabpanel', {name:'Cupons'})).toBeVisible();
  await page.getByRole('tab', {name:'Fidelidade', exact:true}).click();
  await expect(page.getByRole('tabpanel', {name:'Fidelidade'})).toBeVisible();
  await expect(current).toContainText('Alterações pendentes');
  await expect(page.getByRole('button',{name:'Rascunho'})).toHaveAttribute('aria-pressed','true');
  expect(writes).toBe(0);
  await page.screenshot({path:testInfo.outputPath(`loyalty-stage3-draft-${testInfo.project.name}.png`),animations:'disabled',fullPage:true});

  shouldFail=true;
  await page.getByRole('button',{name:'Salvar programa'}).click();
  await expect(page.getByRole('region',{name:'Confirmar mudança da fidelidade'})).toContainText('Vigente: ativo');
  await page.getByRole('button',{name:'Confirmar e salvar'}).click();
  await expect(current.getByRole('alert')).toContainText('Falha temporária da fixture');
  await expect(current).toContainText('Alterações pendentes');
  await expect(current).toContainText('R$ 5,00');
  expect(writes).toBe(1);
  shouldFail=false;

  await page.getByRole('button',{name:'Salvar programa'}).click();
  await page.getByRole('button',{name:'Confirmar e salvar'}).click();
  await expect(current).toContainText('R$ 2,00');
  await expect(current).not.toContainText('Alterações pendentes');
  expect(writes).toBe(2);
  await page.screenshot({path:testInfo.outputPath(`loyalty-stage3-saved-${testInfo.project.name}.png`),animations:'disabled',fullPage:true});

  await page.getByLabel('Ativar programa de fidelidade').uncheck();
  await page.getByRole('button',{name:'Salvar programa'}).click();
  await expect(page.getByRole('region',{name:'Confirmar mudança da fidelidade'})).toContainText('Proposta: pausado');
  await page.getByRole('button',{name:'Confirmar e salvar'}).click();
  await expect(current).toContainText('Pausado');
  await expect(simulation).toContainText('Programa pausado');
  expect(writes).toBe(3);
});
