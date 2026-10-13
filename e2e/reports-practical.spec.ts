import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('reports preserve explicit civil interval across tabs and reload', async ({ page }, info) => {
  test.skip(!['mobile-390', 'desktop-1366'].includes(info.project.name));
  await mockCashierBackend(page);
  await page.route('**/relatorios/visao-geral?*', async route => {
    const url = new URL(route.request().url());
    const rows = [
      { data: '2026-10-02', total: 514, bruto: 514, estornos: 0, quantidade_pedidos: 27 },
      { data: '2026-10-03', total: 657, bruto: 657, estornos: 0, quantidade_pedidos: 29 },
      { data: '2026-10-04', total: 603, bruto: 603, estornos: 0, quantidade_pedidos: 21 },
    ].filter(row => row.data >= url.searchParams.get('data_inicio')! && row.data <= url.searchParams.get('data_fim')!);
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const accounts = rows.reduce((sum, row) => sum + row.quantidade_pedidos, 0);
    await route.fulfill({ json: { faturamento_total: total, vendas_brutas: total, estornos: 0,
      total_pedidos: accounts, ticket_medio: accounts ? total / accounts : 0, clientes_ativos: 72,
      meta_mensal: 0, vendas_por_dia: rows,
      entrada_pedidos_por_hora: rows.length ? [{ hora: '11h', total_pedidos: 26 }] : [],
      horarios_pico: rows.length ? [{ hora: '15h', total_pedidos: 29, faturamento: 749 }] : [],
      comparativo_anterior: { tem_base_anterior: false } } });
  });
  await page.route('**/relatorios/inteligencia-cardapio?*', route => route.fulfill({ json: { inicio_anterior: '2026-09-29', fim_anterior: '2026-10-01', unidades: 0, produtos: [] } }));
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'relatorios');
    sessionStorage.setItem('koma_active_subtab', 'visao_geral');
  });
  const reportRequests: string[] = [];
  page.on('request', request => { if (request.method() === 'GET' && request.url().includes('/relatorios/visao-geral?')) reportRequests.push(request.url()); });
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: /Alterar período:/ }).click();
  await page.getByLabel('Data Início:').fill('2026-10-02');
  await page.getByLabel('Data Fim:').fill('2026-10-04');
  await page.getByRole('button', { name: /Aplicar/ }).click();
  await expect(page.getByRole('button', { name: 'Alterar período: 02/10/2026 — 04/10/2026' })).toBeVisible();
  await expect(page.getByText('Pico de movimento às 11h', { exact: true })).toBeVisible();
  await expect(page.getByText('Pico de movimento às 15h', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Contas', exact: true }).click();
  for (const tab of ['Recebimentos', 'Vendas por produto', 'Inteligência do Cardápio', 'Desempenho da equipe', 'Visão geral']) {
    await page.getByRole('button', { name: tab, exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Alterar período: 02/10/2026 — 04/10/2026' })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole('button', { name: 'Alterar período: 02/10/2026 — 04/10/2026' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar', exact: true })).toBeEnabled();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  for (const label of ['Hoje', 'Ontem', 'Últimos 7 dias', 'Últimos 15 dias', 'Últimos 30 dias']) {
    await page.getByRole('button', { name: /Alterar período:/ }).click();
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Alterar período:/ })).toBeVisible();
  }
  expect(reportRequests.length).toBeLessThanOrEqual(9);
  await expect(page.getByRole('button', { name: 'Exportar', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /Alterar período:/ }).scrollIntoViewIfNeeded();
  if (process.env.KOMA_REPORT_SCREENSHOTS) {
    await mkdir(process.env.KOMA_REPORT_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: `${process.env.KOMA_REPORT_SCREENSHOTS}/relatorios-${info.project.name}.png`, fullPage: true });
  }

});


