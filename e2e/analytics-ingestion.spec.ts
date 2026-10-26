import { expect, test } from '@playwright/test';

test('SDK real envia diagnóstico com chave pública e sem credenciais da aplicação', async ({ page }) => {
  test.skip(process.env.KOMA_E2E_PREVIEW !== 'true', 'Requer build controlado com credencial pública fictícia.');
  let receipts = 0;
  await page.route('http://127.0.0.1:7999/**', async route => {
    if (route.request().method() === 'POST') receipts++;
    await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { status: 1 } });
  });
  await page.route('http://127.0.0.1:8000/**', route => route.fulfill({ json: {} }));
  await page.goto('/?view=operacional');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(resource => resource.name.includes('/module.no-external-')));
  const captured = await page.evaluate(async () => {
    const resource = performance.getEntriesByType('resource').find(resource => resource.name.includes('/module.no-external-'))!;
    const { default: sdk } = await import(/* @vite-ignore */ resource.name);
    sdk.on('eventCaptured', (event: { event: string; properties: Record<string, unknown> }) => {
      if (event.event === 'diagnostic_sdk_probe') (window as any).__SDK_PROBE__ = event.properties;
    });
    sdk.capture('diagnostic_sdk_probe', {
      restaurant_id: 99051, access_token: 'private-application-jwt', customer_phone: 'private-phone',
      nested: { token: 'private-capability', useful: true }, request_id: 'req-fixture-99051',
    });
    return (window as any).__SDK_PROBE__;
  });
  // The real SDK drops events when before_send removes its required token.
  expect(captured).toBeDefined();
  expect(captured.token).toBe('phc_fixture_public_project');
  expect(captured.request_id).toBe('req-fixture-99051');
  expect(captured.nested).toEqual({ useful: true });
  expect(JSON.stringify(captured)).not.toContain('private-');
  await expect.poll(() => receipts, { timeout: 10_000 }).toBeGreaterThan(0);
});
