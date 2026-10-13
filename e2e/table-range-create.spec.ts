import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function setup(page: Page, fail = false) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'impressao_salao');
    sessionStorage.setItem('koma_active_subtab', 'mesas');
  });
  const rows = Array.from({length:8},(_,i)=>({id:i+1,nome:`Varanda ${i+1}`,capacidade:2}));
  const writes: {url: string; body: any}[] = [];
  await page.route(/\/mesas\/(?:lote)?$/, async route => {
    if (route.request().method() === 'GET') { await route.fulfill({json:rows}); return; }
    const body = route.request().postDataJSON();
    writes.push({url:route.request().url(),body});
    if (fail) { await route.fulfill({status:503,json:{detail:'Serviço indisponível. Tente novamente.'}}); return; }
    const created_ids: number[] = [];
    for (let id=body.first_number;id<=body.last_number;id++) {
      if (!rows.some(row=>row.id===id)) { rows.push({id,nome:`Mesa ${id}`,capacidade:body.capacity}); created_ids.push(id); }
    }
    await route.fulfill({json:{created_ids,preserved_count:body.last_number-body.first_number+1-created_ids.length,total_after:rows.length}});
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button',{name:'Adicionar mesa',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Adicionar mesa',exact:true});
  await expect(dialog.getByText('Número da mesa',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Várias mesas',exact:true}).click();
  return {dialog:page.getByRole('dialog',{name:'Adicionar várias mesas',exact:true}),rows,writes};
}

test('create 9 to 30 in one request, preserve eight existing tables and individual editing',async({page})=>{
  const {dialog,rows,writes} = await setup(page);
  await expect(dialog.getByLabel('Primeiro número')).toHaveValue('9');
  await dialog.getByLabel('Último número').fill('30');
  await expect(dialog.getByRole('status')).toContainText('22 novas mesas');
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:'Criar 22 mesas',exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Mesa 30',{exact:true}).last()).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].url).toContain('/mesas/lote');
  expect(writes[0].body).toEqual({first_number:9,last_number:30,capacity:4});
  expect(rows.slice(0,8)).toEqual(Array.from({length:8},(_,i)=>({id:i+1,nome:`Varanda ${i+1}`,capacidade:2})));
  expect(rows).toHaveLength(30);
  await page.getByRole('button',{name:'Adicionar mesa',exact:true}).click();
  const add = page.getByRole('dialog');
  await add.getByRole('button',{name:'Uma mesa',exact:true}).click();
  await expect(add.getByText('Número da mesa',{exact:true})).toBeVisible();
  await expect(add.getByText('Nome de referência',{exact:false})).toBeVisible();
});

test('overlapping range previews preservation, rejects invalid range and keeps draft on failure',async({page})=>{
  const {dialog,writes} = await setup(page,true);
  await dialog.getByLabel('Primeiro número').fill('1');
  await dialog.getByLabel('Último número').fill('10');
  await expect(dialog.getByRole('status')).toContainText('2 novas mesas');
  await expect(dialog.getByRole('status')).toContainText('8 já cadastradas');
  await dialog.getByLabel('Último número').fill('301');
  await expect(dialog.getByRole('button',{name:/Criar .* mesas/})).toBeDisabled();
  expect(writes).toHaveLength(0);
  await dialog.getByLabel('Último número').fill('10');
  await dialog.getByRole('button',{name:'Criar 2 mesas',exact:true}).click();
  await expect(dialog.getByText('Serviço indisponível. Tente novamente.',{exact:true})).toBeVisible();
  await expect(dialog.getByLabel('Último número')).toHaveValue('10');
  await expect(dialog.getByRole('button',{name:'Criar 2 mesas',exact:true})).toBeEnabled();
  expect(writes).toHaveLength(1);
});


test('large text and light mode keep fields and submission usable',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('koma_font_size','gigante');
    localStorage.setItem('@koma:theme','light');
  });
  const {dialog,writes} = await setup(page);
  await expect(page.locator('html')).toHaveAttribute('data-koma-theme','light');
  await dialog.getByLabel('Último número').fill('12');
  await expect(dialog.getByRole('status')).toContainText('4 novas mesas');
  const submit = dialog.getByRole('button',{name:'Criar 4 mesas',exact:true});
  await submit.scrollIntoViewIfNeeded();
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  const bounds = await submit.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await submit.click();
  await expect(dialog).toBeHidden();
  expect(writes).toHaveLength(1);
});
