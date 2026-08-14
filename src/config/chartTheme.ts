/**
 * Kôma Standardized Chart & Data Visualization Theme
 * Unified palette for Recharts components across all financial, sales and team reports.
 */

export const KOMA_CHART_COLORS = {
  // Official brand and primary metrics (Faturamento, Total Vendas, Concluídos)
  primary: '#059669', // Kôma Teal
  primaryLight: '#34d399', // Mint
  primaryDark: '#047857',

  // Secondary metrics (Comparativos, Meta, Quantidades)
  secondary: '#475569', // Graphite / Slate
  secondaryLight: '#64748b',

  // Semantic status colors (Somente quando o dado tiver significado operacional)
  warning: '#d97706', // Âmbar (Atenção / Pendente / Dinheiro)
  danger: '#dc2626',  // Vermelho / Vinho (Cancelamento / Queda)
  info: '#0284c7',    // Azul Informacional (Cartão / Pix se necessário)
  neutral: '#94a3b8', // Cinza neutro

  // Sequência ordenada para gráficos de pizza/rosca ou múltiplas séries
  series: [
    '#059669', // Teal Kôma (1º)
    '#475569', // Grafite (2º)
    '#34d399', // Menta (3º)
    '#d97706', // Âmbar (4º)
    '#0284c7', // Azul informativo (5º)
    '#94a3b8', // Cinza neutro (6º)
  ],

  // Formas de pagamento padronizadas
  paymentMethods: {
    pix: '#059669',      // Pix: Teal Kôma
    cartao: '#475569',   // Cartão: Grafite
    dinheiro: '#d97706', // Dinheiro: Âmbar
    outros: '#94a3b8',   // Outros: Cinza neutro
  },
};

export const KOMA_CHART_AXIS = {
  stroke: 'var(--koma-text-muted)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

export const KOMA_CHART_GRID = {
  strokeDasharray: '3 3',
  stroke: 'var(--koma-border-default)',
  vertical: false,
  opacity: 0.6,
};
