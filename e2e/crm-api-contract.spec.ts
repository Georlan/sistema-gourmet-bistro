import {expect,test} from '@playwright/test';
import {readFileSync} from 'node:fs';
const contract = JSON.parse(readFileSync(new URL('./fixtures/crm-api-contract.json', import.meta.url), 'utf8'));
import {mockCashierBackend,seedCashierSession} from './fixtures/cashier';

test('all CRM workspaces render backend-generated responses without losing the operational shell',async ({page})=>{
  const errors:string[]=[];
  let savedCampaign: Record<string,unknown> | undefined;
  let savedContact: Record<string,unknown> | undefined;
  let savedPreference: Record<string,unknown> | undefined;
  page.on('pageerror',error=>errors.push(error.message));
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//,socket=>socket.onMessage(()=>{}));
  await page.route('**/fidelidade/clientes',route=>route.fulfill({json:contract.customers}));
  await page.route('**/fidelidade/crm/resumo**',route=>route.fulfill({json:contract.summary}));
  await page.route('**/fidelidade/clientes/*/perfil',route=>route.fulfill({json:contract.profile}));
  await page.route('**/fidelidade/clientes/*/preferencias', async route=>{
    savedPreference=route.request().postDataJSON();
    await route.fulfill({json:{ok:true}});
  });
  await page.route('**/fidelidade/crm/campanhas', async route=>{savedCampaign=route.request().postDataJSON(); await route.fulfill({json:{id:'created-fixture'}});});
  await page.route('**/fidelidade/crm/contatos', async route=>{savedContact=route.request().postDataJSON(); await route.fulfill({json:{id:'contact-fixture'}});});
  await page.goto('/?view=caixa');
  await expect(page.locator('.orders-board')).toBeVisible();
  if (!(await page.locator('.cashier-sidebar:visible').count())) {
    const menu=page.getByRole('button',{name:'Abrir menu completo',exact:true});
    if(await menu.isVisible()) await menu.click();
    else await page.getByRole('button',{name:'Abrir menu principal',exact:true}).click();
  }
  await page.locator('.cashier-sidebar:visible').getByRole('button',{name:/^Clientes(?: \d+)?$/}).click();
  for(const name of [/1\. Oportunidades/,/2\. Clientes/,/3\. Campanhas/,/4\. Benefícios/,/5\. Resultados/]){
    await page.getByRole('tab',{name}).click();
    await expect(page.getByRole('tab',{name})).toHaveAttribute('aria-selected','true');
    await expect(page.getByText('Não foi possível abrir Clientes.',{exact:true})).toHaveCount(0);
  }
  await expect(page.getByText('Campanha fixture de contrato',{exact:true})).toBeVisible();
  const opportunity = contract.summary.oportunidades.find((op: {elegiveis_count:number})=>op.elegiveis_count>0);
  await page.getByRole('tab',{name:/1\. Oportunidades/}).click();
  const opportunityCard=page.locator('article').filter({has:page.getByRole('heading',{name:opportunity.titulo,exact:true})});
  const audienceCustomer=contract.customers.find((c:{id:string})=>opportunity.elegiveis_cliente_ids.includes(c.id));
  await expect(opportunityCard).toContainText(audienceCustomer.nome.split(' ')[0]);
  await opportunityCard.getByRole('button',{name:'Abrir público e iniciar ação',exact:true}).click();
  await page.getByRole('button',{name:'Salvar campanha no histórico e revisar envios',exact:true}).click();
  await expect.poll(()=>savedCampaign?.abordagem_tipo).toBe('SEM_DESCONTO');
  await expect.poll(()=>savedCampaign?.segmento_filtro).toBe(opportunity.id);
  await page.getByRole('button',{name:'Registrar contato manual',exact:true}).first().click();
  await expect.poll(()=>savedContact?.canal).toBe('WHATSAPP_MANUAL');
  await expect.poll(()=>savedContact?.acao_executada).toBe('CONTATO_MANUAL_CONFIRMADO');
  expect(savedContact?.mensagem_personalizada).toEqual(expect.any(String));
  await page.getByRole('tab',{name:/2\. Clientes/}).click();
  await page.getByRole('button',{name:'Ver perfil',exact:true}).filter({visible:true}).first().click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(contract.profile.beneficio.explicacao,{exact:true})).toBeVisible();
  await dialog.getByRole('combobox').selectOption('telefone');
  await dialog.getByRole('button',{name:'Salvar preferências declaradas',exact:true}).click();
  await expect.poll(()=>savedPreference?.canal_preferido).toBe('telefone');
  await page.getByRole('button',{name:'Fechar ficha do cliente',exact:true}).click();
  await expect(page.getByRole('tab',{name:/2\. Clientes/})).toBeVisible();
  expect(errors).toEqual([]);
});
