import type { Page } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8000';
const DESKTOP_BREAKPOINT = 769;

const tables = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  capacidade: 4,
  nome: `Mesa ${index + 1}`,
}));

// Mantém uma mesa livre para cobrir visualmente os dois estados do salão.
const commands = tables.slice(0, -1).map((table, index) => ({
  id: `cmd-e2e-${table.id}`,
  restaurante_id: 99001,
  mesa_id: table.id,
  garcom_id: 'caixa-e2e',
  garcom_nome: 'Caixa E2E',
  tipo: 'Consumo no Local',
  numero_pedido: 700 + index,
  fechada: false,
  valor_pago: 0,
  criado_em: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
  itens: [
    {
      id: `item-e2e-${table.id}`,
      produto_id: 'produto-e2e',
      preco_unit: 18.5,
      observacao: '',
      cliente_nome: 'Consumo Geral',
      status: 'preparando',
      pago: false,
    },
    ...(index === 0 ? [{
      id: `item-ready-e2e-${table.id}`,
      produto_id: 'produto-pronto-e2e',
      preco_unit: 12,
      observacao: '',
      cliente_nome: 'Consumo Geral',
      status: 'pronto',
      pago: false,
    }] : []),
  ],
}));

const cashierConfig = {
  taxa_servico_ativa: true,
  taxa_servico_padrao: 10,
  unificar_vias_delivery: false,
  perm_garcom_delivery: true,
  perm_garcom_editar: true,
  perm_garcom_taxas: true,
  perm_garcom_cancelar: true,
  perm_garcom_status: true,
  perm_garcom_abrir_vazia: true,
  perm_garcom_print: true,
  perm_garcom_fechar: true,
  perm_garcom_desconto: true,
  perm_garcom_acrescimo: true,
  perm_garcom_pessoas: true,
  perm_garcom_transferir_mesa: true,
  perm_garcom_transferir_item: true,
  perm_garcom_chamar: true,
  perm_garcom_ociosas: true,
};

const openShift = {
  id: 501,
  aberto_por_id: 'caixa-e2e',
  aberto_em: new Date().toISOString(),
  saldo_inicial: 100,
  status: 'aberto',
  movimentacoes: [],
  pagamentos: [],
};

const teamMembers = [
  {
    id: 'admin-e2e',
    restaurante_id: 99001,
    nome: 'Administradora E2E',
    usuario: 'admin@koma.test',
    telefone: '85999990001',
    role: 'admin',
    cargo: 'admin',
    status: 'ativo',
  },
  {
    id: 'garcom-e2e',
    restaurante_id: 99001,
    nome: 'Garçom E2E',
    usuario: 'garcom@koma.test',
    telefone: '85999990002',
    role: 'garcom',
    cargo: 'garcom',
    status: 'ativo',
  },
  {
    id: 'convite-e2e',
    restaurante_id: 99001,
    nome: 'Convite E2E',
    telefone: '85999990003',
    role: 'caixa',
    cargo: 'caixa',
    status: 'pendente_ativacao',
    convite_agendado: true,
  },
];

