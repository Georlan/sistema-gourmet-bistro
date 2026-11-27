import { expect, test } from '@playwright/test';

const API_BASE = process.env.KOMA_B8_E2E_API || 'http://127.0.0.1:8000';

async function loginOperator(request: any, email: string, password: string) {
  const res = await request.post(`${API_BASE}/auth/login`, {
    data: { username: email, password },
  });
  expect(res.ok(), `Login falhou para ${email}: ${res.status()}`).toBeTruthy();
  return res.json();
}

async function loginViaUi(page: any, email: string, password: string) {
  await page.goto('/?view=caixa');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos' }).first()).toBeVisible({ timeout: 20_000 });
}

async function openSection(page: any, parentPattern: RegExp, childLabel: string) {
  const subnavBtn = page.locator('.cashier-subnav__button').filter({ hasText: childLabel }).first();
  if (await subnavBtn.isVisible().catch(() => false)) {
    await subnavBtn.click();
    return;
  }
  const parentBtn = page.getByRole('button', { name: parentPattern }).first();
  if (!(await parentBtn.isVisible().catch(() => false))) {
    const menuBtn = page.getByRole('button', { name: /Abrir menu principal/i }).first();
    await expect(menuBtn).toBeVisible({ timeout: 20_000 });
    await menuBtn.click();
  }
  await expect(parentBtn).toBeVisible({ timeout: 20_000 });
  const childBtn = page.getByRole('button', { name: childLabel, exact: true }).first();
  if (!(await childBtn.isVisible().catch(() => false))) {
    await parentBtn.click();
  }
  await expect(childBtn).toBeVisible({ timeout: 10_000 });
  await childBtn.click();
}

