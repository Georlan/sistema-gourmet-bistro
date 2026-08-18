import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  CreditCard,
  Loader2,
  RefreshCw,
  WalletCards,
} from 'lucide-react';
import { API_BASE_URL } from '../config/api';


type OperationalState =
  | 'em_preparo'
  | 'pronto'
  | 'aguardando_pagamento'
  | 'pagamento_processando'
  | 'aprovado_pendente_liquidacao';

type CashProjection = {
  mesa_id: number;
  estado_operacional: OperationalState;
  valor_total: number | string;
  valor_pago: number | string;
  saldo: number | string;
  itens_ativos: number;
  itens_preparando: number;
  itens_prontos: number;
  conta_pedida: boolean;
  pagamento?: {
    intent_id: string;
    status: string;
    metodo: string;
    valor: number | string;
    captura: string;
    provider?: string | null;
    terminal_id?: string | null;
    provider_reference?: string | null;
    pagamento_id?: string | null;
  } | null;
};

const isCashRoute = () => {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  return view === 'caixa'
    || view === 'gerencia'
    || window.location.hash === '#caixa'
    || window.location.hash === '#gerencia';
};

const money = (value: number | string) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(Number(value || 0));

const methodLabel = (method?: string) => {
  if (method === 'debito') return 'Débito';
  if (method === 'credito') return 'Crédito';
  if (method === 'pix') return 'Pix';
  if (method === 'voucher') return 'Voucher';
  if (method === 'dinheiro') return 'Dinheiro';
  return method || 'Pagamento';
};

const STATE_LABEL: Record<OperationalState, string> = {
  em_preparo: 'Em preparo',
  pronto: 'Pronto',
  aguardando_pagamento: 'Aguardando pagamento',
  pagamento_processando: 'Pagamento em processamento',
  aprovado_pendente_liquidacao: 'Aprovado, aguardando liquidação',
};

