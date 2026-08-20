import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  Loader2,
  RefreshCw,
  Share2,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import type { SmartPosSession } from './smartPosSession';

type RecentOperation = {
  intent_id: string;
  mesa_id: number | null;
  mesa_nome: string;
  operador_id: string;
  operador_nome: string;
  amount: string;
  method: string;
  capture: string;
  status: string;
  created_at: string;
  status_at: string;
  settled_at?: string | null;
  provider?: string | null;
  terminal_id?: string | null;
  provider_reference?: string | null;
  provider_last_error?: string | null;
  payment_id?: string | null;
};

type Props = {
  session: SmartPosSession;
  restauranteNome: string;
  onSessionInvalid: () => void;
};

const methodLabels: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Crédito',
  voucher: 'Voucher',
};

const captureLabels: Record<string, string> = {
  provider_integrado: 'Terminal integrado',
  registro_externo: 'Outra maquininha',
  dinheiro_pendente: 'Conferência manual',
};

const statusLabels: Record<string, string> = {
  criada: 'Aguardando terminal',
  pendente: 'Pendente',
  processando: 'Processando',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  cancelada: 'Cancelada',
  expirada: 'Expirada',
};

function money(value: string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function dateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function statusTone(status: string) {
  if (status === 'aprovada') return 'text-koma-accent';
  if (status === 'recusada' || status === 'cancelada' || status === 'expirada') return 'text-red-300';
  return 'text-yellow-300';
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'aprovada') return <CheckCircle2 size={18} />;
  if (status === 'recusada' || status === 'cancelada' || status === 'expirada') return <XCircle size={18} />;
  return <Clock3 size={18} />;
}

function receiptText(operation: RecentOperation, restauranteNome: string) {
  return [
    'KÔMA · COMPROVANTE OPERACIONAL',
    restauranteNome,
    '',
    `Operação: ${operation.intent_id}`,
    `Data: ${dateTime(operation.created_at)}`,
    `Mesa: ${operation.mesa_nome}`,
    `Operador: ${operation.operador_nome}`,
    `Forma: ${methodLabels[operation.method] || operation.method}`,
    `Captura: ${captureLabels[operation.capture] || operation.capture}`,
    `Valor: ${money(operation.amount)}`,
    `Status: ${statusLabels[operation.status] || operation.status}`,
    operation.payment_id ? `Pagamento Kôma: ${operation.payment_id}` : '',
    operation.provider_reference ? `Referência do terminal: ${operation.provider_reference}` : '',
    '',
    'Documento operacional, não fiscal e não substitui o comprovante da adquirente.',
  ].filter(Boolean).join('\n');
}

