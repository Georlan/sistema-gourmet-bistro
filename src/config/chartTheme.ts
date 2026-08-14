/**
 * Kôma Standardized Chart & Data Visualization Theme
 * Unified palette for Recharts components across all financial, sales and team reports.
 */

export const KOMA_CHART_COLORS = {
  // Official brand and primary metrics (Faturamento, Total Vendas, Concluídos)
  primary: '#059669', // Kôma Teal
  primaryLight: '#34d399', // Mint
  primaryDark: '#047857',

  // Secondary metrics (Volume, Atendimentos, Horários de Pico, Cartão)
  secondary: '#0284c7', // Sky Blue
  secondaryLight: '#38bdf8',

  // Semantic status colors
  warning: '#d97706', // Âmbar (Atenção / Pendente / Dinheiro)
  danger: '#dc2626',  // Vermelho / Vinho (Cancelamento / Queda)
  info: '#0284c7',    // Azul Informacional
  neutral: '#64748b', // Slate

  // Sequência ordenada para gráficos de pizza/rosca ou múltiplas séries
  series: [
    '#059669', // Teal Kôma (1º)
    '#0284c7', // Sky Blue (2º)
    '#d97706', // Âmbar (3º)
    '#475569', // Grafite (4º)
    '#34d399', // Menta (5º)
    '#94a3b8', // Cinza neutro (6º)
  ],

  // Formas de pagamento padronizadas
  paymentMethods: {
    pix: '#059669',      // Pix: Teal Kôma
    cartao: '#0284c7',   // Cartão: Sky Blue
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
