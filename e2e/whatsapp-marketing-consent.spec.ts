import path from 'node:path';
import {expect,test} from '@playwright/test';

const token='private-consent-fixture-token-'.repeat(3);
test('convite identifica a loja e só oferece confirmação pelo próprio WhatsApp',async({page},info)=>{
  const requests:string[]=[];
  const telemetry:string[]=[];
  const mutations:string[]=[];
  await page.route('**/api/**',route=>route.abort());
  await page.route('**/*posthog.com/**',route=>route.abort());
  page.on('request',request=>{
    if(new URL(request.url()).hostname.endsWith('posthog.com'))telemetry.push(request.url());
    if(request.method()==='POST' && request.url().includes('/whatsapp/') && !request.url().endsWith('/consent/preview'))mutations.push(request.url());
  });
  await page.route('**/api/cardapio/whatsapp/consent/preview',route=>{
    requests.push(route.request().method());
    expect(route.request().postDataJSON()).toEqual({token});
    return route.fulfill({json:{restaurant_name:'Loja de teste',phone_ending:'1234',
      whatsapp_url:'https://wa.me/5511999999999?text='+encodeURIComponent('Autorizo ofertas desta loja. Confirmação sintética.'),consent_confirmed:false}});
  });
  await page.goto('/w/c#'+token);
  await expect(page).toHaveURL(/\/w\/c$/);
  await expect(page.getByRole('heading',{name:'Receber ofertas pelo WhatsApp'})).toBeVisible();
  await expect(page.getByText('Loja de teste',{exact:true})).toBeVisible();
  await expect(page.getByText('1234',{exact:true})).toBeVisible();
  const link=page.getByRole('link',{name:'Confirmar pelo meu WhatsApp',exact:true});
  await expect(link).toHaveAttribute('href',/^https:\/\/wa.me\//);
  await expect(link).toHaveAttribute('rel','noopener noreferrer');
  await expect(page.getByText('A confirmação só vale depois que sua mensagem for recebida.',{exact:false})).toBeVisible();
  expect(requests.length).toBeGreaterThan(0); // StrictMode can replay read-only effects in development.
  expect(requests.every(method=>method==='POST')).toBe(true);
  expect(mutations).toEqual([]);
  expect(telemetry).toEqual([]);
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain(token);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(process.env.KOMA_VISUAL_OUTPUT_DIR)await page.screenshot({path:path.join(process.env.KOMA_VISUAL_OUTPUT_DIR,`confirmar-ofertas-${info.project.name}.png`),fullPage:true});
});

test('convite ausente não consulta API nem autoriza ofertas',async({page})=>{
  let calls=0;
  await page.route('**/api/cardapio/whatsapp/consent/preview',route=>{calls++;return route.abort();});
  await page.goto('/w/c');
  await expect(page.getByRole('alert')).toHaveText('Abra o convite fornecido pelo restaurante.');
  await expect(page.getByRole('link',{name:'Confirmar pelo meu WhatsApp'})).toHaveCount(0);
  expect(calls).toBe(0);
});

for(const status of [404,503])test(`convite indisponível ${status} nunca abre confirmação`,async({page})=>{
  await page.route('**/api/cardapio/whatsapp/consent/preview',route=>route.fulfill({status,json:{detail:'fixture'}}));
  await page.goto('/w/c#'+token);
  await expect(page.getByRole('alert')).toContainText('Convite indisponível ou expirado');
  await expect(page.getByRole('link',{name:'Confirmar pelo meu WhatsApp'})).toHaveCount(0);
});
