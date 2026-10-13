import { expect, test, type Page, type Route } from '@playwright/test';

const profile = (scope: string) => ({
  id: 1, status: 'draft', enabled: false, countryCode: 'BR', uf: 'CE',
  documentModel: '65', environment: 'homologacao', series: 1,
  razaoSocial: `Restaurante simulado ${scope}`, cnpj: '', crt: '',
  certificateConfigured: false, cscConfigured: false,
});
const preflight = (scope: string, ready = false) => ({
  ready, mode: 'foundation', profileReady: ready, referencesReady: ready,
  issues: ready ? [] : [{ code: `pending-${scope}`, message: `Pendência simulada ${scope}`, severity: 'blocking' }],
  warnings: [], references: [], complianceBaseline: [],
});

type FixtureOptions = {
  profileResponse?: (route: Route, scope: string) => Promise<boolean>;
  preflightResponse?: (route: Route, scope: string, count: number) => Promise<boolean>;
};
async function fixture(page: Page, options: FixtureOptions = {}) {
  const reads: Record<string, number> = {};
  const checks: Record<string, number> = {};
  const writes: string[] = [];
  await page.route('**/fiscal-fixture-api-*/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const scope = url.pathname.startsWith('/fiscal-fixture-api-b/') ? 'C'
      : request.headers().authorization === 'Bearer synthetic-session-b' ? 'B' : 'A';
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 409, json: { detail: 'Synthetic fixture never writes.' } });
      return;
    }
    if (url.pathname.endsWith('/fiscal/profile')) {
      reads[scope] = (reads[scope] || 0) + 1;
      if (await options.profileResponse?.(route, scope)) return;
      await route.fulfill({ json: profile(scope) });
    } else if (url.pathname.endsWith('/fiscal/preflight')) {
      checks[scope] = (checks[scope] || 0) + 1;
      if (await options.preflightResponse?.(route, scope, checks[scope])) return;
      await route.fulfill({ json: preflight(scope) });
    } else {
      await route.fulfill({ json: url.pathname.endsWith('/fiscal/municipalities') ? { items: [] } : {} });
    }
  });
  await page.goto('/e2e/fixtures/fiscal-session.html');
  return { reads, checks, writes };
}

async function fillDraftAndSecrets(page: Page) {
  await page.getByLabel('Razão social', { exact: true }).fill('Rascunho exclusivo da sessão A');
  await selectGuidedStep(page, /Certificado e segurança/);
  await certificateInput(page).setInputFiles({
    name: 'synthetic-only.pfx', mimeType: 'application/x-pkcs12', buffer: Buffer.from('synthetic-not-a-certificate'),
  });
  await certificatePassword(page).fill('synthetic-secret-a');
  await cscIdentifier(page).fill('123456');
  await cscSecret(page).fill('synthetic-csc-a');
}

const certificateInput = (page: Page) => page.getByLabel(/^(Arquivo A1|Certificado A1) \(\.pfx \/ \.p12\)$/);
const certificatePassword = (page: Page) => page.getByLabel(/^(Senha do A1|Senha do certificado \(se houver\))$/);
const cscIdentifier = (page: Page) => page.getByLabel(/^(ID do CSC|Identificador do CSC)$/);
const cscSecret = (page: Page) => page.getByLabel(/^(CSC|Código de segurança \(CSC\))$/);

async function selectGuidedStep(page: Page, name: RegExp) {
  const navigation = page.getByRole('navigation', { name: 'Etapas da configuração fiscal' });
  if (await navigation.count()) await navigation.getByRole('button', { name }).click();
}

async function expectFreshScope(page: Page, scope: string) {
  await expect(page.getByLabel('Razão social', { exact: true })).toHaveValue(`Restaurante simulado ${scope}`);
  await selectGuidedStep(page, /Certificado e segurança/);
  await expect(certificatePassword(page)).toHaveValue('');
  await expect(cscIdentifier(page)).toHaveValue('');
  await expect(cscSecret(page)).toHaveValue('');
  expect(await certificateInput(page).evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
  await selectGuidedStep(page, /Conferência/);
  await expect(page.getByText(`Pendência simulada ${scope}`, { exact: true })).toBeVisible();
  await selectGuidedStep(page, /Dados da empresa/);
}

test('new credentials discard the previous fiscal draft, file, password and CSC without writing', async ({ page }) => {
  const { writes } = await fixture(page);
  await expectFreshScope(page, 'A');
  await fillDraftAndSecrets(page);
  await page.getByRole('button', { name: 'Trocar sessão simulada' }).click();
  await expectFreshScope(page, 'B');
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))).not.toContain('synthetic-secret-a');
  expect(await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))).not.toContain('synthetic-csc-a');
});