const Card = ({ row }: { row: CashProjection }) => {
  const payment = row.pagamento;
  const isProcessing = row.estado_operacional === 'pagamento_processando';
  const isSettlementPending = row.estado_operacional === 'aprovado_pendente_liquidacao';

  return (
    <div className="rounded-xl border border-koma-border bg-koma-page p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block truncate text-sm">Mesa {row.mesa_id}</strong>
          <p className="mt-0.5 text-[10px] text-koma-subtle">
            {row.itens_preparando > 0
              ? `${row.itens_preparando} em preparo · ${row.itens_prontos} prontos`
              : `${row.itens_ativos} item${row.itens_ativos === 1 ? '' : 's'}`}
          </p>
        </div>
        <strong className="shrink-0 text-sm text-koma-accent">{money(row.saldo)}</strong>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${
          isSettlementPending
            ? 'bg-amber-500/15 text-amber-300'
            : isProcessing
              ? 'bg-sky-500/15 text-sky-300'
              : 'bg-koma-surface text-koma-muted'
        }`}>
          {STATE_LABEL[row.estado_operacional]}
        </span>
        {payment && (
          <span className="truncate text-[10px] text-koma-muted">{methodLabel(payment.metodo)}</span>
        )}
      </div>

      {payment && (payment.provider || payment.terminal_id) && (
        <p className="mt-2 truncate font-mono text-[9px] text-koma-subtle">
          {[payment.provider, payment.terminal_id].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
};

export default function SmartPosCashSupervisor() {
  const [rows, setRows] = useState<CashProjection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const visible = typeof window !== 'undefined' && isCashRoute();
  const token = visible ? localStorage.getItem('koma_caixa_token') : null;

  const load = useCallback(async (silent = false) => {
    const currentToken = localStorage.getItem('koma_caixa_token');
    if (!visible || !currentToken) return;
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/smartpos/caixa/operacao`, {
        headers: { Authorization: `Bearer ${currentToken}` },
        cache: 'no-store',
      });
      if (response.status === 401 || response.status === 403) {
        setRows([]);
        setError('');
        return;
      }
      if (!response.ok) throw new Error('Não foi possível ler a operação SmartPOS.');
      const data = await response.json();
      setRows(Array.isArray(data) ? data : []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'SmartPOS indisponível.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !token) return;
    void load();
    const timer = window.setInterval(() => void load(true), 4000);
    const refresh = () => void load(true);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load, token, visible]);

  const preparationRows = useMemo(
    () => rows.filter((row) => row.estado_operacional === 'em_preparo' || row.estado_operacional === 'pronto'),
    [rows],
  );
  const collectionRows = useMemo(
    () => rows.filter((row) => row.estado_operacional === 'aguardando_pagamento'),
    [rows],
  );
  const processingRows = useMemo(
    () => rows.filter((row) => (
      row.estado_operacional === 'pagamento_processando'
      || row.estado_operacional === 'aprovado_pendente_liquidacao'
    )),
    [rows],
  );
  const settlementAttention = useMemo(
    () => rows.filter((row) => row.estado_operacional === 'aprovado_pendente_liquidacao').length,
    [rows],
  );

  if (!visible || !token) return null;

  return (
    <aside className={`fixed bottom-4 right-4 z-[90] overflow-hidden rounded-2xl border border-koma-border bg-koma-surface/95 shadow-2xl backdrop-blur transition-all ${
      expanded
        ? 'w-[min(980px,calc(100vw-2rem))]'
        : 'w-[min(380px,calc(100vw-2rem))]'
    }`}>
      <div className="flex items-center justify-between gap-3 border-b border-koma-border px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <CreditCard size={17} className="shrink-0 text-koma-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-black uppercase tracking-wide">Operação SmartPOS</p>
            <p className="truncate text-[10px] text-koma-muted">
              {rows.length} mesa{rows.length === 1 ? '' : 's'} · {processingRows.length} pagamento{processingRows.length === 1 ? '' : 's'} em curso
            </p>
          </div>
          {settlementAttention > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[9px] font-black text-amber-300">
              {settlementAttention} atenção
            </span>
          )}
          {expanded ? <ChevronDown size={15} className="shrink-0 text-koma-muted" /> : <ChevronUp size={15} className="shrink-0 text-koma-muted" />}
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Atualizar SmartPOS"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-koma-border text-koma-muted disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {error ? (
        <div className="p-3">
          <p className="flex items-start gap-2 rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-xs text-red-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        </div>
      ) : expanded ? (
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto p-3 md:grid-cols-3">
          <section className="min-w-0 rounded-xl border border-koma-border bg-koma-surface/60 p-2.5">
            <header className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                <ChefHat size={15} className="text-koma-muted" />
                <div>
                  <strong className="block text-xs">Em preparo</strong>
                  <span className="text-[9px] text-koma-subtle">Produção ainda não concluída</span>
                </div>
              </div>
              <span className="text-xs font-black text-koma-muted">{preparationRows.length}</span>
            </header>
            <div className="grid gap-2">
              {preparationRows.length ? preparationRows.map((row) => <Card key={row.mesa_id} row={row} />) : (
                <p className="rounded-xl border border-dashed border-koma-border p-3 text-center text-[10px] text-koma-subtle">Nenhuma mesa em preparo.</p>
              )}
            </div>
          </section>

          <section className="min-w-0 rounded-xl border border-koma-border bg-koma-surface/60 p-2.5">
            <header className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                <CircleDollarSign size={15} className="text-koma-muted" />
                <div>
                  <strong className="block text-xs">Aguardando pagamento</strong>
                  <span className="text-[9px] text-koma-subtle">Consumo pronto com saldo aberto</span>
                </div>
              </div>
              <span className="text-xs font-black text-koma-muted">{collectionRows.length}</span>
            </header>
            <div className="grid gap-2">
              {collectionRows.length ? collectionRows.map((row) => <Card key={row.mesa_id} row={row} />) : (
                <p className="rounded-xl border border-dashed border-koma-border p-3 text-center text-[10px] text-koma-subtle">Nenhuma mesa aguardando cobrança.</p>
              )}
            </div>
          </section>

          <section className="min-w-0 rounded-xl border border-koma-border bg-koma-surface/60 p-2.5">
            <header className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                <WalletCards size={15} className="text-koma-muted" />
                <div>
                  <strong className="block text-xs">Pagamento</strong>
                  <span className="text-[9px] text-koma-subtle">Terminal, confirmação e liquidação</span>
                </div>
              </div>
              <span className="text-xs font-black text-koma-muted">{processingRows.length}</span>
            </header>
            <div className="grid gap-2">
              {processingRows.length ? processingRows.map((row) => <Card key={row.mesa_id} row={row} />) : (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-koma-border p-3 text-[10px] text-koma-subtle">
                  <CheckCircle2 size={14} className="shrink-0 text-koma-accent" />
                  Nenhum pagamento SmartPOS em processamento.
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="p-3">
          {processingRows.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-koma-border px-3 py-2.5 text-xs text-koma-muted">
              <CheckCircle2 size={15} className="shrink-0 text-koma-accent" />
              Nenhum pagamento SmartPOS pendente.
            </div>
          ) : (
            <div className="grid gap-2">
              {processingRows.slice(0, 3).map((row) => <Card key={row.mesa_id} row={row} />)}
              {processingRows.length > 3 && (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="rounded-xl border border-koma-border px-3 py-2 text-xs font-semibold text-koma-muted"
                >
                  Ver mais {processingRows.length - 3}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
