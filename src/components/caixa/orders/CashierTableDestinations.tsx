import React from 'react';
import type { KanbanOrderDetailsProps } from './KanbanOrderDetails';
import { CashierDetailActionArt } from './CashierDetailActionArt';

type Props = { source: number; transfer: KanbanOrderDetailsProps['transfer']; actions: KanbanOrderDetailsProps['actions']; association?: boolean };
/** Reuses the existing tenant-scoped table snapshot; opening the picker makes no request. */
export function CashierTableDestinations({ source, transfer, actions, association = false }: Props) {
  const [mode, setMode] = React.useState<'transfer' | 'merge' | 'associate' | null>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const selected = transfer.tables.find(table => String(table.id) === transfer.targetId);
  const open = (next: typeof mode) => {
    transfer.onTargetChange(''); setMode(next);
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[role=radio]')?.focus());
  };
  const close = () => {
    if (transfer.isTransferring) return;
    const trigger = root.current?.querySelector<HTMLButtonElement>(`[data-intent=${mode}]`);
    setMode(null); trigger?.focus();
  };
  return <div className="kd-destinations" ref={root}>
    <div className="kd-actions-grid">
      {association ? <button type="button" disabled={transfer.isTransferring} data-intent="associate" className="kd-action kd-action--move" aria-expanded={mode === 'associate'} onClick={() => mode ? close() : open('associate')}><CashierDetailActionArt kind="transfer" /><span>Vincular mesa</span></button> : <>
        <button type="button" disabled={transfer.isTransferring} data-intent="transfer" className="kd-action kd-action--move" aria-expanded={mode === 'transfer'} onClick={() => mode === 'transfer' ? close() : open('transfer')}><CashierDetailActionArt kind="transfer" /><span>Transferir</span></button>
        {actions.mergeTable && <button type="button" disabled={transfer.isTransferring} data-intent="merge" className="kd-action kd-action--move" aria-expanded={mode === 'merge'} onClick={() => mode === 'merge' ? close() : open('merge')}><CashierDetailActionArt kind="merge" /><span>Mesclar mesas</span></button>}
      </>}
    </div>
    {mode && <section className="kd-destination-panel" aria-label={mode === 'associate' ? 'Vincular mesa' : mode === 'merge' ? 'Mesclar mesas' : 'Transferir mesa'} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="kd-destination-head"><strong>{mode === 'associate' ? 'Qual mesa?' : 'Mesa de destino'}</strong><button type="button" aria-label="Fechar escolha de mesa" disabled={transfer.isTransferring} onClick={close}>×</button></div>
      <div className="kd-destination-legend"><span><i data-occupied="false" />Livres</span><span><i data-occupied="true" />Com consumo</span></div>
      <div role="radiogroup" aria-label="Mesa de destino" className="kd-destination-grid">
        {transfer.tables.filter(table => Number(table.id) !== source).map((table, index, tables) => <button key={table.id} type="button" role="radio" tabIndex={String(table.id) === transfer.targetId || (!transfer.targetId && index === 0) ? 0 : -1} aria-checked={String(table.id) === transfer.targetId} aria-label={`Mesa ${table.id}${table.nome && !/^mesa\s*0*\d+$/i.test(table.nome) ? ` · ${table.nome}` : ''} · ${table.isOccupied ? 'ocupada' : 'livre'}`} data-occupied={Boolean(table.isOccupied)} disabled={transfer.isTransferring} onClick={() => transfer.onTargetChange(String(table.id))}
          onKeyDown={event => {
            const direction = ['ArrowRight','ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 0;
            if (!direction) return; event.preventDefault();
            const target = tables[(index + direction + tables.length) % tables.length]; transfer.onTargetChange(String(target.id));
            const controls = root.current?.querySelectorAll<HTMLButtonElement>('[role=radio]'); controls?.[(index + direction + tables.length) % tables.length]?.focus();
          }}><strong>{String(table.id).padStart(2,'0')}</strong>{table.nome && !/^mesa\s*0*\d+$/i.test(table.nome) && <span>{table.nome}</span>}<i aria-hidden="true" /></button>)}
      </div>
      {selected && <p className="kd-destination-note">{mode === 'merge' ? `Unir o consumo na Mesa ${selected.id} e liberar a Mesa ${source}.` : mode === 'associate' && selected.isOccupied ? 'Esta mesa já possui consumo.' : `Destino: Mesa ${selected.id}.`}</p>}
      <button type="button" className="kd-destination-confirm" disabled={!selected || transfer.isTransferring} onClick={() => { if (mode === 'merge') void actions.mergeTable?.(); else if (mode === 'associate') actions.associateTable(); else actions.transferTable(); }}>
        {transfer.isTransferring ? 'Aguarde…' : mode === 'merge' ? 'Confirmar mesclagem' : mode === 'associate' ? 'Confirmar vínculo' : 'Confirmar transferência'}
      </button>
    </section>}
  </div>;
}
