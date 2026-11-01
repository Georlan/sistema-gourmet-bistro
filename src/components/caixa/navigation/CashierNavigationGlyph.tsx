import type { LucideIcon } from 'lucide-react';

/* Original KÔMA navigation marks. Shared geometry, no image downloads. */
const marks: Record<string, string> = {
  operacao: 'M5 7h14l1 13H4L5 7ZM8 7V5a4 4 0 0 1 8 0v2M8 13h8M9 16h6',
  financeiro: 'M4 8h16v12H4V8ZM7 8V3h10v5M8 12h8M8 16h3m5 0h1M10 5h4',
  cardapio: 'M5 4h11l3 3v13H5V4ZM15 4v4h4M8 11h8M8 15h5M8 18h3',
  cardapio_digital: 'M7 3h10v18H7V3ZM7 6h10M10 18h4M10 10h4m-4 3h3',
  estoque: 'm3 7 9-4 9 4v13H3V7Zm0 0h18M9 7v5l3-2 3 2V7M7 16h4',
  clientes: 'M3 20v-2a5 5 0 0 1 10 0v2M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 4a3 3 0 0 1 0 6m0 3a5 5 0 0 1 5 5v2M4 20h8',
  relatorios: 'M4 3v17h17M8 16v-5h3v5M14 16V6h3v10M20 4v2',
  permissoes_cargos: 'M4 20v-3a6 6 0 0 1 12 0v3M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 3 2 2 3-4M6 20h8',
  impressao_salao: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-8 0v6',
  assinatura_pix: 'M4 5h16v14H4V5ZM4 10h16M8 15h4m5 0h1',
};

export function CashierNavigationGlyph({ kind, fallback: Fallback }: { kind: string; fallback: LucideIcon }) {
  const path = marks[kind];
  if (!path) return <Fallback size={20} aria-hidden="true" />;
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>;
}
