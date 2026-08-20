import React, { useState } from 'react';
import {
  Banknote,
  Check,
  ChevronRight,
  CreditCard,
  History,
  Loader2,
  QrCode,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import type { SmartPosSession } from './smartPosSession';

type QuickSale = {
  id: string;
  numeroPedido: number;
  total: number;
  paymentKey: string;
};

type Method = 'dinheiro' | 'pix' | 'debito' | 'credito';

type Props = {
  session: SmartPosSession;
  sale: QuickSale;
  onSessionInvalid: () => void;
  onNewSale: () => void;
  onOpenHistory: () => void;
};

const methodDetails: Record<Method, { label: string; backend: string; external: boolean }> = {
  dinheiro: { label: 'Dinheiro', backend: 'dinheiro', external: false },
  pix: { label: 'Pix', backend: 'pix', external: true },
  debito: { label: 'Débito', backend: 'cartao_debito', external: true },
  credito: { label: 'Crédito', backend: 'cartao_credito', external: true },
};

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(value) ? value : 0);
}

export default function SmartPosQuickSalePayment({
  session,
  sale,
  onSessionInvalid,
  onNewSale,
  onOpenHistory,
}: Props) {
  const [method, setMethod] = useState<Method | null>(null);
  const [paymentId, setPaymentId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submitPayment = async () => {
    if (!method || isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/caixa/comandas/${encodeURIComponent(sale.id)}/pagar`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valor: Number(sale.total.toFixed(2)),
          metodo: methodDetails[method].backend,
          idempotency_key: sale.paymentKey,
          origem: 'smartpos',
        }),
      });
      if (response.status === 401) {
        onSessionInvalid();
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.detail || 'Não foi possível registrar o pagamento.');
      }
      if (result?.status !== 'aprovado') {
        throw new Error('O pagamento ainda não foi aprovado pelo Kôma.');
      }
      setPaymentId(String(result.id || ''));
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Falha ao registrar pagamento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (paymentId) {
    return (
      <section className="pt-7">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-koma-accent text-black"><Check size={26} /></span>
        <p className="mt-6 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Venda concluída</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{money(sale.total)}</h1>
        <div className="mt-5 rounded-2xl border border-koma-border bg-koma-surface p-4">
          <div className="flex items-center justify-between gap-3 text-sm"><span className="text-koma-muted">Pedido</span><strong>#{sale.numeroPedido}</strong></div>
          <div className="mt-3 flex items-center justify-between gap-3 text-sm"><span className="text-koma-muted">Forma</span><strong>{method ? methodDetails[method].label : 'Pagamento'}</strong></div>
          <p className="mt-4 truncate border-t border-koma-border pt-3 font-mono text-[9px] text-koma-muted">Pagamento {paymentId}</p>
        </div>
        <button type="button" onClick={onNewSale} className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-koma-accent px-4 text-sm font-black text-black"><ShoppingBag size={18} /> Nova venda rápida</button>
        <button type="button" onClick={onOpenHistory} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-koma-border px-4 text-xs font-black text-koma-muted"><History size={16} /> Ver últimas operações</button>
      </section>
    );
  }

  if (method) {
    const detail = methodDetails[method];
    return (
      <section className="pt-7">
        <button type="button" onClick={() => { setMethod(null); setError(''); }} className="text-xs font-bold text-koma-muted">← Formas de pagamento</button>
        <p className="mt-6 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Confirmar recebimento</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{money(sale.total)}</h1>
        <div className="mt-5 rounded-2xl border border-koma-border bg-koma-surface p-4">
          <div className="flex items-center justify-between gap-3 text-sm"><span className="text-koma-muted">Pedido</span><strong>#{sale.numeroPedido}</strong></div>
          <div className="mt-3 flex items-center justify-between gap-3 text-sm"><span className="text-koma-muted">Forma</span><strong>{detail.label}</strong></div>
          <p className="mt-4 border-t border-koma-border pt-3 text-xs leading-5 text-koma-muted">
            {detail.external
              ? 'Faça a cobrança no dispositivo externo e só confirme depois da aprovação.'
              : 'Confira o valor entregue antes de confirmar o recebimento em dinheiro.'}
          </p>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</p>}
        <button type="button" onClick={() => void submitPayment()} disabled={isSubmitting} className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-koma-accent px-4 text-sm font-black text-black disabled:cursor-wait disabled:opacity-60">
          {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          {isSubmitting ? 'Registrando…' : detail.external ? 'Confirmar cobrança aprovada' : 'Confirmar dinheiro recebido'}
        </button>
        {error && <button type="button" onClick={() => void submitPayment()} disabled={isSubmitting} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-koma-border text-xs font-bold text-koma-muted"><RefreshCw size={15} /> Tentar novamente</button>}
      </section>
    );
  }

  const methods = [
    { id: 'dinheiro' as const, label: 'Dinheiro', detail: 'Conferência no celular', icon: Banknote },
    { id: 'pix' as const, label: 'Pix', detail: 'Cobrado fora do Kôma', icon: QrCode },
    { id: 'debito' as const, label: 'Débito', detail: 'Outra maquininha', icon: CreditCard },
    { id: 'credito' as const, label: 'Crédito', detail: 'Outra maquininha', icon: CreditCard },
  ];

  return (
    <section className="pt-7">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Receber venda rápida</p>
      <div className="mt-2 flex items-end justify-between gap-3"><h1 className="text-3xl font-black tracking-[-0.04em]">Pedido #{sale.numeroPedido}</h1><strong className="text-sm text-koma-accent">{money(sale.total)}</strong></div>
      <p className="mt-2 text-xs leading-5 text-koma-muted">O pedido já foi enviado para produção. Agora registre o recebimento.</p>
      <div className="mt-6 grid gap-3">
        {methods.map(({ id, label, detail, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setMethod(id)} className="flex min-h-20 items-center gap-4 rounded-2xl border border-koma-border bg-koma-surface px-4 text-left">
            <span className="flex size-11 items-center justify-center rounded-xl border border-koma-border bg-koma-page text-koma-accent"><Icon size={21} /></span>
            <span className="min-w-0 flex-1"><span className="block text-base font-black">{label}</span><span className="mt-1 block text-[10px] font-medium text-koma-muted">{detail}</span></span>
            <ChevronRight size={18} className="text-koma-muted" />
          </button>
        ))}
      </div>
    </section>
  );
}
