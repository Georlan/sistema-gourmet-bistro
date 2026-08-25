import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  FileText,
  Filter,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { EntradaEstoque, Insumo, MovimentacaoEstoque } from '../../types';
import { formatBackendDateTime, parseBackendTimestamp } from '../../utils/dateTime';
import { KomaEmptyState } from '../shared/KomaEmptyState';

type HistoryKind = 'todos' | 'entrada' | 'saida' | 'perda' | 'ajuste' | 'inventario';

interface EstoqueHistoricoTabProps {
  entradas: EntradaEstoque[];
  notasEntradaXml: any[];
  movimentacoes: MovimentacaoEstoque[];
  insumos: Insumo[];
  isLoading: boolean;
  onOpenNovaEntradaModal: () => void;
  onOpenNovaMovimentacaoModal: () => void;
  onUploadXmlFile: (file: File) => void;
  onRefresh: () => void;
  xmlUploadState: { loading: boolean; error: string | null; result: any | null; isDragging: boolean };
  onResetXmlState: () => void;
  xmlFileInputRef: React.RefObject<HTMLInputElement>;
}

interface HistoryRow {
  id: string;
  createdAt: string;
  kind: Exclude<HistoryKind, 'todos'>;
  title: string;
  detail: string;
  quantity: string;
  balance: string;
  amount: string;
  origin: string;
  searchText: string;
}

const typeMeta = {
  entrada: { label: 'Entrada', icon: ArrowDownLeft, className: 'koma-badge-success' },
  saida: { label: 'Saída', icon: ArrowUpRight, className: 'koma-badge-info' },
  perda: { label: 'Perda', icon: AlertTriangle, className: 'koma-badge-danger' },
  ajuste: { label: 'Ajuste', icon: SlidersHorizontal, className: 'koma-badge-warning' },
  inventario: { label: 'Inventário', icon: CheckCircle2, className: 'koma-badge-neutral' },
} as const;

function movementKind(tipo: MovimentacaoEstoque['tipo']): HistoryRow['kind'] {
  if (tipo === 'entrada') return 'entrada';
  if (tipo === 'saida') return 'saida';
  if (tipo === 'perda') return 'perda';
  if (tipo === 'contagem') return 'inventario';
  return 'ajuste';
}

function originLabel(origin?: string) {
  return ({
    venda_automatica: 'Venda automática',
    cancelamento_venda: 'Venda cancelada',
    entrada_manual: 'Entrada manual',
    movimentacao_manual: 'Ajuste manual',
    contagem: 'Inventário',
    xml: 'NF-e XML',
  } as Record<string, string>)[origin || ''] || origin || 'Manual';
}

