import React, { useMemo, useState } from 'react';
import {
  Banknote,
  Check,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Delete,
  Loader2,
  QrCode,
  ReceiptText,
} from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import type { SmartPosSession } from './smartPosSession';


type Mesa = {
  id: number;
  nome?: string | null;
};

type Item = {
  id: string;
  preco_unit: number;
  cliente_nome?: string | null;
  status?: string | null;
  pago?: boolean;
  produto?: { nome?: string | null } | null;
};

type Comanda = {
  id: string;
  valor_pago: number;
  itens: Item[];
};

type Metodo = 'dinheiro' | 'pix' | 'cartao';
type Escopo = 'valor' | 'itens';
type Step = 'valor' | 'metodo' | 'revisao' | 'pronto';

type Props = {
  session: SmartPosSession;
  mesa: Mesa;
  comandas: Comanda[];
  onBack: () => void;
  onSessionInvalid: () => void;
};

const money = (cents: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(Math.max(0, cents) / 100);

const activeItems = (comandas: Comanda[]) => comandas.flatMap((comanda) =>
  (comanda.itens || []).filter((item) => item.status !== 'cancelado'),
);

const makeIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `smartpos-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

export default function SmartPosPaymentFlow({
  session,
  mesa,
  comandas,
  onBack,
  onSessionInvalid,
}: Props) {
  const allItems = useMemo(() => activeItems(comandas), [comandas]);
  const totalCents = useMemo(
    () => allItems.reduce((sum, item) => sum + Math.round(Number(item.preco_unit || 0) * 100), 0),
    [allItems],
  );
  const paidCents = useMemo(
    () => comandas.reduce((sum, comanda) => sum + Math.round(Number(comanda.valor_pago || 0) * 100), 0),
    [comandas],
  );
  const balanceCents = Math.max(0, totalCents - paidCents);
  const selectableItems = useMemo(
    () => allItems.filter((item) => !item.pago),
    [allItems],
  );

  const [step, setStep] = useState<Step>('valor');
  const [scope, setScope] = useState<Escopo>('valor');
  const [digits, setDigits] = useState(String(balanceCents));
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [method, setMethod] = useState<Metodo | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [intentId, setIntentId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedItemsCents = selectableItems.reduce(
    (sum, item) => selectedItemIds.includes(item.id)
      ? sum + Math.round(Number(item.preco_unit || 0) * 100)
      : sum,
    0,
  );
  const amountCents = scope === 'itens'
    ? selectedItemsCents
    : Math.min(Number(digits || '0'), balanceCents + 1);

  const setTotal = () => setDigits(String(balanceCents));
  const clearAmount = () => setDigits('');
  const appendDigit = (digit: string) => {
    setDigits((current) => {
      const next = `${current}${digit}`.replace(/^0+(?=\d)/, '').slice(0, 10);
      return next || '0';
    });
  };
  const backspace = () => setDigits((current) => current.slice(0, -1));

  const toggleItem = (itemId: string) => {
    setSelectedItemIds((current) => current.includes(itemId)
      ? current.filter((id) => id !== itemId)
      : [...current, itemId]);
  };

  const continueFromValue = () => {
    setError('');
    if (amountCents <= 0) {
      setError(scope === 'itens' ? 'Selecione pelo menos um item.' : 'Informe um valor.');
      return;
    }
    if (amountCents > balanceCents) {
      setError('O valor não pode superar o saldo da mesa.');
      return;
    }
    setStep('metodo');
  };

  const chooseMethod = (nextMethod: Metodo) => {
    setMethod(nextMethod);
    setStep('revisao');
  };

  const submitIntent = async () => {
    if (!method || amountCents <= 0) return;
    setIsSubmitting(true);
    setError('');
    const key = idempotencyKey || makeIdempotencyKey();
    if (!idempotencyKey) setIdempotencyKey(key);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/smartpos/payment-intents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mesa_id: mesa.id,
          valor: (amountCents / 100).toFixed(2),
          metodo: method,
          escopo: scope,
          item_ids: scope === 'itens' ? selectedItemIds : null,
          idempotency_key: key,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        onSessionInvalid();
        return;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || 'Não foi possível preparar o recebimento.');
      }
      setIntentId(String(data.id || ''));
      setStep('pronto');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o recebimento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const methodLabel = method === 'dinheiro' ? 'Dinheiro' : method === 'pix' ? 'Pix' : 'Cartão';

  if (step === 'pronto') {
    return (
      <section className="pt-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Preview</p>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Intenção criada</h1>
          </div>
          <span className="flex size-11 items-center justify-center rounded-full bg-koma-accent text-black"><Check size={22} /></span>
        </div>
        <div className="mt-7 rounded-2xl border border-koma-border bg-koma-surface p-5">
          <p className="text-xs uppercase tracking-wide text-koma-muted">{mesa.nome || `Mesa ${mesa.id}`}</p>
          <p className="mt-2 text-3xl font-black">{money(amountCents)}</p>
          <p className="mt-2 text-sm font-bold">{methodLabel}</p>
          <p className="mt-5 border-t border-koma-border pt-4 text-xs text-koma-muted">Nenhuma cobrança ou baixa financeira foi realizada.</p>
          {intentId && <p className="mt-2 truncate font-mono text-[9px] text-koma-muted">{intentId}</p>}
        </div>
        <button type="button" onClick={onBack} className="mt-5 min-h-14 w-full rounded-xl bg-koma-accent px-4 text-sm font-black text-black">Voltar para a mesa</button>
      </section>
    );
  }

  if (step === 'revisao') {
    return (
      <section className="pt-7">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Revisar</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{money(amountCents)}</h1>
        <div className="mt-6 grid gap-3">
          <div className="rounded-2xl border border-koma-border bg-koma-surface p-4">
            <div className="flex items-center justify-between gap-3 text-sm"><span className="text-koma-muted">Mesa</span><strong>{mesa.nome || `Mesa ${mesa.id}`}</strong></div>
            <div className="mt-3 flex items-center justify-between gap-3 text-sm"><span className="text-koma-muted">Forma</span><strong>{methodLabel}</strong></div>
            <div className="mt-3 flex items-center justify-between gap-3 text-sm"><span className="text-koma-muted">Escopo</span><strong>{scope === 'itens' ? `${selectedItemIds.length} item(ns)` : 'Por valor'}</strong></div>
          </div>
          {error && <p role="alert" className="rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</p>}
          <button type="button" onClick={() => void submitIntent()} disabled={isSubmitting} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-koma-accent px-4 text-sm font-black text-black disabled:opacity-60">
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <CircleDollarSign size={18} />}
            {isSubmitting ? 'Preparando…' : 'Preparar pagamento'}
          </button>
          <button type="button" onClick={() => setStep('metodo')} disabled={isSubmitting} className="min-h-12 rounded-xl border border-koma-border text-sm font-bold text-koma-muted">Voltar</button>
        </div>
      </section>
    );
  }

  if (step === 'metodo') {
    const methods = [
      { id: 'dinheiro' as const, label: 'Dinheiro', icon: Banknote },
      { id: 'pix' as const, label: 'Pix', icon: QrCode },
      { id: 'cartao' as const, label: 'Cartão', icon: CreditCard },
    ];
    return (
      <section className="pt-7">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Forma de pagamento</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{money(amountCents)}</h1>
        <div className="mt-6 grid gap-3">
          {methods.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => chooseMethod(id)} className="flex min-h-20 items-center gap-4 rounded-2xl border border-koma-border bg-koma-surface px-4 text-left">
              <span className="flex size-11 items-center justify-center rounded-xl border border-koma-border bg-koma-page text-koma-accent"><Icon size={21} /></span>
              <span className="flex-1 text-base font-black">{label}</span>
              <ChevronRight size={18} className="text-koma-muted" />
            </button>
          ))}
          <button type="button" onClick={() => setStep('valor')} className="min-h-12 rounded-xl border border-koma-border text-sm font-bold text-koma-muted">Voltar</button>
        </div>
      </section>
    );
  }

  return (
    <section className="pt-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Receber</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{mesa.nome || `Mesa ${mesa.id}`}</h1>
        </div>
        <p className="text-sm font-black text-koma-accent">{money(balanceCents)}</p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 rounded-xl border border-koma-border bg-koma-surface p-1.5">
        <button type="button" onClick={() => { setScope('valor'); setError(''); }} className={`min-h-10 rounded-lg text-xs font-black ${scope === 'valor' ? 'bg-koma-accent text-black' : 'text-koma-muted'}`}>Por valor</button>
        <button type="button" onClick={() => { setScope('itens'); setError(''); }} className={`min-h-10 rounded-lg text-xs font-black ${scope === 'itens' ? 'bg-koma-accent text-black' : 'text-koma-muted'}`}>Por itens</button>
      </div>

      {scope === 'valor' ? (
        <>
          <div className="mt-6 text-center">
            <p className="text-xs uppercase tracking-wide text-koma-muted">Valor</p>
            <p className="mt-2 text-4xl font-black tracking-[-0.04em]">{money(Number(digits || '0'))}</p>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-2">
            {['1','2','3','4','5','6','7','8','9'].map((digit) => (
              <button key={digit} type="button" onClick={() => appendDigit(digit)} className="min-h-14 rounded-xl border border-koma-border bg-koma-surface text-lg font-black">{digit}</button>
            ))}
            <button type="button" onClick={clearAmount} className="min-h-14 rounded-xl border border-koma-border bg-koma-surface text-xs font-black text-koma-muted">Limpar</button>
            <button type="button" onClick={() => appendDigit('0')} className="min-h-14 rounded-xl border border-koma-border bg-koma-surface text-lg font-black">0</button>
            <button type="button" onClick={backspace} className="flex min-h-14 items-center justify-center rounded-xl border border-koma-border bg-koma-surface text-koma-muted" aria-label="Apagar"><Delete size={19} /></button>
          </div>
          <button type="button" onClick={setTotal} className="mt-2 min-h-11 w-full rounded-xl border border-koma-border text-xs font-black text-koma-accent">Usar total {money(balanceCents)}</button>
        </>
      ) : (
        <div className="mt-6 grid gap-2">
          {selectableItems.map((item) => {
            const selected = selectedItemIds.includes(item.id);
            return (
              <button key={item.id} type="button" onClick={() => toggleItem(item.id)} className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 text-left ${selected ? 'border-koma-accent bg-koma-surface' : 'border-koma-border bg-koma-surface'}`}>
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-koma-accent bg-koma-accent text-black' : 'border-koma-border text-koma-muted'}`}>{selected ? <Check size={16} /> : <ReceiptText size={15} />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-black">{item.produto?.nome || 'Item'}</span><span className="mt-1 block text-[10px] text-koma-muted">{item.cliente_nome || 'Consumo geral'}</span></span>
                <strong className="text-xs">{money(Math.round(Number(item.preco_unit || 0) * 100))}</strong>
              </button>
            );
          })}
          <div className="mt-2 flex items-center justify-between rounded-xl border border-koma-border px-4 py-3"><span className="text-xs text-koma-muted">Selecionado</span><strong>{money(selectedItemsCents)}</strong></div>
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</p>}
      <button type="button" onClick={continueFromValue} className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-koma-accent px-4 text-sm font-black text-black">Continuar <ChevronRight size={17} /></button>
      <button type="button" onClick={onBack} className="mt-2 min-h-12 w-full rounded-xl border border-koma-border text-sm font-bold text-koma-muted">Cancelar</button>
    </section>
  );
}
