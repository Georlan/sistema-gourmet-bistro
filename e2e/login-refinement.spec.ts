import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { publicMenuPayload } from './fixtures/menu-parity';

const APP = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;
const API = 'http://127.0.0.1:8000';

async function fixture(page: Page, accountRequired = false, restaurantName = publicMenuPayload.restaurante.nome) {
  const requests: { path: string; body: any }[] = [];
  await page.routeWebSocket('**/ws/**', () => {});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === APP) return route.continue();
    if (url.origin !== API) return route.abort();
    const path = url.pathname;
    if (route.request().method() === 'POST') requests.push({ path, body: route.request().postDataJSON() });
    if (path.endsWith('/public')) return route.fulfill({ json: {
      ...publicMenuPayload, restaurante: { ...publicMenuPayload.restaurante, nome: restaurantName, conta_cliente_obrigatoria: accountRequired },
    } });
    if (path.endsWith('/populares')) return route.fulfill({ json: { produtos: [] } });
    if (path === '/auth/login') return route.fulfill({ status: 401, json: { detail: 'E-mail ou senha incorretos.' } });
    if (path === '/cardapio/clientes/login') return route.fulfill({ status: 401, json: { detail: 'E-mail ou senha incorretos.' } });
    if (path.endsWith('/cadastro/solicitar')) return route.fulfill({ status: 202, json: { message: 'Confira seu e-mail.' } });
    if (path.endsWith('/password-recovery/request')) return route.fulfill({ status: 202, json: { message: 'Se houver uma conta, você receberá um link por e-mail.' } });
    return route.fulfill({ json: {} });
  });
  return requests;
}

async function capture(page: Page, info: TestInfo, name: string) {
  if (!process.env.KOMA_LOGIN_CAPTURE_DIR) return;
  await mkdir(process.env.KOMA_LOGIN_CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.KOMA_LOGIN_CAPTURE_DIR, `${info.project.name}-${name}.png`), animations: 'disabled' });
}

for (const theme of ['dark', 'light'] as const) {
  test(`equipe e cliente: telas reais e controles de senha em ${theme}`, async ({ page }, info) => {
    await fixture(page);
    await page.addInitScript(value => localStorage.setItem('@koma:theme', value), theme);
    await page.goto('/?view=operacional');
    await expect(page.locator('#login-username')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-koma-theme', theme);
    await expect(page.locator('[data-koma-logo="wordmark"] img:visible')).toHaveCount(1);
    await capture(page, info, `${theme}-equipe`);
    await page.goto('/cardapio?restaurante_id=2');
    await page.locator('#btn-login-trigger').click();
    await expect(page.locator('#auth-modal-card')).toBeVisible();
    await page.evaluate(value => { document.documentElement.dataset.komaTheme = value; }, theme);
    await capture(page, info, `${theme}-cliente`);
    const password = page.locator('#auth-login-form input[autocomplete="current-password"]');
    await password.fill('senha-local');
    await page.getByRole('button', { name: 'Mostrar senha', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ocultar senha', exact: true }).click();
    await expect(password).toHaveValue('senha-local');
    await expect(password).toHaveAttribute('type', 'password');
  });
}

test('equipe: teclado, erro acessível, senha visível e recuperação sem enviar login', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/?view=operacional');
  await page.locator('#login-username').fill('EQUIPE@KOMA.TEST');
  await page.locator('#login-password').fill('senha-local');
  await page.getByRole('button', { name: 'Mostrar senha', exact: true }).click();
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
  expect(requests).toHaveLength(0);
  await page.locator('#login-password').press('Enter');
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos.');
  expect(requests).toEqual([{ path: '/auth/login', body: { username: 'equipe@koma.test', password: 'senha-local' } }]);
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await expect(page.getByLabel('E-mail da conta', { exact: true })).toHaveValue('EQUIPE@KOMA.TEST');
  await page.getByLabel('E-mail da conta', { exact: true }).press('Enter');
  await expect(page.getByRole('status')).toContainText('Se houver uma conta');
  expect(requests.filter(r => r.path === '/auth/login')).toHaveLength(1);
  expect(requests.at(-1)).toEqual({ path: '/auth/password-recovery/request', body: { email: 'EQUIPE@KOMA.TEST', kind: 'staff' } });
});

test('equipe: envio repetido não duplica autenticação e falha mantém os dados', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let attempts = 0;
  await page.route(`${API}/auth/login`, async route => {
    attempts++;
    await gate;
    await route.fulfill({ status: 401, json: { detail: 'E-mail ou senha incorretos.' } });
  });
  await page.goto('/?view=operacional');
  await page.locator('#login-username').fill('equipe@koma.test');
  await page.locator('#login-password').fill('senha-local');
  await page.locator('form').evaluate(form => {
    for (let i = 0; i < 3; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('button', { name: 'Autenticando...' })).toBeDisabled();
  await expect(page.locator('#login-username')).toBeDisabled();
  await expect.poll(() => attempts).toBe(1);
  release();
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos.');
  await expect(page.locator('#login-password')).toHaveValue('senha-local');
  await expect(page.locator('#login-username')).toBeEnabled();
});

test('cliente: fechar durante autenticação cancela a resposta tardia', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let attempts = 0;
  await page.route(`${API}/cardapio/clientes/login`, async route => {
    attempts++;
    await gate;
    await route.fulfill({ json: { access_token: 'late-local-token', cliente: {
      id: 'local-client', nome: 'Cliente de teste', telefone: '11999999999', email_verificado: true,
    } } }).catch(() => {});
  });
  await page.goto('/cardapio?restaurante_id=2');
  await page.locator('#btn-login-trigger').click();
  await page.getByLabel('Seu e-mail', { exact: true }).fill('cliente@koma.test');
  await page.getByLabel('Sua senha', { exact: true }).fill('senha-local');
  await page.locator('#auth-login-form button[type=submit]').click();
  await expect.poll(() => attempts).toBe(1);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  release();
  await expect(page.locator('#auth-modal-card')).toHaveCount(0);
  await expect(page.locator('#btn-login-trigger')).toBeVisible();
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('late-local-token')))).toBe(false);
});

