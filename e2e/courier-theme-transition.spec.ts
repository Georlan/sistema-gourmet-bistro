import {test,expect} from '@playwright/test';
const order={id:'theme-fixture',numero_pedido:127,cliente_nome:'Ana Oliveira',delivery_endereco:'Rua dos Ipês, 245 · Centro',delivery_taxa:5,delivery_status:'transito',total:42,valor_pago:42,valor_a_cobrar:0,itens_resumo:'1× Suco',criado_em:null};
async function fixture(page:import('@playwright/test').Page,count=1){
 let gets=0;
 await page.route('**/comandas/motoboys/**',route=>{gets++;return route.fulfill({json:{motoboy:{id:99090,nome:'Lucas',telefone:''},entregas:Array.from({length:count},(_,i)=>({...order,id:`theme-${i}`,numero_pedido:127+i}))}});});
 await page.routeWebSocket('**/ws/entregador',ws=>{ws.send(JSON.stringify({event:'courier_ready'}));});
 await page.addInitScript(()=>{localStorage.setItem('@koma:theme','dark');const original=document.startViewTransition?.bind(document);(window as any).themeTransitions=0;if(original)document.startViewTransition=(...args:any[])=>{(window as any).themeTransitions++;return (original as any)(...args)};});
 await page.goto('/entregador#token=theme-test-fixture');await expect(page.getByRole('heading',{name:/Entregas/})).toBeVisible();await page.waitForTimeout(350);return ()=>gets;
}
test('preenchimento nativo troca e persiste sem requisições ou efeitos pendentes',async({page})=>{
 const gets=await fixture(page);const baseline=gets();
 await page.getByRole('button',{name:'Usar tema claro'}).click();
 await expect(page.locator('html')).toHaveAttribute('data-koma-theme','light');
 await expect.poll(()=>page.evaluate(()=>(window as any).themeTransitions)).toBe(1);
 await expect(page.locator('html')).not.toHaveAttribute('data-courier-theme-wipe');
 await expect(page.getByRole('button',{name:'Usar tema escuro'})).toBeEnabled();
 expect(gets()).toBe(baseline);expect(await page.evaluate(()=>localStorage.getItem('@koma:theme'))).toBe('light');
 await page.getByRole('button',{name:'Usar tema escuro'}).click();
 await expect(page.locator('html')).toHaveAttribute('data-koma-theme','dark');
 await expect(page.locator('html')).not.toHaveAttribute('data-courier-theme-wipe');
 expect(gets()).toBe(baseline);
 await page.reload();await expect(page.getByRole('heading',{name:/Entregas/})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-koma-theme','dark');
});
for(const scenario of ['reduced','unsupported','save-data','low-memory','long-list','native-error'])test(`troca imediata com fallback: ${scenario}`,async({page})=>{
 if(scenario==='reduced')await page.emulateMedia({reducedMotion:'reduce'});
 if(scenario==='unsupported')await page.addInitScript(()=>Object.defineProperty(document,'startViewTransition',{value:undefined,configurable:true}));
 if(scenario==='save-data')await page.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true},configurable:true}));
 if(scenario==='low-memory')await page.addInitScript(()=>Object.defineProperty(navigator,'deviceMemory',{value:2,configurable:true}));
 if(scenario==='native-error')await page.addInitScript(()=>Object.defineProperty(document,'startViewTransition',{value:()=>{throw new Error('Unavailable')},writable:true,configurable:true}));
 const gets=await fixture(page,scenario==='long-list'?31:1);const baseline=gets();
 await page.getByRole('button',{name:'Usar tema claro'}).click();await expect(page.locator('html')).toHaveAttribute('data-koma-theme','light');await expect(page.locator('html')).not.toHaveAttribute('data-courier-theme-wipe');
 if(scenario!=='native-error')expect(await page.evaluate(()=>(window as any).themeTransitions)).toBe(0);
 expect(gets()).toBe(baseline);await expect(page.getByRole('button',{name:'Usar tema escuro'})).toBeEnabled();
});