test('menu decisions show unknown costs and filter active products without output', async ({ page }, info) => {
  test.skip(!['mobile-390', 'desktop-1366'].includes(info.project.name));
  await mockCashierBackend(page);
  await page.route('**/relatorios/inteligencia-cardapio?*', route => route.fulfill({ json: {
    inicio_anterior: '2026-09-29', fim_anterior: '2026-10-01', unidades: 3,
    produtos: [
      { produto_id: 'acerola', nome: 'Suco de acerola', categoria: 'Bebidas', ativo: true, unidades: 3, unidades_anteriores: 6, variacao_pct: -50, participacao_pct: 100, preco_medio: 7, preco_cardapio: 7, custo_unitario: null, margem_unitaria_cardapio: null, margem_pct_cardapio: null, sugestoes: [{ tipo: 'sem_custo', titulo: 'Completar os custos', motivo: 'Ficha técnica incompleta.' }] },
      { produto_id: 'manga', nome: 'Suco de manga', categoria: 'Bebidas', ativo: true, unidades: 0, unidades_anteriores: 0, variacao_pct: null, participacao_pct: 0, preco_medio: null, preco_cardapio: 7, custo_unitario: 8, margem_unitaria_cardapio: -1, margem_pct_cardapio: -14.3, sugestoes: [{ tipo: 'sem_saida', titulo: 'Verificar disponibilidade e destaque', motivo: 'Confira disponibilidade antes de retirar.' }, { tipo: 'rever_preco', titulo: 'Revisar preço ou custos', motivo: 'Preço abaixo do custo.' }] },
    ],
  } }));
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await seedCashierSession(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'relatorios');
    sessionStorage.setItem('koma_active_subtab', 'gestao_cardapio');
    sessionStorage.setItem('koma_reports_period', JSON.stringify({ inicio: '2026-10-02', fim: '2026-10-04' }));
  });
  await page.goto('/?view=caixa');
  await expect(page.getByText('Suco de acerola', { exact: true })).toBeVisible();
  await expect(page.getByText('Completar os custos', { exact: true })).toBeVisible();
  await expect(page.getByText('Não calculado', { exact: false }).first()).toBeVisible();
  await page.getByLabel('Filtrar atenção do cardápio').selectOption('sem_saida');
  await expect(page.getByText('Suco de acerola', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Suco de manga', { exact: true })).toBeVisible();
  await expect(page.getByText('Sem base anterior', { exact: false })).toBeVisible();
  await page.getByLabel('Filtrar atenção do cardápio').selectOption('todos');
  await page.getByLabel('Buscar produto no desempenho').fill('acerola');
  await expect(page.getByText('Suco de manga', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Alterar período: 02/10/2026 — 04/10/2026' })).toBeVisible();
  await page.getByLabel('Buscar produto no desempenho').fill('');
  if (process.env.KOMA_REPORT_SCREENSHOTS) {
    await mkdir(process.env.KOMA_REPORT_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: `${process.env.KOMA_REPORT_SCREENSHOTS}/cardapio-${info.project.name}.png`, fullPage: true });
  }
});

const intelligenceFixture = {
  schema_version: 2, inicio: '2026-10-01', fim: '2026-10-30', inicio_anterior: '2026-09-01', fim_anterior: '2026-09-30',
  metodo_version: 'menu-base-current-cost-v1', unidades: 102,
  resumo: { valor_itens: 850, valor_itens_anterior: 750, unidades_anteriores: 90, unidades_cobertas: 102,
    unidades_anteriores_cobertas: 90, cobertura_custo_pct: 100, custo_total_estimado: 102,
    contribuicao_estimada: 748, contribuicao_anterior_estimada: 660, cmv_pct_estimado: 12 },
  categorias: [{ categoria_id: 'drinks', nome: 'Bebidas', produtos_comparaveis: 3, unidades: 102, pedidos_distintos: 80,
    unidades_cobertas: 102, cobertura_custo_pct: 100, contribuicao_estimada: 748,
    limite_popularidade_pct: 70 / 3, limite_margem_unitaria: 748 / 102, triagem_disponivel: true, cobertura_completa: true }],
  produtos: [
    { produto_id: 'juice', nome: 'Suco de Maracujá', categoria: 'Bebidas', categoria_id: 'drinks', ativo: true, unidades: 59,
      unidades_anteriores: 49, variacao_pct: 20.4, participacao_pct: 57.8, valor_consumo: 590, preco_medio: 10,
      preco_cardapio: 10, custo_unitario: 1, margem_unitaria_cardapio: 9, margem_pct_cardapio: 90, sugestoes: [],
      unidades_cobertas: 59, valor_coberto: 590, custo_total_estimado: 59, cobertura_custo_pct: 100,
      contribuicao_estimada: 531, contribuicao_anterior_estimada: 441, cmv_pct_estimado: 10, margem_unitaria_observada: 9,
      classificacao: 'estrela', participacao_categoria_pct: 59 / 102 * 100, motivo_classificacao: 'Alta popularidade e margem na categoria; custo atual.' },
    { produto_id: 'special', nome: 'Suco Especial', categoria: 'Bebidas', categoria_id: 'drinks', ativo: true, unidades: 3,
      unidades_anteriores: 1, variacao_pct: 200, participacao_pct: 2.9, valor_consumo: 60, preco_medio: 20,
      preco_cardapio: 20, custo_unitario: 1, margem_unitaria_cardapio: 19, margem_pct_cardapio: 95, sugestoes: [],
      unidades_cobertas: 3, valor_coberto: 60, custo_total_estimado: 3, cobertura_custo_pct: 100,
      contribuicao_estimada: 57, cmv_pct_estimado: 5, margem_unitaria_observada: 19,
      classificacao: 'enigma', participacao_categoria_pct: 3 / 102 * 100 },
    { produto_id: 'water', nome: 'Água Mineral', categoria: 'Bebidas', categoria_id: 'drinks', ativo: true, unidades: 40,
      unidades_anteriores: 40, variacao_pct: 0, participacao_pct: 39.2, valor_consumo: 200, preco_medio: 5,
      preco_cardapio: 5, custo_unitario: 1, margem_unitaria_cardapio: 4, margem_pct_cardapio: 80, sugestoes: [],
      unidades_cobertas: 40, valor_coberto: 200, custo_total_estimado: 40, cobertura_custo_pct: 100,
      contribuicao_estimada: 160, cmv_pct_estimado: 20, margem_unitaria_observada: 4,
      classificacao: 'cavalo_batalha', participacao_categoria_pct: 40 / 102 * 100 },
  ],
  oportunidades: [{ produto_id: 'juice', produto_nome: 'Suco de Maracujá', tipo: 'acompanhamento',
    titulo: 'Investigar venda adicional sem desconto', motivo: 'Demanda consistente da base. A inclusão de acompanhamentos ainda não foi medida.',
    unidades: 59, unidades_anteriores: 49, contribuicao_estimada: 531, cobertura_custo_pct: 100 }],
};

test('intelligence has four shared-read tabs, category matrix, explainable opportunities and reversible price simulation', async ({ page }, info) => {
  test.skip(!['mobile-390', 'desktop-1366'].includes(info.project.name));
  await mockCashierBackend(page); await seedCashierSession(page);
  let reads = 0, calculations = 0;
  await page.route('**/relatorios/inteligencia-cardapio?*', route => { reads++; return route.fulfill({ json: intelligenceFixture }); });
  await page.route('**/relatorios/inteligencia-cardapio/simulacoes', async route => {
    calculations++;
    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({ preco_atual: '10.00', custo_atual: '1.00', preco_proposto: '11.00', quantidade_atual: 59, quantidades: [54, 59, 65] });
    await route.fulfill({ json: { margem_atual: 9, margem_proposta: 10, contribuicao_referencia: 531,
      unidades_para_preservar: 54, unidades_para_superar: 54, vendas_que_pode_perder: 5, vendas_adicionais_necessarias: 0,
      cenarios: [{ quantidade: 54, contribuicao: 540, diferenca: 9 }, { quantidade: 59, contribuicao: 590, diferenca: 59 }, { quantidade: 65, contribuicao: 650, diferenca: 119 }],
      avisos: ['Custos e volumes são hipóteses; não é previsão nem lucro garantido.'] } });
  });
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.addInitScript(() => {
    sessionStorage.setItem('koma_active_tab', 'relatorios'); sessionStorage.setItem('koma_active_subtab', 'gestao_cardapio');
    sessionStorage.setItem('koma_reports_period', JSON.stringify({ inicio: '2026-10-01', fim: '2026-10-30' }));
  });
  await page.goto('/?view=caixa');
  await expect(page.getByRole('heading', { name: 'Inteligência do Cardápio' })).toBeVisible();
  await expect(page.getByText('Contribuição não é lucro.', { exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toContainText('R$ 748,00');
  const settledReads = reads;
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar análise' }).click();
  expect((await exported).suggestedFilename()).toMatch(/inteligencia_cardapio_2026-10-01_2026-10-30\.csv/);
  await page.getByRole('tab', { name: 'Matriz de Cardápio' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('80 pedidos distintos');
  await page.getByRole('tabpanel').getByRole('button', { name: /Suco de Maracujá/ }).click();
  await expect(page.getByRole('dialog', { name: 'Suco de Maracujá' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Oportunidades' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('sem desconto');
  await expect(page.getByRole('tabpanel')).toContainText('ainda não foram medidas');
  await page.getByRole('button', { name: 'Simular estratégia' }).click();
  await expect(page.getByLabel('Preço de referência (R$)')).toHaveValue('10.00');
  await page.getByLabel('Preço proposto (R$)').fill('11');
  await page.getByLabel('Cenário conservador (unidades)').fill('54');
  await page.getByLabel('Cenário otimista (unidades)').fill('65');
  await page.getByRole('button', { name: 'Calcular cenários' }).click();
  await expect(page.getByRole('region', { name: 'Resultado da simulação' })).toContainText('54');
  await expect(page.getByRole('region', { name: 'Resultado da simulação' })).toContainText('Pode perder até 5 vendas inteiras');
  expect(calculations).toBe(1); expect(reads).toBe(settledReads);
  // Changed inputs must not leave an earlier financial result on screen.
  await page.getByLabel('Custo proposto (R$)').fill('1.123');
  await expect(page.getByRole('region', { name: 'Resultado da simulação' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Calcular cenários' }).click();
  await expect(page.getByRole('alert')).toContainText('duas casas decimais');
  expect(calculations).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.KOMA_REPORT_SCREENSHOTS) {
    await mkdir(process.env.KOMA_REPORT_SCREENSHOTS, { recursive: true });
    for (const tab of ['Diagnóstico', 'Matriz de Cardápio', 'Oportunidades', 'Simulador']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      if (tab === 'Matriz de Cardápio' && info.project.name === 'desktop-1366') await page.getByRole('tabpanel').locator('figure').screenshot({ path: `${process.env.KOMA_REPORT_SCREENSHOTS}/matriz-grafico-desktop.png` });
      await page.screenshot({ path: `${process.env.KOMA_REPORT_SCREENSHOTS}/inteligencia-${tab.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '-')}-${info.project.name}.png`, fullPage: true });
    }
  }
});