test('equivalent header values preserve the draft and secrets without another bootstrap', async ({ page }) => {
  const { reads, writes } = await fixture(page);
  await expectFreshScope(page, 'A');
  await fillDraftAndSecrets(page);
  await page.getByRole('button', { name: 'Recriar headers equivalentes' }).click();
  await expect(page.getByLabel('Razão social', { exact: true })).toHaveValue('Rascunho exclusivo da sessão A');
  await expect(certificatePassword(page)).toHaveValue('synthetic-secret-a');
  await expect(cscSecret(page)).toHaveValue('synthetic-csc-a');
  expect(await certificateInput(page).evaluate((input: HTMLInputElement) => input.files?.length)).toBe(1);
  expect(reads.A).toBe(1);
  expect(writes).toEqual([]);
});

test('changing API scope clears fiscal data even with the same credentials', async ({ page }) => {
  const { writes } = await fixture(page);
  await expectFreshScope(page, 'A');
  await fillDraftAndSecrets(page);
  await page.getByRole('button', { name: 'Trocar API simulada' }).click();
  await expectFreshScope(page, 'C');
  expect(writes).toEqual([]);
});

test('late bootstrap from the old session cannot replace the new restaurant', async ({ page }) => {
  let held: Route | undefined;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const { writes } = await fixture(page, { profileResponse: async (route, scope) => {
    if (scope !== 'A') return false;
    held = route;
    await pending;
    await route.fulfill({ json: profile('A') });
    return true;
  } });
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.getByRole('button', { name: 'Trocar sessão simulada' }).click();
  await expectFreshScope(page, 'B');
  const completed = page.waitForResponse(response => response.url().endsWith('/fiscal/profile') && response.request().headers().authorization === 'Bearer synthetic-session-a');
  release();
  await completed;
  await expectFreshScope(page, 'B');
  expect(writes).toEqual([]);
});

test('late green preflight from the old session cannot approve the current session', async ({ page }) => {
  let held: Route | undefined;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const { writes } = await fixture(page, { preflightResponse: async (route, scope, count) => {
    if (scope !== 'A' || count !== 2) return false;
    held = route;
    await pending;
    await route.fulfill({ json: preflight('A', true) });
    return true;
  } });
  await expectFreshScope(page, 'A');
  await selectGuidedStep(page, /Conferência/);
  await page.getByRole('button', { name: /^(Revalidar agora|Conferir novamente)$/ }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.getByRole('button', { name: 'Trocar sessão simulada' }).click();
  await expectFreshScope(page, 'B');
  const completed = page.waitForResponse(response => response.url().includes('/fiscal/preflight') && response.request().headers().authorization === 'Bearer synthetic-session-a');
  release();
  await completed;
  await expectFreshScope(page, 'B');
  await expect(page.getByText('Preflight verde', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Conferência concluída', { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('a failed new session load never falls back to the previous company or secrets', async ({ page }) => {
  const { writes } = await fixture(page, { profileResponse: async (route, scope) => {
    if (scope !== 'B') return false;
    await route.fulfill({ status: 503, json: { detail: 'Perfil simulado indisponível' } });
    return true;
  } });
  await expectFreshScope(page, 'A');
  await fillDraftAndSecrets(page);
  await page.getByRole('button', { name: 'Trocar sessão simulada' }).click();
  await expect(page.getByText('Perfil simulado indisponível', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Razão social', { exact: true })).toHaveValue('');
  await selectGuidedStep(page, /Certificado e segurança/);
  await expect(certificatePassword(page)).toHaveValue('');
  await expect(cscSecret(page)).toHaveValue('');
  expect(writes).toEqual([]);
});