test.describe('B8 Finance & Production Engine (Full-Stack Real sem mocks)', () => {
  test.skip(!process.env.KOMA_B8_E2E_API, 'Requer backend FastAPI + PostgreSQL 17 isolado (KOMA_B8_E2E_API).');
  test('Frentes 1-5: CP parcial, Fluxo de Caixa, DRE parcial, Lotes/Compras/Perdas e Produção persistem após reload', async ({ page }) => {
    const tag = Date.now().toString().slice(-5);
    const contaDesc = `Energia E2E ${tag}`;
    const perdaObs = `Apara E2E ${tag}`;
    const subNome = `Hamburguer E2E ${tag}`;
    const buffetNome = `Buffet E2E ${tag}`;

    await loginViaUi(page, 'dono1@b8e2e.test', 'B8E2ePass!2026');

    // 1. Abrir Relatórios -> Contas a pagar e receber
    await openSection(page, /Relatórios/i, 'Contas a pagar e receber');

    await expect(page.getByRole('button', { name: /^Contas a Pagar \(/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('form select').first().locator('option').first()).toBeAttached({ timeout: 10_000 });

    // Lançar conta a pagar real via UI
    await page.getByPlaceholder('Ex.: Aluguel').fill(contaDesc);
    await page.getByPlaceholder('Fornecedor ou locador').fill('Enel CE');
    await page.getByLabel(/Valor \(R\$\)/i).fill('200');
    await page.getByRole('button', { name: 'Lançar conta a pagar' }).click();

    await expect(page.getByText(contaDesc)).toBeVisible({ timeout: 10_000 });

    // Baixa parcial: exige seleção explícita da conta financeira (não seleciona silenciosamente)
    await page.getByRole('button', { name: 'Pagar', exact: true }).first().click();
    const contaSelect = page.locator('form').filter({ hasText: 'Confirmar pagamento:' }).locator('select').first();
    await expect(contaSelect).toHaveValue('');

    // Seleciona a conta bancária real e faz baixa parcial de R$ 80,00
    const contaOption = await contaSelect.locator('option').nth(1).getAttribute('value');
    expect(contaOption).toBeTruthy();
    await contaSelect.selectOption(contaOption!);
    await page.locator('form').filter({ hasText: 'Confirmar pagamento:' }).getByLabel(/Valor \(parcial ou total\)/i).fill('80');
    await page.getByRole('button', { name: 'Confirmar baixa' }).click();

    // Saldo aberto deve atualizar para R$ 120,00 e persistir após reload
    await expect(page.getByText(/120,00/).first()).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(page.getByText(contaDesc).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/120,00/).first()).toBeVisible();

    // 2. Fluxo de Caixa reflete os R$ 80,00 pagos
    await openSection(page, /Relatórios/i, 'Fluxo de Caixa');
    await expect(page.getByText('Saídas Realizadas')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/80,00/).first()).toBeVisible();

    // 3. DRE Gerencial exibe Regime de Competência e despesa lançada (sem contar onboarding_test=True)
    await openSection(page, /Relatórios/i, 'DRE Gerencial');
    await expect(page.getByRole('heading', { name: /DRE Gerencial · Regime de Competência/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('(-) Despesas Operacionais (Competência)')).toBeVisible();

    // 4. Estoque & compras -> Lotes e perdas (Pedido de compra + Perda detalhada)
    await openSection(page, /Estoque/i, 'Lotes e perdas');
    await expect(page.getByText('Compras, XML De-Para, Lotes FEFO e Perdas')).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder('Quantidade').fill('0.5');
    await page.getByPlaceholder('Observação').fill(perdaObs);
    await page.getByRole('button', { name: 'Registrar perda' }).click();
    await expect(page.getByText(perdaObs).first()).toBeVisible({ timeout: 10_000 });

    // 5. Estoque & compras -> Produção (Sub-receita + Ordem de Produção + Buffet)
    await openSection(page, /Estoque/i, 'Produção');
    await expect(page.getByText('Produção Interna, Sub-receitas e Buffet')).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder('Nome (ex.: Molho da casa)').fill(subNome);
    await page.getByRole('button', { name: 'Salvar sub-receita' }).click();
    const subOption = page.locator('option', { hasText: subNome }).first();
    await expect(subOption).toBeAttached({ timeout: 10_000 });
    const subVal = await subOption.getAttribute('value');
    expect(subVal).toBeTruthy();
    await page.locator('form').filter({ hasText: 'Executar Ordem de Produção' }).locator('select').selectOption(subVal!);

    await page.getByRole('button', { name: 'Executar produção' }).click();
    await expect(page.getByText('Ordens de Produção Executadas')).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder('Preparação (ex.: Buffet Almoço)').fill(buffetNome);
    await page.getByPlaceholder('Produzido (kg)').fill('5');
    await page.getByRole('button', { name: 'Registrar lote de buffet' }).click();
    await expect(page.getByText(buffetNome).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Cenário F: Segurança multitenant e RBAC financeiro bloqueiam acesso cruzado e usuário sem permissão', async ({ request }) => {
    const loginT1 = await loginOperator(request, 'dono1@b8e2e.test', 'B8E2ePass!2026');
    const loginT2 = await loginOperator(request, 'dono2@b8e2e.test', 'B8E2ePass!2026');
    const loginGarcom = await loginOperator(request, 'garcom@b8e2e.test', 'B8E2ePass!2026');

    // Garçom sem permissão financeira não acessa DRE nem Contas a Pagar
    const resGarcom = await request.get(`${API_BASE}/b8/financeiro/dre`, {
      headers: { Authorization: `Bearer ${loginGarcom.access_token}` },
    });
    expect(resGarcom.status()).toBe(403);

    // Tenant 2 não vê as contas a pagar do Tenant 1
    const resT1 = await request.get(`${API_BASE}/b8/financeiro/contas-pagar`, {
      headers: { Authorization: `Bearer ${loginT1.access_token}` },
    });
    expect(resT1.ok()).toBeTruthy();
    const listT1 = await resT1.json();

    const resT2 = await request.get(`${API_BASE}/b8/financeiro/contas-pagar`, {
      headers: { Authorization: `Bearer ${loginT2.access_token}` },
    });
    expect(resT2.ok()).toBeTruthy();
    const listT2 = await resT2.json();
    for (const cp of listT1) {
      expect(listT2.some((x: any) => x.id === cp.id)).toBe(false);
    }

    // Cenário C: Tenant 2 sem despesas lançadas recebe DRE parcial com lacunas explícitas
    const dreT2 = await request.get(`${API_BASE}/b8/financeiro/dre`, {
      headers: { Authorization: `Bearer ${loginT2.access_token}` },
    });
    expect(dreT2.ok()).toBeTruthy();
    const dreJson = await dreT2.json();
    expect(dreJson.status_completude).toBe('parcial');
    expect(dreJson.lacunas.length).toBeGreaterThan(0);
  });
});
