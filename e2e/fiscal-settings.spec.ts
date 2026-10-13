import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

const savedProfile = {
  id: 99001, status: 'draft', enabled: false, environment: 'homologacao', series: 1,
  cnpj: '11222333000181', inscricaoEstadual: '123456789', razaoSocial: 'Restaurante de teste',
  crt: '1', cnaePrincipal: '5611201', municipioCodigoIbge: '2304400',
  enderecoFiscal: { cep: '60000000', logradouro: 'Rua de teste', numero: '10', bairro: 'Centro' },
  certificateConfigured: false, cscConfigured: false,
};
const pendingCheck = {
  ready: false, mode: 'foundation', profileReady: false, referencesReady: false,
  issues: [{ code: 'missing_profile', message: 'Perfil fiscal ainda não foi configurado.', severity: 'blocking' }],
  warnings: [], references: [], complianceBaseline: [],
};

async function openFiscal(page: Page, profile: object = { status: 'draft', enabled: false }) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.route('**/api/onboarding/fiscal/profile', route => route.fulfill({ json: profile }));
  await page.route('**/api/onboarding/fiscal/municipalities?*', route => route.fulfill({ json: {
    items: [{ code: '2304400', name: 'Fortaleza', uf: 'CE' }],
  } }));
  await page.route('**/api/onboarding/fiscal/preflight?*', route => route.fulfill({ json: pendingCheck }));
  await page.goto('/?view=caixa&pagbank=cancelled');
  await page.locator('.cashier-subnav').getByRole('button', { name: 'Fiscal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Configuração fiscal', exact: true })).toBeVisible();
}

test('etapas preservam rascunho, explicam pré-requisitos e não alteram estado fiscal', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/onboarding/fiscal/') && request.method() !== 'GET') writes.push(request.url());
  });
  await openFiscal(page);
  await expect(page.getByRole('combobox', { name: 'Regime tributário (CRT)', exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Município fiscal', exact: true })).toHaveValue('');
  await page.getByLabel('Razão social', { exact: true }).fill('Rascunho preservado');
  await page.getByRole('button', { name: /Certificado e segurança/ }).click();
  await expect(page.getByText('Salve os dados da empresa na etapa 1 antes de enviar o certificado.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar e conferir' })).toBeDisabled();
  await page.getByRole('button', { name: /3 Conferência/ }).click();
  await expect(page.getByText('Há pendências na configuração', { exact: true })).toBeVisible();
  await expect(page.getByText('missing_profile', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Conferir e habilitar configuração' })).toBeHidden();
  await page.getByRole('button', { name: /Dados da empresa/ }).click();
  await expect(page.getByRole('button', { name: /Dados da empresa/ })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('heading', { name: 'Dados da empresa', exact: true })).toBeVisible();
  await expect(page.getByLabel('Razão social', { exact: true })).toHaveValue('Rascunho preservado');
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#fiscal-step-profile').evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) parent.scrollTop = 0;
  });
  await page.screenshot({ path: test.info().outputPath('fiscal-dados.png'), fullPage: true });
});

