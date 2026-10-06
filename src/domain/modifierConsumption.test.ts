import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeModifierConsumption,
  arrangeOptions,
  summarizeModifierConsumption,
  formatShare,
  type ModifierConsumptionReport,
} from './modifierConsumption';

test('normalizeModifierConsumption safely handles empty, missing and invalid values', () => {
  const norm = normalizeModifierConsumption(null);
  assert.equal(norm.unidades_produto, 0);
  assert.equal(norm.total_selecoes, 0);
  assert.equal(norm.grupos.length, 0);
  assert.equal(norm.produtos.length, 0);
  assert.equal(norm.mix_por_produto.length, 0);
});

test('arrangeOptions sorts by mais, menos and todos with accents-insensitive search', () => {
  const options = [
    { opcao_id: '1', opcao_nome: 'Frango cozido', quantidade: 50, participacao_pct: 50, ativa: true, arquivada: false, opcao_origem_id: null, cadastrada: true },
    { opcao_id: '2', opcao_nome: 'Fígado acebolado', quantidade: 30, participacao_pct: 30, ativa: true, arquivada: false, opcao_origem_id: null, cadastrada: true },
    { opcao_id: '3', opcao_nome: 'Acém cozido', quantidade: 20, participacao_pct: 20, ativa: false, arquivada: false, opcao_origem_id: null, cadastrada: true },
    { opcao_id: '4', opcao_nome: 'Bife', quantidade: 0, participacao_pct: 0, ativa: true, arquivada: false, opcao_origem_id: null, cadastrada: true },
  ];

  const mais = arrangeOptions(options, 'mais');
  assert.equal(mais[0].opcao_id, '1');
  assert.equal(mais[3].opcao_id, '4');

  const menos = arrangeOptions(options, 'menos');
  assert.equal(menos[0].opcao_id, '4');
  assert.equal(menos[3].opcao_id, '1');

  // Search case/accent insensitive ("figado" matches "Fígado acebolado")
  const filtered = arrangeOptions(options, 'mais', 'figado');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].opcao_id, '2');
});

test('summarizeModifierConsumption calculates metrics correctly', () => {
  const report: ModifierConsumptionReport = {
    inicio: '2026-10-01',
    fim: '2026-10-02',
    fonte: 'itens',
    produto_id: null,
    produto_nome: null,
    unidades_produto: 100,
    total_selecoes: 80,
    selecoes_sem_cadastro: 0,
    produtos: [],
    mix_por_produto: [],
    mix_resumo: [],
    grupos: [
      {
        grupo_id: 'prot',
        grupo_nome: 'Proteínas',
        grupo_origem_id: null,
        arquivado: false,
        total_selecoes: 50,
        opcoes_com_saida: 2,
        opcoes_sem_saida: 1,
        opcoes: [
          { opcao_id: '1', opcao_nome: 'Frango', quantidade: 30, participacao_pct: 60, ativa: true, arquivada: false, opcao_origem_id: null, cadastrada: true },
          { opcao_id: '2', opcao_nome: 'Carne', quantidade: 20, participacao_pct: 40, ativa: true, arquivada: false, opcao_origem_id: null, cadastrada: true },
          { opcao_id: '3', opcao_nome: 'Peixe', quantidade: 0, participacao_pct: 0, ativa: true, arquivada: false, opcao_origem_id: null, cadastrada: true },
          { opcao_id: '4', opcao_nome: 'Porco', quantidade: 0, participacao_pct: 0, ativa: false, arquivada: false, opcao_origem_id: null, cadastrada: true }, // Pausada não conta como ativo sem saída
        ],
      },
      {
        grupo_id: 'sal',
        grupo_nome: 'Saladas',
        grupo_origem_id: null,
        arquivado: false,
        total_selecoes: 30,
        opcoes_com_saida: 1,
        opcoes_sem_saida: 0,
        opcoes: [
          { opcao_id: '5', opcao_nome: 'Vinagrete', quantidade: 30, participacao_pct: 100, ativa: true, arquivada: false, opcao_origem_id: null, cadastrada: true },
        ],
      },
    ],
  };

  const summary = summarizeModifierConsumption(report);
  assert.equal(summary.totalSelections, 80);
  assert.equal(summary.optionsWithOutput, 3);
  assert.equal(summary.topGroup?.name, 'Proteínas');
  assert.equal(summary.topGroup?.total, 50);
  assert.equal(summary.activeWithoutOutput, 1); // Only 'Peixe' (active=true, qty=0)
});

test('formatShare formats percentage and null representation', () => {
  assert.equal(formatShare(null), '—');
  assert.equal(formatShare(42.5), '42,5%');
  assert.equal(formatShare(0), '0,0%');
});

test('normalizeModifierConsumption preserves product_units, media_selecoes_por_unidade and mix_resumo', () => {
  const raw = {
    inicio: '2026-10-01',
    fim: '2026-10-02',
    fonte: 'itens',
    produto_id: 'qg',
    produto_nome: 'Quentinha G',
    unidades_produto: 100,
    total_selecoes: 200,
    selecoes_sem_cadastro: 0,
    produtos: [{ produto_id: 'qg', produto_nome: 'Quentinha G', unidades: 100, product_units: 100 }],
    grupos: [
      {
        grupo_id: 'guar',
        grupo_nome: 'Guarnições',
        total_selecoes: 200,
        media_selecoes_por_unidade: 2.0,
        opcoes_com_saida: 2,
        opcoes_sem_saida: 0,
        opcoes: [
          { opcao_id: 'arroz', opcao_nome: 'Arroz', quantidade: 120, participacao_pct: 60.0 },
          { opcao_id: 'feijao', opcao_nome: 'Feijão', quantidade: 80, participacao_pct: 40.0 },
        ],
      },
    ],
    mix_por_produto: [
      {
        produto_id: 'qg',
        grupo_id: 'guar',
        opcao_id: 'arroz',
        quantidade: 120,
        product_units: 100,
        group_total_selections: 200,
        avg_selections_per_product_unit: 2.0,
      },
    ],
    mix_resumo: [
      {
        produto_id: 'qg',
        grupo_id: 'guar',
        product_units: 100,
        group_total_selections: 200,
        avg_selections_per_product_unit: 2.0,
      },
    ],
  };

  const norm = normalizeModifierConsumption(raw);
  assert.equal(norm.produtos[0].product_units, 100);
  assert.equal(norm.grupos[0].media_selecoes_por_unidade, 2.0);
  assert.equal(norm.mix_por_produto[0].product_units, 100);
  assert.equal(norm.mix_por_produto[0].group_total_selections, 200);
  assert.equal(norm.mix_por_produto[0].avg_selections_per_product_unit, 2.0);
  assert.equal(norm.mix_resumo[0].group_total_selections, 200);
  assert.equal(norm.mix_resumo[0].avg_selections_per_product_unit, 2.0);
});