export default function SmartPosHistory({ session, restauranteNome, onSessionInvalid }: Props) {
  const [operations, setOperations] = useState<RecentOperation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const selected = useMemo(
    () => operations.find((operation) => operation.intent_id === selectedId) || null,
    [operations, selectedId],
  );

  const load = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/auth/smartpos/payment-intents/recentes?limit=5`, {
        headers: { Authorization: `Bearer ${session.token}` },
        cache: 'no-store',
      });
      if (response.status === 401 || response.status === 403) {
        onSessionInvalid();
        return;
      }
      if (!response.ok) throw new Error('Não foi possível carregar as últimas operações.');
      const data = (await response.json()) as RecentOperation[];
      setOperations(data);
      setSelectedId((current) => data.some((item) => item.intent_id === current) ? current : '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o histórico.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session.token]);

  const shareReceipt = async () => {
    if (!selected) return;
    const text = receiptText(selected, restauranteNome);
    setFeedback('');
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Comprovante operacional Kôma', text });
        setFeedback('Comprovante compartilhado.');
        return;
      }
      await navigator.clipboard.writeText(text);
      setFeedback('Comprovante copiado.');
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      setFeedback('Não foi possível compartilhar; use Baixar comprovante.');
    }
  };

  const downloadReceipt = () => {
    if (!selected) return;
    const blob = new Blob([receiptText(selected, restauranteNome)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `koma-comprovante-${selected.intent_id.slice(0, 8)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setFeedback('Comprovante baixado.');
  };

  if (selected) {
    return (
      <section className="pt-6">
        <button type="button" onClick={() => { setSelectedId(''); setFeedback(''); }} className="text-xs font-bold text-koma-muted">← Últimas operações</button>
        <p className="mt-6 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Comprovante operacional</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{money(selected.amount)}</h1>
        <div className="mt-5 rounded-2xl border border-koma-border bg-koma-surface p-5">
          <div className={`flex items-center gap-2 text-sm font-black ${statusTone(selected.status)}`}>
            <StatusIcon status={selected.status} />
            {statusLabels[selected.status] || selected.status}
          </div>
          <dl className="mt-5 grid gap-3 border-t border-koma-border pt-4 text-xs">
            {[
              ['Data', dateTime(selected.created_at)],
              ['Mesa', selected.mesa_nome],
              ['Operador', selected.operador_nome],
              ['Forma', methodLabels[selected.method] || selected.method],
              ['Captura', captureLabels[selected.capture] || selected.capture],
              ['Pagamento', selected.payment_id || 'Ainda sem baixa financeira'],
              ['Referência', selected.provider_reference || '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4">
                <dt className="text-koma-muted">{label}</dt>
                <dd className="max-w-[65%] break-all text-right font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          {selected.provider_last_error && (
            <p className="mt-4 rounded-xl border border-yellow-800/50 bg-yellow-950/20 px-3 py-2 text-xs text-yellow-200">{selected.provider_last_error}</p>
          )}
          <p className="mt-5 border-t border-koma-border pt-4 text-[10px] leading-4 text-koma-muted">Documento operacional, não fiscal e não substitui o comprovante da adquirente.</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => void shareReceipt()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-koma-accent px-3 text-xs font-black text-black"><Share2 size={16} /> Compartilhar</button>
          <button type="button" onClick={downloadReceipt} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-koma-border px-3 text-xs font-black text-koma-muted"><Download size={16} /> Baixar</button>
        </div>
        {feedback && <p className="mt-3 text-center text-xs text-koma-muted">{feedback}</p>}
      </section>
    );
  }

  return (
    <section className="pt-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Operação e suporte</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Últimas 5</h1>
        </div>
        <button type="button" onClick={() => void load()} disabled={isLoading} className="flex size-10 items-center justify-center rounded-xl border border-koma-border text-koma-muted" aria-label="Atualizar histórico"><RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} /></button>
      </div>

      {isLoading && operations.length === 0 && <div className="mt-8 flex items-center justify-center gap-2 text-sm text-koma-muted"><Loader2 size={18} className="animate-spin" /> Carregando…</div>}
      {error && <p role="alert" className="mt-5 flex items-start gap-2 rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-3 text-xs text-red-300"><TriangleAlert size={16} className="shrink-0" /> {error}</p>}
      {!isLoading && !error && operations.length === 0 && <div className="mt-5 rounded-2xl border border-koma-border bg-koma-surface p-5 text-sm text-koma-muted">Ainda não há operações nesta maquininha.</div>}
      <div className="mt-5 grid gap-3">
        {operations.map((operation) => (
          <button key={operation.intent_id} type="button" onClick={() => setSelectedId(operation.intent_id)} className="flex min-h-20 items-center gap-3 rounded-2xl border border-koma-border bg-koma-surface px-4 py-3 text-left">
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl border border-koma-border bg-koma-page ${statusTone(operation.status)}`}><StatusIcon status={operation.status} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><strong className="truncate text-sm">{operation.mesa_nome}</strong><strong className="shrink-0 text-sm">{money(operation.amount)}</strong></span>
              <span className="mt-1 block truncate text-[10px] text-koma-muted">{methodLabels[operation.method] || operation.method} · {statusLabels[operation.status] || operation.status} · {dateTime(operation.created_at)}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-koma-muted" />
          </button>
        ))}
      </div>
    </section>
  );
}