test('cliente: conta obrigatória mantém confirmação de e-mail e não promete compra como visitante', async ({ page }) => {
  await fixture(page, true);
  await page.route(`${API}/cardapio/clientes/login`, route => route.fulfill({ json: {
    access_token: 'unverified-test-token', cliente: { id: 'local', nome: 'Cliente', telefone: '11999999999', email_verificado: false },
  } }));
  await page.goto('/cardapio?restaurante_id=2');
  await page.locator('#btn-login-trigger').click();
  await expect(page.getByRole('button', { name: 'Continuar como visitante', exact: true })).toHaveCount(0);
  await page.getByLabel('Seu e-mail', { exact: true }).fill('cliente@koma.test');
  await page.getByLabel('Sua senha', { exact: true }).fill('senha-local');
  await page.locator('#auth-login-form button[type=submit]').click();
  await expect(page.getByRole('alert')).toContainText('Confirme seu e-mail');
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('unverified-test-token')))).toBe(false);
});

test('320px, teclado e temas: campos legíveis, ação com contraste e sem transbordamento', async ({ page }, info) => {
  await fixture(page);
  await page.setViewportSize({ width: 320, height: 640 });
  // Measure resting theme colors, independently of the 140 ms color transition.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=operacional');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => { document.documentElement.dataset.komaTheme = value; }, theme);
    await capture(page, info, `320-${theme}-equipe`);
    const metrics = await page.locator('button[type=submit]').evaluate(node => {
      const style = getComputedStyle(node);
      const luminance = (rgb: string) => rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => {
        const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
      }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const a = luminance(style.color), b = luminance(style.backgroundColor);
      return { contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), height: node.getBoundingClientRect().height,
        width: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    expect(metrics.contrast).toBeGreaterThanOrEqual(4.5);
    expect(metrics.height).toBeGreaterThanOrEqual(44);
    expect(metrics.width).toBeLessThanOrEqual(metrics.viewport);
  }
});

test('cliente: modal contém foco, cadastro mantém contrato e visitante retorna ao cardápio', async ({ page }, info) => {
  const requests = await fixture(page);
  await page.goto('/cardapio?restaurante_id=2');
  const trigger = page.locator('#btn-login-trigger');
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
  const card = page.locator('#auth-modal-card');
  await page.getByRole('button', { name: 'Criar Conta', exact: true }).click();
  await capture(page, info, 'cadastro-cliente');
  await page.getByLabel('Nome completo', { exact: true }).fill('Cliente Local');
  await page.locator('#auth-register-form input[type=email]').fill('CLIENTE@KOMA.TEST');
  await page.getByLabel('Celular / WhatsApp (com DDD)', { exact: true }).fill('11999999999');
  await page.getByLabel('Criar senha', { exact: true }).fill('senha-local');
  await page.locator('#auth-register-form button[type=submit]').click();
  await expect(card).toContainText('Confira seu e-mail');
  expect(requests.at(-1)).toEqual({ path: '/cardapio/clientes/cadastro/solicitar', body: {
    restaurante_id: 2, nome: 'Cliente Local', email: 'cliente@koma.test', telefone: '11999999999', senha: 'senha-local', endereco: '',
  } });
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab');
    expect(await card.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await page.getByRole('button', { name: 'Continuar como visitante', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('cliente: 320px, nome longo e cadastro permitem rolar e fechar sem cortar campos', async ({ page }, info) => {
  await fixture(page, false, 'Restaurante Sabores da Vila e Cozinha Artesanal');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/cardapio?restaurante_id=2');
  await page.locator('#btn-login-trigger').click();
  const card = page.locator('#auth-modal-card');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => { document.documentElement.dataset.komaTheme = value; }, theme);
    await expect(card).toBeVisible();
    expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await capture(page, info, `320-${theme}-cliente`);
  }
  await page.getByRole('button', { name: 'Criar Conta', exact: true }).click();
  await page.locator('#auth-register-form button[type=submit]').focus();
  await expect(page.locator('#auth-register-form button[type=submit]')).toBeInViewport();
  expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.locator('#btn-login-trigger')).toBeFocused();
});


test('cliente: recuperação pendente não reaparece ao fechar e reabrir', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let attempts = 0;
  await page.route(`${API}/auth/password-recovery/request`, async route => {
    attempts++;
    await gate;
    await route.fulfill({ status: 202, json: { message: 'Resposta da solicitação anterior' } }).catch(() => {});
  });
  await page.goto('/cardapio?restaurante_id=2');
  await page.locator('#btn-login-trigger').click();
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail da conta', { exact: true }).fill('cliente@koma.test');
  await page.getByRole('button', { name: 'Enviar link de recuperação' }).click();
  await expect.poll(() => attempts).toBe(1);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.locator('#btn-login-trigger').click();
  release();
  await expect(page.getByText('Resposta da solicitação anterior')).toHaveCount(0);
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await expect(page.getByRole('button', { name: 'Enviar link de recuperação' })).toBeEnabled();
});
