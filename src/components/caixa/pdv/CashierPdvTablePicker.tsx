import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, UsersRound, X } from 'lucide-react';
import { KomaWaiterGlyph } from '../../shared/KomaWaiterGlyphs';
import { TableStatusMark, TABLE_STATE_GLYPH } from '../../shared/TableStatusMark';
import { tableCardPresentation } from '../../shared/SharedTableCard';
import type { projectCashierSalonTables } from '../../../domain/cashierSalonProjection';

export type PdvTableOption = ReturnType<typeof projectCashierSalonTables>[number] & { label: string };

type TableFilter = 'all' | 'free' | 'occupied';

interface Props {
  options: readonly PdvTableOption[];
  selectedId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (tableId: number) => void;
}

const normal = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const currency = (amount: number) => amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatPdvTableLabel(table: { id: number; nome?: string | null }) {
  const fullName = table.nome?.trim() || `Mesa ${table.id}`;
  return /^mesa\s*\d+$/i.test(fullName)
    ? `Mesa ${String(table.id).padStart(2, '0')}`
    : `Mesa ${String(table.id).padStart(2, '0')} · ${fullName}`;
}

/** Native dialog semantics, KÔMA-owned visual controls; never changes the PDV session model. */
export function CashierPdvTablePicker({ options, selectedId, open, onOpenChange, onSelect }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TableFilter>('all');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery('');
      setFilter('all');
      if (!dialog.open) dialog.showModal();
      searchRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  const filtered = useMemo(() => {
    const search = normal(query.trim());
    return options.filter((option) => {
      if (filter === 'free' && (option.isOccupied || option.isMerged)) return false;
      if (filter === 'occupied' && !option.isOccupied) return false;
      return !search || normal(`${option.table.id} ${String(option.table.id).padStart(2, '0')} Mesa ${option.table.nome || ''}`).includes(search);
    });
  }, [options, filter, query]);

  const select = (id: number) => {
    onSelect(id);
    onOpenChange(false);
  };

  return (
    <dialog
      id="pdv-table-picker"
      ref={ref}
      className="koma-table-picker"
      aria-labelledby="pdv-table-picker-title"
      onClose={() => {
        onOpenChange(false);
        if (previousFocus.current?.isConnected) previousFocus.current.focus();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div className="koma-table-picker__surface">
        <header className="koma-table-picker__heading">
          <div>
            <span className="koma-table-picker__eyebrow">CONSUMO NO LOCAL</span>
            <h2 id="pdv-table-picker-title">Escolher mesa</h2>
          </div>
          <button className="koma-table-picker__close" type="button" onClick={() => onOpenChange(false)} aria-label="Fechar escolha de mesa"><X size={21} aria-hidden="true" /></button>
        </header>

        <div className="koma-table-picker__tools">
          <label className="koma-table-picker__search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Buscar número ou nome da mesa</span>
            <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar número ou nome" />
          </label>
          <div className="koma-table-picker__filters" role="group" aria-label="Filtrar mesas">
            {([
              { id: 'all', label: 'Todas' },
              { id: 'free', label: 'Livres' },
              { id: 'occupied', label: 'Em atendimento' },
            ] as const).map((item) => (
              <button
                key={item.id} type="button"
                aria-pressed={filter === item.id}
                className={filter === item.id ? 'is-active' : undefined}
                onClick={() => setFilter(item.id)}
              >{item.label}</button>
            ))}
          </div>
        </div>

        <div className="koma-table-picker__scroll">
          <button
            type="button"
            className="koma-table-picker__no-table"
            aria-pressed={selectedId === 0}
            onClick={() => select(0)}
          >
            <span><strong>Sem mesa</strong><small>Vincular depois, se necessário</small></span>
            {selectedId === 0 && <Check size={19} aria-hidden="true" />}
          </button>
          {filtered.length === 0 ? (
            <div className="koma-table-picker__empty">Nenhuma mesa encontrada. Altere a busca ou o filtro.</div>
          ) : (
            <div className="koma-table-picker__grid">
              {filtered.map((option) => {
                const selected = selectedId === option.table.id;
                const presentation = tableCardPresentation(option.operational);
                const status = presentation.label;
                const baseStatus = option.isMerged ? 'Unida' : option.isOccupied ? 'Em atendimento' : 'Livre';
                const displayName = formatPdvTableLabel(option.table);
                const customName = option.table.nome?.trim()
                  && !/^mesa\s*0*\d+$/i.test(option.table.nome.trim()) ? option.table.nome.trim() : null;
                return (
                  <button
                    key={option.table.id}
                    type="button"
                    aria-label={`${displayName} · ${baseStatus}${status !== baseStatus ? ` · ${status}` : ''}`}
                    aria-pressed={selected}
                    className="koma-table-picker__tile"
                    data-table-status={option.isMerged ? 'merged' : option.isOccupied ? 'occupied' : 'free'}
                    data-operational-state={presentation.key}
                    onClick={() => select(option.table.id)}
                  >
                    <span className="koma-table-picker__tile-top">
                      <strong>{String(option.table.id).padStart(2, '0')}</strong>
                      <span className="koma-table-picker__tile-symbols">
                        <KomaWaiterGlyph name={TABLE_STATE_GLYPH[presentation.key] || 'table-service'} size={18} aria-hidden="true" />
                        {selected && <Check size={19} aria-hidden="true" />}
                      </span>
                    </span>
                    {customName && <span className="koma-table-picker__tile-name">{customName}</span>}
                    <span className="koma-table-picker__tile-status"><TableStatusMark>{status}</TableStatusMark></span>
                    {option.isMerged ? <small className="koma-table-picker__tile-detail">Na mesa {String(option.displayMesaId).padStart(2, '0')}</small> : option.isOccupied ? (
                      <small className="koma-table-picker__tile-detail">{option.total > 0 ? currency(option.total) : 'Atendimento aberto'}</small>
                    ) : option.table.capacidade > 0 ? (
                      <small className="koma-table-picker__tile-detail"><UsersRound size={13} aria-hidden="true" />{option.table.capacidade} lugares</small>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
