import {expect,test} from '@playwright/test';
import {readFileSync} from 'node:fs';
const contract = JSON.parse(readFileSync(new URL('./fixtures/crm-api-contract.json', import.meta.url), 'utf8'));
import {mockCashierBackend,seedCashierSession} from './fixtures/cashier';

test('all CRM workspaces render backend-generated responses without losing the operational shell',async ({page})=>{
  const errors:string[]=[];
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
