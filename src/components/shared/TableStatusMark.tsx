import type { ReactNode } from 'react';
import type { KomaGlyphName } from './KomaWaiterGlyphs';

export const TABLE_STATE_GLYPH: Record<string, KomaGlyphName> = {
  free: 'table-free', occupied: 'table-service', served: 'table-served',
  ready: 'table-ready', payment: 'table-payment', merged: 'table-merged',
};

/** Identical state indicator wherever Caixa shows a table. The canonical
 * operational projection owns the label; color is never the sole signal. */
export function TableStatusMark({ children, className = '' }: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={`koma-table-state-mark ${className}`}>
    <span className="koma-table-state-mark__dot" aria-hidden="true" />
    <span>{children}</span>
  </span>;
}
