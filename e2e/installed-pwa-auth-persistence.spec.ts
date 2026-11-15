import { expect, test, type Page } from '@playwright/test';

const APP_ORIGIN = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;
const API_ORIGIN = 'http://127.0.0.1:8000';

function testJwt(restaurantId: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ sub: 'operator-pwa', restaurante_id: restaurantId, exp: Math.floor(Date.now() / 1000) + 3600 }),
    'playwright-fixture',
  ].join('.');
}

async function mockOperationalApi(page: Page, token: string) {
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === APP_ORIGIN) return route.continue();
    if (url.origin !== API_ORIGIN) return route.abort();
    if (request.method() === 'POST' && url.pathname === '/auth/login') {
      return route.fulfill({ json: {
        access_token: token,
        usuario: { id: 'operator-pwa', nome: 'Operador PWA', role: 'admin', cargo: 'admin', restaurante_id: 7 },
      } });
    }
    let body: unknown = [];
    if (url.pathname === '/api/onboarding/status') {
      body = { onboarding: { releaseState: 'released', operationReleased: true } };
    } else if (url.pathname === '/produtos/catalogo') body = { categorias: [], produtos: [] };
    else if (url.pathname === '/caixa/configuracoes') body = {};
    else if (url.pathname === '/caixa/turno-atual') body = null;
    else if (url.pathname === '/caixa/turno-atual/resumo') body = { total_vendas: 0, comandas_abertas_count: 0 };
    return route.fulfill({ json: body });
  });
}

async function simulateInstalledPwa(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true });
  });
}

async function encryptedSnapshot(page: Page): Promise<{ size: number; isPlaintext: boolean } | null> {
  return page.evaluate(async () => {
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    if (!databases.some(db => db.name === 'koma-installed-operator-v1')) return null;
    return new Promise<{ size: number; isPlaintext: boolean } | null>(resolve => {
      const open = indexedDB.open('koma-installed-operator-v1');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        const req = db.transaction('credentials', 'readonly').objectStore('credentials').get('session');
        req.onsuccess = () => {
          const record = req.result as { ciphertext?: ArrayBuffer } | undefined;
          resolve(record ? {
            size: record.ciphertext?.byteLength || 0,
            isPlaintext: JSON.stringify(record).includes('operator-pwa'),
          } : null);
          db.close();
        };
        req.onerror = () => { db.close(); resolve(null); };
      };
    });
  });
}

test('PWA retoma restaurante após fechar, navegador comum não herda e logout apaga retomada', async ({ page, context }) => {
  const token = testJwt(7);
  await simulateInstalledPwa(page);
  await mockOperationalApi(page, token);
  await page.goto('/?view=operacional');

  await page.getByLabel('E-MAIL').fill('pwa@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('senha-exemplo');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('koma_operator_session_caixa') || 'null')?.user?.restaurante_id)).toBe(7);
  await expect.poll(() => encryptedSnapshot(page)).toEqual({ size: expect.any(Number), isPlaintext: false });

  // Mesmo origin, mas não instalado: mantém o contrato de login isolado por aba.
  const browserTab = await context.newPage();
  await mockOperationalApi(browserTab, token);
  await browserTab.goto('/?view=operacional');
  await expect(browserTab.getByLabel('E-MAIL')).toBeVisible();
  await browserTab.close();

  // Novo documento/atalho (sem sessionStorage herdado): somente o PWA restaura.
  await page.close();
  const reopened = await context.newPage();
  await simulateInstalledPwa(reopened);
  await mockOperationalApi(reopened, token);
  await reopened.goto('/?view=operacional');
  await expect(reopened.getByLabel('E-MAIL')).toHaveCount(0);
  await expect.poll(() => reopened.evaluate(() => JSON.parse(sessionStorage.getItem('koma_operator_session_caixa') || 'null')?.user?.restaurante_id)).toBe(7);

  if ((reopened.viewportSize()?.width || 1366) < 1024) {
    await reopened.getByRole('button', { name: 'Abrir menu principal' }).click();
  }
  await reopened.getByRole('button', { name: 'Abrir conta e preferências', exact: true }).click();
  await reopened.getByRole('button', { name: 'Sair / trocar operador' }).click();
  await expect(reopened.getByLabel('E-MAIL')).toBeVisible();
  await expect.poll(() => encryptedSnapshot(reopened)).toBeNull();

  await reopened.close();
  const afterLogout = await context.newPage();
  await simulateInstalledPwa(afterLogout);
  await mockOperationalApi(afterLogout, token);
  await afterLogout.goto('/?view=operacional');
  await expect(afterLogout.getByLabel('E-MAIL')).toBeVisible();
});
