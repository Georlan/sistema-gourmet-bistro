/** Versioned list of official KÔMA browser surfaces. Keep the gate and smoke in sync here. */
export const SURFACE_REGISTRY_VERSION = 1 as const;

export const officialHosts = [
  { id: 'landing', url: 'https://komafood.com.br/', kind: 'landing' },
  { id: 'app', url: 'https://app.komafood.com.br/', kind: 'app' },
  { id: 'central', url: 'https://central.komafood.com.br/', kind: 'central' },
  { id: 'pordosol', url: 'https://pordosol.komafood.com.br/', kind: 'cardapio' },
  { id: 'demo', url: 'https://demo.komafood.com.br/', kind: 'cardapio' },
  { id: 'pocket-teste', url: 'https://pocket-teste.komafood.com.br/', kind: 'cardapio' },
] as const;

export const publicRoutes = [
  { id: 'demo-fallback', path: '/c/demo', kind: 'cardapio' },
  { id: 'password-recovery', path: '/recuperar-senha', kind: 'auth' },
  { id: 'activation', path: '/ativar', kind: 'auth' },
  { id: 'smartpos', path: '/smartpos', kind: 'operational' },
  { id: 'order-tracking', path: '/acompanhar', kind: 'cardapio' },
  { id: 'courier', path: '/entregador', kind: 'operational' },
  { id: 'print-simulator', path: '/ferramentas/simulador-impressao', kind: 'operational' },
] as const;

export const legalRoutes = [
  '/legal',
  '/legal/termos',
  '/legal/planos',
  '/legal/privacidade',
  '/legal/dpa',
  '/legal/suboperadores',
  '/legal/cookies',
  '/legal/cardapio-termos',
  '/legal/cardapio-privacidade',
] as const;

export const contractRoutes = [
  '/contratar/pocket?cobranca=mensal', '/contratar/pocket?cobranca=anual',
  '/contratar/pro?cobranca=mensal', '/contratar/pro?cobranca=anual',
  '/contratar/premium?cobranca=mensal', '/contratar/premium?cobranca=anual',
] as const;

export const operatorSections = {
  vendas: ['Pedidos', 'Novo pedido', 'Salão', 'Cozinha/Preparo', 'Retiradas', 'Entregas'],
  caixa: ['Turno atual', 'Movimentações', 'Fechamento'],
  cardapio: ['Produtos', 'Complementos', 'Preparo/impressão'],
  estoque: ['Estoque', 'Compras', 'Inventário', 'Fornecedores'],
  clientes: ['Lista', 'Busca', 'Detalhe'],
  cardapioOnline: ['Perfil', 'Marca', 'Pedidos online', 'Clientes bloqueados', 'Entrega', 'Pagamentos', 'Divulgação'],
  relatorios: ['Geral', 'Financeiro', 'Produtos', 'Equipe'],
  equipe: ['Pessoas', 'Funções/permissões'],
  configuracoes: ['Aparência', 'Impressão', 'Mesas', 'Garçom', 'Taxa de Serviço', 'Implantação', 'Integrações'],
  conta: ['Meu Plano', 'Upgrade', 'Contrato/documentos'],
} as const;

export const centralSections = [
  'Overview', 'Restaurantes', 'Inscrições', 'Billing', 'Onboarding/trial',
  'Incidentes', 'Contratos', 'Auditoria', 'Homologação', 'Modo Suporte',
] as const;

/** Stable IDs from the operational navigation tree; the browser gate clicks each one. */
export const operatorNavigationIds = [
  'vendas_pedidos', 'vendas_novo_pedido', 'vendas_salao', 'vendas_cozinha', 'vendas_retiradas', 'vendas_entregas',
  'caixa_turno_atual', 'caixa_movimentacoes', 'caixa_fechamento',
  'cardapio_produtos', 'cardapio_complementos', 'cardapio_preparo',
  'estoque_ingredientes', 'estoque_historico', 'estoque_inventario', 'estoque_fornecedores',
  'clientes',
  'online_perfil', 'online_marca', 'online_pedidos', 'online_bloqueios', 'online_entrega', 'online_pagamentos', 'online_divulgacao',
  'relatorios_visao_geral', 'relatorios_financeiro', 'relatorios_produtos', 'relatorios_equipe',
  'equipe_pessoas', 'equipe_funcoes_acessos',
  'config_aparencia', 'config_impressao', 'config_mesas', 'config_garcom', 'config_taxa', 'config_implantacao', 'config_integracoes',
  'assinatura_meu_plano', 'assinatura_planos_upgrade', 'assinatura_contrato_documentos',
] as const;