async function mockCashierBackend(page: Page) {
  await page.route(`${API_ORIGIN}/**`, async route => {
    const { pathname } = new URL(route.request().url());
    let body: unknown = {};

    if (pathname === '/mesas/') body = tables;
    else if (pathname === '/comandas/detalhes/todos') body = commands;
    else if (pathname === '/produtos/catalogo') body = {
      categorias: [
        { id: 'cat-pratos', nome: 'Pratos', destino_impressao: 'COZINHA' },
        { id: 'cat-bebidas', nome: 'Bebidas', destino_impressao: 'BAR' },
      ],
      produtos: [
        { id: '101', nome: 'Risoto da casa', preco: 42, categoria_id: 'cat-pratos', ativo: true },
        { id: '201', nome: 'Suco natural', preco: 12, categoria_id: 'cat-bebidas', ativo: false },
      ],
    };
    else if (pathname === '/caixa/configuracoes') body = cashierConfig;
    else if (pathname === '/caixa/turno/atual') body = openShift;
    else if (pathname === '/caixa/turno-atual/resumo') {
      body = {
        turno_id: openShift.id,
        status: 'aberto',
        operador_id: 'caixa-e2e',
        operador_nome: 'Caixa E2E',
        aberto_em: openShift.aberto_em,
        tempo_aberto_minutos: 15,
        saldo_inicial: 100,
        total_vendas: 0,
        total_dinheiro: 0,
        total_pix: 0,
        total_cartao: 0,
        total_sangrias: 0,
        total_suprimentos: 0,
        saldo_esperado_dinheiro: 100,
        total_pedidos_pagos: 0,
        atividades_recentes: [],
      };
    } else if (pathname === '/estoque/insumos') {
      body = [{ id: 'ins-arroz', nome: 'Arroz arbóreo', estoque_atual: 4, estoque_minimo: 5, estoque_maximo: 20, unidade_medida: 'kg', preco_medio_custo: 18 }];
    } else if (pathname === '/estoque/entradas') {
      body = [{ id: 'ent-1', numero_documento: 'NF-900', observacao: '', valor_total: 180, tipo_entrada: 'XML', created_at: new Date().toISOString(), distribuidor: { nome_fantasia: 'Distribuidora E2E' }, itens: [{ insumo_id: 'ins-arroz', quantidade: 10, unidade_medida: 'kg', custo_unitario: 18, subtotal: 180 }] }];
    } else if (pathname === '/estoque/movimentacoes') {
      body = [{ id: 1, insumo_id: 'ins-arroz', tipo: 'perda', quantidade: 1, saldo_anterior: 5, saldo_posterior: 4, custo_unitario: 18, motivo: 'Avaria', observacao: '', origem: 'manual', created_at: new Date().toISOString() }];
    } else if (pathname === '/estoque/fichas-tecnicas') {
      body = [
        { produto_id: '101', produto_nome: 'Risoto da casa', produto_ativo: true, itens: [{ insumo_id: 'ins-arroz', quantidade: 0.2, insumo: { id: 'ins-arroz', nome: 'Arroz arbóreo', estoque_atual: 4, estoque_minimo: 5, estoque_maximo: 20, unidade_medida: 'kg', preco_medio_custo: 18 } }] },
        { produto_id: '201', produto_nome: 'Suco natural', produto_ativo: false, itens: [] },
      ];
    } else if (pathname === '/estoque/notas' || pathname === '/estoque/contagens' || pathname === '/estoque/sugestoes') {
      body = [];
    } else if (pathname === '/estoque/distribuidores') {
      body = [{ id: 'dist-1', nome_fantasia: 'Distribuidora E2E', razao_social: 'Distribuidora E2E Ltda.', cnpj: '00.000.000/0001-00', lead_time_dias: 2 }];
    } else if (pathname === '/fidelidade/clientes') {
      body = [{ id: 'cli-1', nome: 'Cliente E2E', telefone: '85999999999', saldo_pontos: 25, saldo_cashback: 0 }];
    } else if (pathname === '/fidelidade/config') {
      body = { ativo: true, tipo_recompensa: 'PONTOS', taxa_conversao: 1, valor_ponto_em_dinheiro: 0.05 };
    } else if (pathname === '/relatorios/visao-geral') {
      body = {
        faturamento_total: 870,
        vendas_brutas: 900,
        estornos: 30,
        total_pedidos: 18,
        ticket_medio: 48.33,
        clientes_ativos: 12,
        meta_mensal: 12000,
        meta_realizada: 5300,
        meta_restante: 6700,
        meta_percentual: 44.2,
        meta_projecao: 10100,
        meta_media_diaria_necessaria: 305,
        vendas_por_dia: [{ data: '2026-08-25', quantidade_pedidos: 18, total: 870 }],
        horarios_pico: [{ hora: '20h', total_pedidos: 18, faturamento: 870 }],
        comparativo_anterior: { tem_base_anterior: true, faturamento_anterior: 725, variacao_faturamento_pct: 20, pedidos_anteriores: 15, variacao_pedidos_pct: 20 },
      };
    } else if (pathname === '/comandas/estatisticas/geral') {
      body = {
        faturamento: 870,
        faturamento_hoje: 220,
        vendas_brutas: 900,
        estornos: 30,
        vendas_liquidas: 870,
        total_pedidos: 18,
        ticket_medio: 48.33,
        breakdown_bruto: { pix: 300, cartao: 500, dinheiro: 100 },
        breakdown_estornos: { pix: 0, cartao: 30, dinheiro: 0 },
        breakdown_pagamentos: { pix: 300, cartao: 470, dinheiro: 100 },
        dia_operacional_inicio: '2026-07-26',
        dia_operacional_fim: '2026-08-25',
        comparativo_anterior: { tem_base_anterior: true, recebido_anterior: 725, variacao_recebido_pct: 20, contas_anteriores: 15, variacao_contas_pct: 20 },
      };
    } else if (pathname === '/relatorios/produtos') {
      body = [{ ranking: 1, produto_id: '101', produto_nome: 'Risoto da casa', categoria_nome: 'Pratos', quantidade_consumida: 8, valor_consumido: 336, preco_medio_item: 42, natureza_valor: 'consumo_operacional_nao_receita', ficha_tecnica_configurada: true, custo_unitario_estimado: 3.6, cmv_estimado: 28.8, margem_contribuicao_estimada: 307.2, margem_percentual_estimada: 91.4 }];
    } else if (pathname === '/relatorios/equipe/desempenho') {
      body = { taxa_servico_ativa: true, taxa_servico_padrao: 10, membros: [{ id: 'garcom-e2e', nome: 'Atendente E2E', email: 'atendente@koma.test', role: 'garcom', pedidos_atendidos: 18, faturamento: 870, ticket_medio: 48.33, comissao: 87, taxa_servico_usada: 10 }] };
    } else if (pathname === '/caixa/funcionarios') {
      body = teamMembers;
    } else if (pathname === '/relatorios/cargos-permissoes') {
      body = {
        cargos: [
          { slug: 'admin', label: 'Administrador', total_funcionarios: 1, permissoes: { pedidos: true, caixa: true, relatorios: true, equipe: true, admin: true } },
          { slug: 'gerente', label: 'Gerente', total_funcionarios: 0, permissoes: { pedidos: true, caixa: true, relatorios: true, equipe: true, admin: false } },
          { slug: 'caixa', label: 'Operador de caixa', total_funcionarios: 1, permissoes: { pedidos: true, caixa: true, relatorios: true, equipe: true, admin: false } },
          { slug: 'garcom', label: 'Garçom', total_funcionarios: 1, permissoes: { pedidos: true, caixa: false, relatorios: false, equipe: false, admin: false } },
        ],
      };
    } else if (
      pathname === '/caixa/pagamentos/pendentes'
      || pathname === '/comandas/delivery/ativos'
      || pathname === '/comandas/motoboys/lista'
      || pathname === '/auth/smartpos/caixa/operacao'
      || pathname === '/auth/usuarios'
      || pathname === '/cardapio/modificadores/grupos'
    ) {
      body = [];
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function seedCashierSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('koma_caixa_token', 'playwright-e2e-token');
    localStorage.setItem('koma_caixa_id', 'caixa-e2e');
    localStorage.setItem('koma_caixa_name', 'Caixa E2E');
    localStorage.setItem('koma_caixa_role', 'caixa');
    localStorage.setItem('token', 'playwright-e2e-token');
    sessionStorage.setItem('koma_active_tab', 'operacao');
    sessionStorage.setItem('koma_active_subtab', 'pedidos');
  });
}

export { mockCashierBackend, seedCashierSession, commands, DESKTOP_BREAKPOINT };
