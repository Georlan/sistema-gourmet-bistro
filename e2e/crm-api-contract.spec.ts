import {expect,test} from '@playwright/test';
import {readFileSync} from 'node:fs';
const contract = JSON.parse(readFileSync(new URL('./fixtures/crm-api-contract.json', import.meta.url), 'utf8'));
import {mockCashierBackend,seedCashierSession,cashierConfig} from './fixtures/cashier';

test('all CRM workspaces render backend-generated responses without losing the operational shell',async ({page},testInfo)=>{
  const errors:string[]=[];
  let savedCampaign: Record<string,unknown> | undefined;
  let savedContact: Record<string,unknown> | undefined;
  let campaignCreates=0;
  let loyaltyWrites=0;
  await page.route('**/fidelidade/config',route=>{if(route.request().method()!=='GET') loyaltyWrites++; return route.fulfill({json:{ativo:true,tipo_recompensa:'PONTOS',taxa_conversao:1,valor_ponto_em_dinheiro:0.05}});});
  let savedPreference: Record<string,unknown> | undefined;
  page.on('pageerror',error=>errors.push(error.message));
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.route('**/caixa/configuracoes',route=>route.fulfill({json:{...cashierConfig,plano:'premium',plano_efetivo:'premium',entitlements:{...cashierConfig.entitlements,loyalty:true,coupons:true}}}));
  await page.routeWebSocket(/\/ws\//,socket=>socket.onMessage(()=>{}));
  await page.route('**/caixa/cupons',route=>route.fulfill({json:[]}));
  await page.route('**/caixa/cupons/economia/recomendacao',route=>route.fulfill({json:{mode:'automatico',source:'conservative_default',suggestion:{effective_reward_percent:2,cashback_percent:2,points_per_real:1,point_value_brl:0.02},evidence:{lookback_days:30,orders_analyzed:0,cost_coverage_percent:0,known_contribution_percent:null},warnings:[],message:'Sugestão de teste isolada'}}));
  await page.route('**/fidelidade/clientes',route=>route.fulfill({json:contract.customers}));
  await page.route('**/fidelidade/crm/resumo**',route=>route.fulfill({json:contract.summary}));
  await page.route('**/fidelidade/clientes/*/perfil',route=>route.fulfill({json:contract.profile}));
  await page.route('**/fidelidade/clientes/*/preferencias', async route=>{
    savedPreference=route.request().postDataJSON();
    await route.fulfill({json:{ok:true}});
  });
  await page.route('**/fidelidade/crm/campanhas', async route=>{savedCampaign=route.request().postDataJSON(); campaignCreates++; await route.fulfill({json:{id:`created-fixture-${campaignCreates}`}});});
  await page.route('**/fidelidade/crm/contatos', async route=>{savedContact=route.request().postDataJSON(); await route.fulfill({json:{id:'contact-fixture'}});});
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  if (!(await page.locator('.cashier-sidebar:visible').count())) {
    const menu=page.getByRole('button',{name:'Abrir menu completo',exact:true});
    if(await menu.isVisible()) await menu.click();
    else await page.getByRole('button',{name:'Abrir menu principal',exact:true}).click();
  }
  await page.locator('.cashier-sidebar:visible').getByRole('button',{name:/^Relacionamento(?: \d+)?$/}).click();
  for(const subTab of ['oportunidades','clientes','campanhas','fidelidade','cupons','resultados']){
    const button=page.locator(`#clientes-subtab-${subTab}`);
    await button.click();
    await expect(button).toHaveAttribute('aria-current','page');
    if(subTab === 'fidelidade'){
      const simulation=page.getByRole('region',{name:'Simulação da fidelidade'});
      await expect(simulation).toContainText('R$ 5,00');
      await page.getByLabel('Margem de contribuição na simulação').fill('30');
      await expect(simulation).toContainText('R$ 25,00');
      await page.getByLabel('Margem de contribuição na simulação').fill('2');
      await expect(simulation.getByRole('alert')).toContainText('supera a contribuição');
      await page.getByLabel('Margem de contribuição na simulação').fill('30');
      await page.screenshot({path:testInfo.outputPath(`loyalty-${testInfo.project.name}.png`),fullPage:true,animations:'disabled'});
      await page.getByRole('region',{name:'Impacto na contribuição por pedido'}).scrollIntoViewIfNeeded();
      await expect(page.getByRole('region',{name:'Impacto na contribuição por pedido'}).getByText(/^R\$\s0,00$/)).toBeVisible();
      await page.screenshot({path:testInfo.outputPath(`loyalty-impact-${testInfo.project.name}.png`),animations:'disabled'});
      await page.getByLabel('Ativar programa de fidelidade').uncheck({force:true});
      await expect(simulation).toContainText('Programa pausado');
      await expect(simulation).toContainText('R$ 0,00');
      await page.getByLabel('Ativar programa de fidelidade').check({force:true});
      expect(loyaltyWrites).toBe(0);
    }
    await expect(page.getByRole('tablist',{name:'Áreas do CRM'})).toHaveCount(0);
    await expect(page.getByRole('alert').filter({hasText:'Não foi possível abrir'})).toHaveCount(0);
  }
  await expect(page.getByText('Campanha fixture de contrato',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Quantos clientes voltaram e quanto compraram?'})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath(`relationship-results-${testInfo.project.name}.png`),fullPage:true,animations:'disabled'});
  const opportunity = contract.summary.oportunidades.find((op: {elegiveis_count:number})=>op.elegiveis_count>0);
  await page.locator('#clientes-subtab-oportunidades').click();
  await page.screenshot({path:testInfo.outputPath(`relationship-actions-${testInfo.project.name}.png`),fullPage:true,animations:'disabled'});
  const emptyGroup=contract.summary.oportunidades.find((op:{elegiveis_count:number})=>op.elegiveis_count===0);
  await expect(page.getByText(emptyGroup.titulo,{exact:true})).toBeHidden();
  await page.getByText(/^Outros grupos/).click();
  await expect(page.getByText(emptyGroup.titulo,{exact:true})).toBeVisible();
  await page.getByText(/^Outros grupos/).click();
  const opportunityCard=page.locator('article').filter({has:page.getByRole('heading',{name:opportunity.titulo,exact:true})});
  const audienceCustomer=contract.customers.find((c:{id:string})=>opportunity.elegiveis_cliente_ids.includes(c.id));
  await expect(opportunityCard).toContainText(audienceCustomer.nome.split(' ')[0]);
  await opportunityCard.getByRole('button',{name:'Abrir público e iniciar ação',exact:true}).click();
  await expect(page.getByLabel('Modelo de mensagem da campanha')).toBeHidden();
  await page.getByRole('button',{name:'Continuar para mensagem',exact:true}).click();
  await expect(page.getByLabel('Modelo de mensagem da campanha')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath(`campaign-message-${testInfo.project.name}.png`),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Salvar campanha no histórico e revisar envios',exact:true}).click();
  await expect(page.getByRole('button',{name:'3. Contatos',exact:true})).toHaveAttribute('aria-current','step');
  await expect(page.getByRole('region',{name:'Contatos nesta sessão'})).toBeVisible();
  await expect.poll(()=>savedCampaign?.abordagem_tipo).toBe('SEM_DESCONTO');
  await expect.poll(()=>savedCampaign?.segmento_filtro).toBe(opportunity.id);
  await page.getByRole('button',{name:'Registrar contato manual',exact:true}).first().click();
  await expect.poll(()=>savedContact?.canal).toBe('WHATSAPP_MANUAL');
  await expect.poll(()=>savedContact?.acao_executada).toBe('CONTATO_MANUAL_CONFIRMADO');
  expect(savedContact?.mensagem_personalizada).toEqual(expect.any(String));
  expect(savedContact?.campanha_id).toBe('created-fixture-1');

  // Editing after a recorded contact must not attach new contacts to the old campaign.
  await page.getByRole('button',{name:'1. Público',exact:true}).click();
  await page.getByLabel('Identificação da campanha').fill('Nova campanha de retorno');
  await expect(page.getByRole('button',{name:'3. Contatos',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'2. Mensagem',exact:true}).click();
  await page.getByRole('button',{name:'Salvar campanha no histórico e revisar envios',exact:true}).click();
  await expect(page.getByRole('button',{name:'3. Contatos',exact:true})).toHaveAttribute('aria-current','step');
  await expect.poll(()=>campaignCreates).toBe(2);
  expect(savedCampaign?.nome).toBe('Nova campanha de retorno');
  await expect(page.getByRole('button',{name:'Registrar contato manual',exact:true}).first()).toBeEnabled();
  await page.getByRole('button',{name:'Registrar contato manual',exact:true}).first().click();
  await expect.poll(()=>savedContact?.campanha_id).toBe('created-fixture-2');

  // Returning to the saved message without edits must not create a duplicate campaign.
  await page.getByRole('button',{name:'2. Mensagem',exact:true}).click();
  await page.getByRole('button',{name:'Voltar aos contatos da campanha salva',exact:true}).click();
  await expect(page.getByRole('button',{name:'3. Contatos',exact:true})).toHaveAttribute('aria-current','step');
  expect(campaignCreates).toBe(2);
  await page.locator('#clientes-subtab-clientes').click();
  await page.getByRole('button',{name:'Ver perfil',exact:true}).filter({visible:true}).first().click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(contract.profile.beneficio.explicacao,{exact:true})).toBeVisible();
  await dialog.getByRole('combobox').selectOption('telefone');
  await dialog.getByRole('button',{name:'Salvar preferências declaradas',exact:true}).click();
  await expect.poll(()=>savedPreference?.canal_preferido).toBe('telefone');
  await page.getByRole('button',{name:'Fechar ficha do cliente',exact:true}).click();
  await expect(page.locator('#clientes-subtab-clientes')).toBeVisible();
  expect(errors).toEqual([]);
});

test('relationship keeps missing results distinct from zero and empty audiences collapsed',async ({page},testInfo)=>{
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//,socket=>socket.onMessage(()=>{}));
  const summary=structuredClone(contract.summary);
  summary.oportunidades=summary.oportunidades.map((op:Record<string,unknown>)=>({...op,elegiveis_count:0,elegiveis_cliente_ids:[]}));
  summary.resultados.retorno_apos_abordagem={status_mensuracao:'NAO_MENSURADO',clientes_abordados_no_periodo:0};
  await page.route('**/fidelidade/clientes',route=>route.fulfill({json:contract.customers}));
  await page.route('**/fidelidade/crm/resumo**',route=>route.fulfill({json:summary}));
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  if (!(await page.locator('.cashier-sidebar:visible').count())) {
    const menu=page.getByRole('button',{name:'Abrir menu completo',exact:true});
    if(await menu.isVisible()) await menu.click();
    else await page.getByRole('button',{name:'Abrir menu principal',exact:true}).click();
  }
  await page.locator('.cashier-sidebar:visible').getByRole('button',{name:/^Relacionamento(?: \d+)?$/}).click();
  await expect(page.getByText('Nenhum grupo precisa de contato hoje. Consulte sua base em Clientes.')).toBeVisible();
  await expect(page.getByText(/^Outros grupos/)).toBeVisible();
  await expect(page.locator('#clientes-subtab-fidelidade')).toHaveCount(0);
  await expect(page.locator('#clientes-subtab-cupons')).toHaveCount(0);
  await page.locator('#clientes-subtab-resultados').click();
  const returning=page.locator('article').filter({has:page.getByRole('heading',{name:'Clientes que voltaram',exact:true})});
  const revenue=page.locator('article').filter({has:page.getByRole('heading',{name:'Quanto compraram após o contato',exact:true})});
  await expect(returning.locator('strong')).toHaveText('—');
  await expect(revenue.locator('strong')).toHaveText('—');
  await expect(revenue).not.toContainText('R$ 0,00');
  await page.screenshot({path:testInfo.outputPath(`relationship-no-contacts-${testInfo.project.name}.png`),fullPage:true,animations:'disabled'});
});


test('campaign responses cannot unlock edited drafts or carry late contact confirmations forward', async ({page}) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\\/ws\\//, socket => socket.onMessage(() => {}));
  await page.route('**/caixa/configuracoes', route => route.fulfill({json:{
    ...cashierConfig, plano:'premium', plano_efetivo:'premium',
    entitlements:{...cashierConfig.entitlements,loyalty:true,coupons:true},
  }}));
  await page.route('**/fidelidade/clientes', route => route.fulfill({json:contract.customers}));
  await page.route('**/fidelidade/crm/resumo**', route => route.fulfill({json:contract.summary}));
  await page.route('**/caixa/cupons', route => route.fulfill({json:[]}));

  let releaseFirstSave!: () => void;
  const firstSaveGate = new Promise<void>(resolve => { releaseFirstSave = resolve; });
  let campaignCreates = 0;
  await page.route('**/fidelidade/crm/campanhas', async route => {
    campaignCreates++;
    const current = campaignCreates;
    if (current === 1) await firstSaveGate;
    await route.fulfill({json:{id:`campaign-fixture-${current}`}});
  });

  let releaseFirstContact!: () => void;
  const firstContactGate = new Promise<void>(resolve => { releaseFirstContact = resolve; });
  const contactCampaignIds: string[] = [];
  await page.route('**/fidelidade/crm/contatos', async route => {
    const payload = route.request().postDataJSON();
    contactCampaignIds.push(payload.campanha_id);
    if (contactCampaignIds.length === 1) await firstContactGate;
    await route.fulfill({json:{id:`contact-fixture-${contactCampaignIds.length}`}});
  });

  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  if (!(await page.locator('.cashier-sidebar:visible').count())) {
    const menu = page.getByRole('button',{name:'Abrir menu completo',exact:true});
    if (await menu.isVisible()) await menu.click();
    else await page.getByRole('button',{name:'Abrir menu principal',exact:true}).click();
  }
  await page.locator('.cashier-sidebar:visible').getByRole('button',{name:/^Relacionamento(?: \\d+)?$/}).click();
  const opportunity = contract.summary.oportunidades.find((op:{elegiveis_count:number}) => op.elegiveis_count > 0);
  const opportunityCard = page.locator('article').filter({has:page.getByRole('heading',{name:opportunity.titulo,exact:true})});
  await opportunityCard.getByRole('button',{name:'Abrir público e iniciar ação',exact:true}).click();
  await page.getByRole('button',{name:'Continuar para mensagem',exact:true}).click();
  await page.getByRole('button',{name:'Salvar campanha no histórico e revisar envios',exact:true}).click();
  await expect.poll(() => campaignCreates).toBe(1);

  // The operator can move back and change the draft while the POST is in flight.
  await page.getByRole('button',{name:'1. Público',exact:true}).click();
  await page.getByLabel('Identificação da campanha').fill('Campanha editada durante o salvamento');
  releaseFirstSave();
  await expect(page.getByText(/alterou o rascunho durante o salvamento/)).toBeVisible();
  await expect(page.getByRole('button',{name:'3. Contatos',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'2. Mensagem',exact:true}).click();
  await page.getByRole('button',{name:'Salvar campanha no histórico e revisar envios',exact:true}).click();
  await expect(page.getByRole('button',{name:'3. Contatos',exact:true})).toHaveAttribute('aria-current','step');
  expect(campaignCreates).toBe(2);

  // A late confirmation for the old campaign must not mark the newly edited draft.
  await page.getByRole('button',{name:'Registrar contato manual',exact:true}).first().click();
  await expect.poll(() => contactCampaignIds.length).toBe(1);
  await page.getByRole('button',{name:'1. Público',exact:true}).click();
  await page.getByLabel('Identificação da campanha').fill('Terceira campanha');
  releaseFirstContact();
  await expect(page.getByText(/Contato registrado na campanha anterior/)).toBeVisible();
  await page.getByRole('button',{name:'2. Mensagem',exact:true}).click();
  await page.getByRole('button',{name:'Salvar campanha no histórico e revisar envios',exact:true}).click();
  await expect(page.getByRole('button',{name:'3. Contatos',exact:true})).toHaveAttribute('aria-current','step');
  await expect(page.getByRole('button',{name:'Registrar contato manual',exact:true}).first()).toBeEnabled();
  await page.getByRole('button',{name:'Registrar contato manual',exact:true}).first().click();
  await expect.poll(() => contactCampaignIds.length).toBe(2);
  expect(contactCampaignIds).toEqual(['campaign-fixture-2','campaign-fixture-3']);
  expect(campaignCreates).toBe(3);
});
