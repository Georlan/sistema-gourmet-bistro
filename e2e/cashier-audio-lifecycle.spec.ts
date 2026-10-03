import { expect, test } from '@playwright/test';

// Exercise the real hook in Chromium, with deterministic audio and timers.
test('arrival with autoaccept and an open drawer; manual pending loop has one owner and cleans up', async ({ page }) => {
  await page.goto('/');
  await page.clock.install();
  await page.evaluate(async () => {
    const reactUrl = '/.vite/e2e/deps/react.js';
    const domUrl = '/.vite/e2e/deps/react-dom_client.js';
    const hookUrl = '/src/components/caixa/realtime/useCashierAlerts.ts';
    const { default: React } = await import(reactUrl);
    const { default: ReactDOM } = await import(domUrl);
    const { useCashierAlerts } = await import(hookUrl);
    const w = window as any;
    w.alertNotes = 0;
    w.closedContexts = 0;
    class FakeAudioContext {
      state = 'suspended'; currentTime = 0; destination = {};
      async resume() { this.state = 'running'; }
      async close() { this.state = 'closed'; w.closedContexts++; }
      createOscillator() { return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() { w.alertNotes++; }, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    }
    w.AudioContext = FakeAudioContext;
    localStorage.setItem('@koma:sound_enabled', 'true');
    const host = document.createElement('div'); document.body.append(host);
    const root = ReactDOM.createRoot(host);
    function Harness(props: any) { useCashierAlerts(props); return React.createElement('button', { id: 'audio-gesture' }, 'Interação normal'); }
    w.renderAlerts = (ids: string[], pending: string[]) => root.render(React.createElement(Harness, {
      orders: [], deliveryOrders: ids.map(id => ({ id })), pendingAcceptanceOrders: pending.map(id => ({ id })), isDrawerOpen: true,
    }));
    w.unmountAlerts = () => root.unmount();
    w.renderAlerts([], []);
  });
  await page.locator('#audio-gesture').click();
  await page.evaluate(() => (window as any).renderAlerts(['auto-1'], []));
  await expect.poll(() => page.evaluate(() => (window as any).alertNotes)).toBe(3);
  await page.clock.runFor(8000);
  expect(await page.evaluate(() => (window as any).alertNotes)).toBe(3);
  // Reconciliation of the same autoaccepted identity is silent.
  await page.evaluate(() => (window as any).renderAlerts(['auto-1'], []));
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => (window as any).alertNotes)).toBe(3);
  // Arrival and initial pending effect must coalesce into a single signal.
  await page.evaluate(() => (window as any).renderAlerts(['auto-1', 'manual-1'], ['manual-1']));
  await expect.poll(() => page.evaluate(() => (window as any).alertNotes)).toBe(6);
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as any).alertNotes)).toBe(9);
  await page.clock.runFor(1000);
  await page.evaluate(() => (window as any).renderAlerts(['auto-1', 'manual-1', 'manual-2'], ['manual-1', 'manual-2']));
  await expect.poll(() => page.evaluate(() => (window as any).alertNotes)).toBe(12);
  await page.clock.runFor(3000);
  expect(await page.evaluate(() => (window as any).alertNotes)).toBe(15);
  await page.evaluate(() => (window as any).renderAlerts(['auto-1', 'manual-1', 'manual-2'], []));
  await page.clock.runFor(8000);
  expect(await page.evaluate(() => (window as any).alertNotes)).toBe(15);
  await page.evaluate(() => (window as any).renderAlerts(['auto-1', 'manual-1', 'manual-2'], ['manual-2']));
  await expect.poll(() => page.evaluate(() => (window as any).alertNotes)).toBe(18);
  await page.evaluate(() => (window as any).unmountAlerts());
  await page.clock.runFor(8000);
  expect(await page.evaluate(() => (window as any).alertNotes)).toBe(18);
  expect(await page.evaluate(() => (window as any).closedContexts)).toBe(1);
});
