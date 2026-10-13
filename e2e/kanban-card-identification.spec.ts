import {openOperationalScenario,showStage} from './fixtures/operational';
import {expect,test} from '@playwright/test';
import {mockCashierBackend,seedCashierSession} from './fixtures/cashier';

for (const theme of ['dark','light']) for (const size of ['padrao','gigante']) {
  test(`many Kanban cards identify fulfillment and persisted number in ${theme} ${size}`,async({page})=>{
    await mockCashierBackend(page);
    await seedCashierSession(page);
    await page.addInitScript(({theme,size})=>{
      localStorage.setItem('@koma:theme',theme);
      localStorage.setItem('koma_font_size',size);
    },{theme,size});
    const orders=Array.from({length:8},(_,index)=>({
      id:`scan-check-${index}`,restaurante_id:99001,numero_pedido:101+index,
      tipo:index%2?'Delivery':'Retirada',identificador:`Cliente ${index} com nome comprido`,
      fechada:false,garcom_id:'caixa-e2e',valor_pago:0,delivery_status:'producao',
      delivery_telefone:'85999999999',delivery_forma_pagamento:'dinheiro',
      criado_em:new Date(Date.now()-12*60000).toISOString(),
      lancamentos:[{id:`scan-launch-${index}`,origem:index%2?'caixa':'cardapio',status:'producao'}],
      itens:[{id:`scan-item-${index}`,produto_id:'101',produto:{id:'101',nome:'Item do pedido',preco:29.9},preco_unit:29.9,status:'preparando',lancamento_id:`scan-launch-${index}`}],
    }));
    await page.route('**/comandas/delivery/ativos',route=>route.fulfill({json:orders}));
    await page.route('**/comandas/delivery/pendentes',route=>route.fulfill({json:[]}));
    await page.route('**/comandas/detalhes/todos?*',route=>route.fulfill({json:orders}));
    let prints=0;
    await page.route('**/comandas/scan-check-0/imprimir-recibo',async route=>{
      expect(route.request().method()).toBe('POST');prints++;
      await route.fulfill({json:{ok:true}});
    });
    await page.goto('/?view=caixa');
    const digitalTab=page.getByRole('tab',{name:/^Digitais/});
    const cards=page.locator('.orders-card--digital');
    await expect(cards).toHaveCount(8);
    if(await digitalTab.isVisible()) await digitalTab.click();
    await expect(cards.first()).toBeVisible();
    for(const [index,card] of (await cards.all()).entries()) {
      await expect(card.locator('.orders-card__identity-title')).toHaveText(`Cliente ${index} com nome comprido`);
      const tag=card.locator('.orders-card__fulfillment-tag');
      await expect(tag).toHaveText(index%2?'Delivery':'Retirada');
      expect(await tag.evaluate(el=>{
        const style=getComputedStyle(el);
        const luminance=(value:string)=>{
          const channels=value.match(/[\d.]+/g)!.slice(0,3).map(Number).map(c=>{const v=c/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
          return channels.reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
        };
        const fg=luminance(style.color), bg=luminance(style.backgroundColor);
        return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
      })).toBeGreaterThanOrEqual(4.5);
      const tagBox=await tag.boundingBox();
      const cardBox=await card.boundingBox();
      expect(tagBox!.y).toBeGreaterThanOrEqual(cardBox!.y);
      expect(tagBox!.y+tagBox!.height).toBeLessThanOrEqual(cardBox!.y+cardBox!.height);
      await expect(card.locator('.orders-card__number strong')).toHaveText(`#${101+index}`);
      await expect(card.locator('.orders-card__identity-subtitle')).toContainText('85999999999');
      expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      const number=await card.locator('.orders-card__number').boundingBox();
      const title=await card.locator('.orders-card__identity-title').boundingBox();
      expect(number!.x+number!.width).toBeLessThan(title!.x);
      expect(await card.locator('.orders-card__number strong').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    }
    const first=await cards.nth(0).boundingBox(), next=await cards.nth(1).boundingBox();
    expect(next!.y-(first!.y+first!.height)).toBeGreaterThanOrEqual(8);
    expect(next!.y-(first!.y+first!.height)).toBeLessThanOrEqual(12);
    const relativeTop=await cards.first().evaluate(el=>el.querySelector('.orders-card__fulfillment-tag')!.getBoundingClientRect().top-el.getBoundingClientRect().top);
    await cards.first().hover();
    expect(await cards.first().evaluate(el=>el.querySelector('.orders-card__fulfillment-tag')!.getBoundingClientRect().top-el.getBoundingClientRect().top)).toBeCloseTo(relativeTop,0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`cards-${theme}-${size}.png`),fullPage:true});
    await cards.first().getByRole('button',{name:'Imprimir conferência do pedido 101',exact:true}).click();
    await expect.poll(()=>prints).toBe(1);
    await expect(page.locator('.orders-detail-modal')).toHaveCount(0);
    await cards.first().click();
    await expect(page.getByRole('dialog',{name:'Pedido #101'})).toBeVisible();
  });
}

test('table cards distinguish table number from the persisted order and ready value',async({page})=>{
  await openOperationalScenario(page);
  const preparing=page.locator('.orders-card--salon').first();
  await expect(preparing.locator('.orders-card__number-label')).toHaveText('Mesa');
  await expect(preparing.locator('.orders-card__number strong')).toHaveText('07');
  await expect(preparing.locator('.orders-card__identity-title')).toHaveText('Pedido #24');
  await expect(preparing.locator('.orders-card__price')).toHaveText(/112,00/);
  await page.screenshot({path:test.info().outputPath('cards-mesa.png'),fullPage:true});
  await showStage(page,'Concluir');
  const ready=page.locator('.orders-card--closing').first();
  await expect(ready.locator('.orders-card__number-label')).toHaveText('Mesa');
  await expect(ready.locator('.orders-card__number strong')).toHaveText('07');
  await expect(ready.locator('.orders-card__price')).toHaveText(/48,00/);
});