export function EstoqueHistoricoTab({
  entradas,
  notasEntradaXml,
  movimentacoes,
  isLoading,
  onOpenNovaEntradaModal,
  onOpenNovaMovimentacaoModal,
  onUploadXmlFile,
  onRefresh,
  xmlUploadState,
  onResetXmlState,
  xmlFileInputRef,
}: EstoqueHistoricoTabProps) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<HistoryKind>('todos');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const rows = useMemo<HistoryRow[]>(() => {
    const entryIds = new Set(entradas.map(entry => String(entry.id)));
    const entryDocuments = new Set(entradas.map(entry => String(entry.numero_documento || '')).filter(Boolean));

    const entryRows: HistoryRow[] = entradas.map(entry => {
      const itemLabels = (entry.itens || []).map(item => item.insumo?.nome || item.insumo_id);
      const itemCount = entry.itens?.length || 0;
      const supplier = entry.distribuidor?.nome_fantasia || 'Fornecedor não informado';
      const document = entry.numero_documento || 'Sem documento';
      return {
        id: `entry-${entry.id}`,
        createdAt: entry.created_at || entry.data_emissao || '',
        kind: 'entrada',
        title: `${supplier} · ${document}`,
        detail: itemLabels.length > 0 ? itemLabels.join(', ') : entry.observacao || 'Entrada de estoque',
        quantity: `${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`,
        balance: '—',
        amount: `R$ ${Number(entry.valor_total || 0).toFixed(2)}`,
        origin: entry.tipo_entrada === 'XML' ? 'NF-e XML' : 'Manual',
        searchText: [supplier, document, entry.observacao, ...itemLabels].join(' '),
      };
    });

    const xmlFallbackRows: HistoryRow[] = notasEntradaXml
      .filter(note => !entryDocuments.has(String(note.numero_nota || '')))
      .map(note => {
        const itemLabels = (note.itens || []).map((item: any) => item.insumo?.nome || item.insumo_id).filter(Boolean);
        const supplier = note.distribuidor?.nome_fantasia || 'Fornecedor não informado';
        return {
          id: `xml-${note.id}`,
          createdAt: note.data_emissao || note.created_at || '',
          kind: 'entrada',
          title: `${supplier} · NF-${note.numero_nota || 's/n'}`,
          detail: itemLabels.length > 0 ? itemLabels.join(', ') : 'Importação de NF-e',
          quantity: `${note.itens?.length || 0} itens`,
          balance: '—',
          amount: `R$ ${Number(note.valor_total || 0).toFixed(2)}`,
          origin: 'NF-e XML',
          searchText: [supplier, note.numero_nota, ...itemLabels].join(' '),
        } as HistoryRow;
      });

    const movementRows: HistoryRow[] = movimentacoes
      .filter(movement => !(movement.tipo === 'entrada' && movement.referencia_id && entryIds.has(String(movement.referencia_id))))
      .map(movement => {
        const ingredient = movement.insumo?.nome || movement.insumo_id;
        const unit = movement.insumo?.unidade_medida || '';
        return {
          id: `movement-${movement.id}`,
          createdAt: movement.created_at,
          kind: movementKind(movement.tipo),
          title: ingredient,
          detail: movement.motivo || movement.observacao || 'Movimentação de estoque',
          quantity: `${Number(movement.quantidade || 0).toFixed(2)} ${unit}`.trim(),
          balance: `${Number(movement.saldo_anterior || 0).toFixed(2)} → ${Number(movement.saldo_posterior || 0).toFixed(2)}`,
          amount: movement.custo_unitario ? `R$ ${Number(movement.custo_unitario).toFixed(2)}/un` : '—',
          origin: originLabel(movement.origem),
          searchText: [ingredient, movement.motivo, movement.observacao, movement.origem].join(' '),
        };
      });

    return [...entryRows, ...xmlFallbackRows, ...movementRows].sort((left, right) => {
      const leftTime = parseBackendTimestamp(left.createdAt)?.getTime() || 0;
      const rightTime = parseBackendTimestamp(right.createdAt)?.getTime() || 0;
      return rightTime - leftTime;
    });
  }, [entradas, movimentacoes, notasEntradaXml]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const end = endDate ? new Date(`${endDate}T23:59:59.999`) : null;
    return rows.filter(row => {
      if (kind !== 'todos' && row.kind !== kind) return false;
      if (term && !`${row.title} ${row.detail} ${row.searchText}`.toLocaleLowerCase('pt-BR').includes(term)) return false;
      const date = parseBackendTimestamp(row.createdAt);
      if (start && (!date || date < start)) return false;
      if (end && (!date || date > end)) return false;
      return true;
    });
  }, [endDate, kind, rows, search, startDate]);

  const hasFilters = Boolean(search || startDate || endDate || kind !== 'todos');
  const clearFilters = () => {
    setSearch('');
    setKind('todos');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="space-y-3.5 text-left animate-fade-in">
      <section className="koma-toolbar">
        <div className="koma-toolbar__search">
          <Search size={14} aria-hidden="true" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar ingrediente, fornecedor ou documento…"
            aria-label="Buscar no histórico de estoque"
          />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca"><X size={13} /></button>}
        </div>
        <div className="koma-toolbar__actions">
          <button type="button" onClick={onRefresh} className="koma-btn-secondary" title="Atualizar histórico" aria-label="Atualizar histórico">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button type="button" onClick={() => xmlFileInputRef.current?.click()} className="koma-btn-secondary">
            <FileText size={14} /> Importar XML
          </button>
          <button type="button" onClick={onOpenNovaMovimentacaoModal} className="koma-btn-secondary">
            <SlidersHorizontal size={14} /> Ajuste / perda
          </button>
          <button type="button" onClick={onOpenNovaEntradaModal} className="koma-btn-success">
            <Plus size={14} /> Nova entrada
          </button>
        </div>
      </section>

      <input
        ref={xmlFileInputRef}
        type="file"
        accept=".xml"
        className="hidden"
        onChange={event => {
          if (event.target.files?.[0]) onUploadXmlFile(event.target.files[0]);
          event.target.value = '';
        }}
      />

      {xmlUploadState.loading && (
        <div className="koma-feedback koma-feedback--info"><RefreshCw size={15} className="animate-spin" /> Processando NF-e…</div>
      )}
      {xmlUploadState.result && (
        <div className="koma-feedback koma-feedback--success">
          <span><strong>NF-e importada.</strong> {xmlUploadState.result.fornecedor || 'Fornecedor'} · R$ {Number(xmlUploadState.result.valor_total || 0).toFixed(2)}</span>
          <button type="button" onClick={onResetXmlState}>Fechar</button>
        </div>
      )}
      {xmlUploadState.error && (
        <div className="koma-feedback koma-feedback--danger">
          <span><strong>Não foi possível importar:</strong> {xmlUploadState.error}</span>
          <button type="button" onClick={onResetXmlState}>Fechar</button>
        </div>
      )}

      <section className="koma-filterbar" aria-label="Filtros do histórico">
        <label>
          <span><Filter size={10} /> Tipo</span>
          <select value={kind} onChange={event => setKind(event.target.value as HistoryKind)}>
            <option value="todos">Todos os registros</option>
            <option value="entrada">Entradas</option>
            <option value="saida">Saídas</option>
            <option value="perda">Perdas</option>
            <option value="ajuste">Ajustes</option>
            <option value="inventario">Inventário</option>
          </select>
        </label>
        <label><span>De</span><input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
        <label><span>Até</span><input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
        <div className="koma-filterbar__summary">
          <strong>{filteredRows.length}</strong>
          <span>{filteredRows.length === 1 ? 'registro' : 'registros'}</span>
          {hasFilters && <button type="button" onClick={clearFilters}>Limpar filtros</button>}
        </div>
      </section>

      {filteredRows.length === 0 ? (
        <KomaEmptyState
          icon={hasFilters ? Filter : FileText}
          title={hasFilters ? 'Nenhum registro corresponde aos filtros' : 'O histórico ainda está vazio'}
          description={hasFilters ? 'Limpe ou ajuste os filtros para ampliar a busca.' : 'Entradas, perdas, ajustes e inventários aparecerão juntos nesta linha do tempo.'}
          action={hasFilters
            ? { label: 'Limpar filtros', onClick: clearFilters, variant: 'secondary' }
            : { label: 'Registrar primeira entrada', onClick: onOpenNovaEntradaModal, icon: Plus }}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-koma-border bg-koma-panel">
          <table className="koma-data-table min-w-[760px]">
            <thead><tr><th>Data e hora</th><th>Registro</th><th>Tipo</th><th>Quantidade / valor</th><th>Saldo</th><th>Origem</th></tr></thead>
            <tbody>
              {filteredRows.map(row => {
                const meta = typeMeta[row.kind];
                const Icon = meta.icon;
                return (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap font-mono text-koma-muted">{formatBackendDateTime(row.createdAt)}</td>
                    <td><strong>{row.title}</strong><span>{row.detail}</span></td>
                    <td><span className={clsx('koma-status-badge', meta.className)}><Icon size={10} /> {meta.label}</span></td>
                    <td><strong className="font-mono">{row.quantity}</strong><span className="font-mono">{row.amount}</span></td>
                    <td className="whitespace-nowrap font-mono text-koma-secondary">{row.balance}</td>
                    <td className="text-koma-muted">{row.origin}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
