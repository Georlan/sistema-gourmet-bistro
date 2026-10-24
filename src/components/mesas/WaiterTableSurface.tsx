import type { ReactNode } from 'react';
import type { Table } from '../../types';
import { KomaWaiterGlyph, type KomaGlyphName } from '../shared/KomaWaiterGlyphs';
import { TablePresenceNotice } from '../shared/TablePresenceNotice';

interface Props {
  table: Table;
  presentation: { key: string; label: string };
  primaryCheckNumber?: number;
  occupied: boolean;
  formattedTotal: string;
  elapsed: string;
  draftCount: number;
  mergedSources: readonly number[];
  names: readonly string[];
  identityLabel: string;
  density: 'regular' | 'compact';
  children?: ReactNode;
}

/** Waiter composition only. Identity, money and state remain owned by canonical read models. */
export function WaiterTableSurface({ table, presentation, primaryCheckNumber, occupied,
  formattedTotal, elapsed, draftCount, mergedSources, names, identityLabel, density, children }: Props) {
  const symbols: Record<string, KomaGlyphName> = { free: 'table-free', occupied: 'table-service', ready: 'table-ready', payment: 'table-payment', served: 'table-served', merged: 'table-merged' };
  const fullName = table.nome?.trim() || `Mesa ${table.id}`;
  const numericName = fullName.match(/^mesa\s*(\d+)$/i);
  const visibleName = numericName ? numericName[1].padStart(2, '0') : fullName;
  return <article className="kw-table" title={presentation.label} data-operational-state={presentation.key} data-density={density}
    aria-label={`${fullName}: ${presentation.label}`}>
    <header className="kw-table__identity">
      <div className="kw-table__heading"><strong title={fullName} className={numericName ? 'kw-table__number' : 'kw-table__name'}>{visibleName}</strong><KomaWaiterGlyph name={symbols[presentation.key] || 'table-service'} size={17} aria-hidden="true" className="kw-table__symbol" /></div>
      {primaryCheckNumber != null && <span className="kw-table__order" title={`${identityLabel} #${primaryCheckNumber}`}>Ped. {primaryCheckNumber}</span>}
    </header>
    <div className="kw-table__context">
      {presentation.key === 'merged' && <span className="kw-table__state">{presentation.label}</span>}
      {occupied && <strong className="kw-table__total">{formattedTotal}</strong>}
      {occupied && <span className="kw-table__time">{elapsed}</span>}
      {mergedSources.length > 0 && <span className="kw-table__meta">+ mesas {mergedSources.join(', ')}</span>}
      {draftCount > 0 && <span className="kw-table__draft" title={`${draftCount} no rascunho`}><KomaWaiterGlyph name="draft-saved" size={13} />{draftCount} rascunho</span>}
      <TablePresenceNotice names={names} compact />
    </div>
    {children}
  </article>;
}
