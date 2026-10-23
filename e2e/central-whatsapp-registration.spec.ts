import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('restaurante cadastra destinatário central sem QR, sessão própria ou polling', async ({ page }, info) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  let phone: string | null = null;
  const calls: string[] = [];
  await page.route('**/caixa/configuracoes/whatsapp**', async route => {
    const path = new URL(route.request().url()).pathname;
    calls.push(`${route.request().method()} ${path}`);
    if (path.endsWith('/customer-notices')) return route.fulfill({ json: { customer_notices_enabled: false } });
    if (path.endsWith('/recipient')) {
      const body = route.request().postDataJSON();
      expect(body.confirm_receiving).toBe(true);
      phone = body.phone;
      return route.fulfill({ json: { state: 'registered', mode: 'central', enabled: false } });
    }
    return route.fulfill({ json: { state: phone ? 'registered' : 'not_configured', mode: 'central', enabled: false, phone_ending: phone?.slice(-4) || null } });
  });
  await page.goto('/?view=caixa&pagbank=cancelled');
  await page.getByRole('tab', { name: 'WhatsApp' }).click();
  const section = page.getByRole('region', { name: 'Avisos de pedidos pelo WhatsApp' });
  await expect(section.getByRole('heading', { name: 'Comandas pelo WhatsApp' })).toBeVisible();
  await expect(section.getByRole('button', { name: /QR|Conectar|pareamento/i })).toHaveCount(0);
  const save = section.getByRole('button', { name: 'Salvar telefone de recebimento' });
  await expect(save).toBeDisabled();
  await section.getByLabel('Telefone que receberá as comandas (com DDD)').fill('11999999999');
  await expect(save).toBeDisabled();
  await section.getByRole('checkbox').check();
  await save.click();
  await expect(section.getByText('Cadastrado — aguardando liberação')).toBeVisible();
  expect(calls.filter(call => call.startsWith('POST'))).toEqual(['POST /caixa/configuracoes/whatsapp/recipient']);
  const count = calls.length;
  await page.waitForTimeout(1200);
  expect(calls.length).toBe(count);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.KOMA_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.KOMA_EVIDENCE_DIR}/whatsapp-central-${info.project.name}.png`, fullPage: true });
});