test('salvar cadastro e credenciais avança as etapas e limpa segredos locais', async ({ page }) => {
  await openFiscal(page);
  let profileWrites = 0;
  await page.route('**/api/onboarding/fiscal/profile', async route => {
    expect(route.request().method()).toBe('PUT');
    const body = route.request().postDataJSON();
    expect(body.crt).toBe('1');
    expect(body.municipio_codigo_ibge).toBe('2304400');
    expect(body.environment).toBe('homologacao');
    profileWrites++;
    await route.fulfill({ json: savedProfile });
  });
  for (const [label, value] of [
    ['CNPJ', savedProfile.cnpj], ['Inscrição estadual (IE / CGF)', savedProfile.inscricaoEstadual],
    ['Razão social', savedProfile.razaoSocial], ['CNAE principal', savedProfile.cnaePrincipal],
    ['CEP', '60000000'], ['Rua ou avenida', 'Rua de teste'], ['Número', '10'], ['Bairro', 'Centro'],
  ]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('combobox', { name: 'Regime tributário (CRT)', exact: true }).selectOption('1');
  await page.getByRole('combobox', { name: 'Município fiscal', exact: true }).selectOption('2304400');
  await page.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Certificado e código de segurança' })).toBeVisible();
  expect(profileWrites).toBe(1);
  await page.screenshot({ path: test.info().outputPath('fiscal-certificado.png'), fullPage: true });
  let credentialWrites = 0;
  await page.route('**/api/onboarding/fiscal/credentials', async route => {
    expect(route.request().method()).toBe('PUT');
    expect(route.request().postDataJSON().certificate_pfx_base64).toBeTruthy();
    credentialWrites++;
    await route.fulfill({ json: { ...savedProfile, certificateConfigured: true, cscConfigured: true } });
  });
  await page.getByLabel('Certificado A1 (.pfx / .p12)', { exact: true }).setInputFiles({
    name: 'local-only-test.pfx', mimeType: 'application/x-pkcs12', buffer: Buffer.from('local-only-non-certificate-fixture'),
  });
  await page.getByLabel('Senha do certificado (se houver)', { exact: true }).fill('local-only-test-password');
  await page.getByLabel('Identificador do CSC', { exact: true }).fill('000001');
  await page.getByLabel('Código de segurança (CSC)', { exact: true }).fill('local-only-test-csc');
  await page.getByRole('button', { name: 'Salvar e conferir' }).click();
  await expect(page.getByRole('heading', { name: 'Conferir configuração' })).toBeVisible();
  expect(credentialWrites).toBe(1);
  await page.screenshot({ path: test.info().outputPath('fiscal-conferencia.png'), fullPage: true });
  await page.getByRole('button', { name: /Certificado e segurança/ }).click();
  await expect(page.getByLabel('Senha do certificado (se houver)', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Código de segurança (CSC)', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Identificador do CSC', { exact: true })).toHaveValue('');
  expect(await page.getByLabel('Certificado A1 (.pfx / .p12)', { exact: true }).evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
  expect(await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].some(value => value.includes('local-only-test-password') || value.includes('local-only-test-csc')))).toBe(false);
});

test('falha de reconferência não mantém resultado verde anterior', async ({ page }) => {
  await openFiscal(page, { ...savedProfile, certificateConfigured: true, cscConfigured: true });
  await page.route('**/api/onboarding/fiscal/preflight?*', route => route.fulfill({ json: {
    ...pendingCheck, ready: true, profileReady: true, referencesReady: true, issues: [],
  } }));
  await page.getByRole('button', { name: 'Conferir novamente' }).click();
  await expect(page.getByText('Conferência concluída', { exact: true })).toBeVisible();
  await page.route('**/api/onboarding/fiscal/preflight?*', route => route.fulfill({ status: 503, json: { detail: 'Verificação temporariamente indisponível.' } }));
  await page.getByRole('button', { name: 'Conferir novamente' }).click();
  await expect(page.getByRole('alert')).toContainText('Verificação temporariamente indisponível.');
  await expect(page.getByText('Conferência concluída', { exact: true })).toHaveCount(0);
});

test('resumo orienta a próxima etapa e certificado salvo só muda por ação explícita', async ({ page }) => {
  let writes = 0;
  page.on('request', request => { if (request.url().includes('/onboarding/fiscal/') && request.method() !== 'GET') writes++; });
  await openFiscal(page, {
    ...savedProfile, certificateConfigured: true, cscConfigured: true,
    certificateExpiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
  });
  await expect(page.getByRole('region', { name: 'Resumo fiscal do restaurante' })).toContainText('Restaurante de teste');
  await expect(page.getByRole('button', { name: 'Revisar pendências', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Certificado e segurança/ }).click();
  await expect(page.getByText('Credenciais já armazenadas', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Certificado A1 (.pfx / .p12)', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Substituir certificado e CSC' }).click();
  await expect(page.getByLabel('Certificado A1 (.pfx / .p12)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Código de segurança (CSC)', { exact: true })).toHaveValue('');
  expect(writes).toBe(0);
  await page.getByText('Como vamos chegar à emissão de notas', { exact: true }).click();
  await expect(page.getByText('Já emite notas em outro sistema?', { exact: true })).toBeVisible();
});

test('certificado vencido é pendência mesmo quando as credenciais estão armazenadas', async ({ page }) => {
  await openFiscal(page, {
    ...savedProfile, certificateConfigured: true, cscConfigured: true, certificateExpiresAt: '2000-01-01T00:00:00Z',
  });
  await expect(page.getByRole('region', { name: 'Resumo fiscal do restaurante' })).toContainText('Vencido — precisa atualizar');
  await expect(page.getByText('Atualize o certificado vencido', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conferir credenciais', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Certificado e código de segurança' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('fiscal-resumo.png'), fullPage: true });
});
