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

type Metodo = 'dinheiro' | 'pix' | 'debito' | 'credito';
type Captura = 'provider_integrado' | 'registro_externo' | 'dinheiro_pendente';
type Escopo = 'valor' | 'itens';
type Step = 'valor' | 'metodo' | 'captura' | 'revisao' | 'pronto';

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

const methodLabels: Record<Metodo, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Crédito',
};

const captureLabels: Record<Captura, string> = {
  provider_integrado: 'Nesta maquininha',
  registro_externo: 'Outra maquininha',
  dinheiro_pendente: 'Conferência manual',
};

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
  const [captureMode, setCaptureMode] = useState<Captura | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingManual, setIsConfirmingManual] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [manualReceived, setManualReceived] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [changeCents, setChangeCents] = useState(0);
  const [manualSettled, setManualSettled] = useState(false);
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
    setError('');
    if (nextMethod === 'dinheiro') {
      setCaptureMode('dinheiro_pendente');
      setStep('revisao');
      return;
    }
    setCaptureMode(null);
    setStep('captura');
  };

  const chooseCapture = (nextCapture: 'provider_integrado' | 'registro_externo') => {
    setCaptureMode(nextCapture);
    setError('');
    setStep('revisao');
  };

  const submitIntent = async () => {
    if (!method || !captureMode || amountCents <= 0) return;
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
          captura: captureMode === 'dinheiro_pendente' ? undefined : captureMode,
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
      if (data.captura === 'registro_externo') {
        setCaptureMode('registro_externo');
      } else if (data.captura === 'dinheiro_pendente') {
        setCaptureMode('dinheiro_pendente');
      } else {
        setCaptureMode('provider_integrado');
      }
      setStep('pronto');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o recebimento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelPaymentIntent = async () => {
    if (!intentId || manualSettled) return;
    setIsCancelling(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/auth/smartpos/payment-intents/${encodeURIComponent(intentId)}/cancelar`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idempotency_key: `${idempotencyKey || intentId}:cancel`,
          motivo: 'Cancelado pelo operador na maquininha antes da cobrança.',
        }),
      });
      if (response.status === 401 || response.status === 403) {
        onSessionInvalid();
        return;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || 'Não foi possível cancelar o recebimento.');
      onBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível cancelar o recebimento.');
    } finally {
      setIsCancelling(false);
    }
  };

  const confirmManualPayment = async () => {
    if (!intentId || captureMode === 'provider_integrado') return;
    setIsConfirmingManual(true);
    setError('');
    try {
      const confirmationKey = `${idempotencyKey || intentId}:confirm`;
      const receivedNumber = Number(String(manualReceived || '').replace(',', '.'));
      const response = await fetch(`${API_BASE_URL}/auth/smartpos/payment-intents/${encodeURIComponent(intentId)}/confirmar-manual`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idempotency_key: confirmationKey,
          valor_recebido: captureMode === 'dinheiro_pendente'
            ? (Number.isFinite(receivedNumber) && receivedNumber > 0 ? receivedNumber.toFixed(2) : (amountCents / 100).toFixed(2))
            : undefined,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        onSessionInvalid();
        return;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || 'Não foi possível confirmar o recebimento.');
      setPaymentId(String(data.payment_id || ''));
      setChangeCents(Math.round(Number(data.troco || 0) * 100));
      setManualSettled(Boolean(data.settled));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar o recebimento.');
    } finally {
      setIsConfirmingManual(false);
    }
  };

  const methodLabel = method ? methodLabels[method] : '';
  const remainingAfterCurrentCents = Math.max(0, balanceCents - amountCents);

  if (step === 'pronto') {
    const manualCapture = captureMode === 'dinheiro_pendente' || captureMode === 'registro_externo';
    return (
      <section className="pt-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Recebimento</p>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{manualSettled ? 'Pagamento concluído' : manualCapture ? 'Confirmar pagamento' : 'Aguardando maquininha'}</h1>
          </div>
          <span className="flex size-11 items-center justify-center rounded-full bg-koma-accent text-black"><Check size={22} /></span>
        </div>
        <div className="mt-7 rounded-2xl border border-koma-border bg-koma-surface p-5">
          <p className="text-xs uppercase tracking-wide text-koma-muted">{mesa.nome || `Mesa ${mesa.id}`}</p>
          <p className="mt-2 text-3xl font-black">{money(amountCents)}</p>
          <div className="mt-4 grid gap-2 border-t border-koma-border pt-4 text-sm">
            <div className="flex items-center justify-between gap-3"><span className="text-koma-muted">Forma</span><strong>{methodLabel}</strong></div>
            {captureMode && <div className="flex items-center justify-between gap-3"><span className="text-koma-muted">Captura</span><strong>{captureLabels[captureMode]}</strong></div>}
          </div>

          {!manualSettled && captureMode === 'dinheiro_pendente' && (
            <label className="mt-5 block border-t border-koma-border pt-4">
              <span className="text-xs font-bold text-koma-muted">Valor entregue pelo cliente</span>
              <input
                inputMode="decimal"
                value={manualReceived}
                onChange={(event) => setManualReceived(event.target.value)}
                placeholder={(amountCents / 100).toFixed(2).replace('.', ',')}
                className="mt-2 min-h-14 w-full rounded-xl border border-koma-border bg-koma-page px-4 text-xl font-black outline-none focus:border-koma-accent"
              />
            </label>
          )}

          {!manualSettled && manualCapture && (
            <button
              type="button"
              onClick={() => void confirmManualPayment()}
              disabled={isConfirmingManual}
              className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-koma-accent px-4 text-sm font-black text-black disabled:opacity-60"
            >
              {isConfirmingManual ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              {isConfirmingManual ? 'Confirmando…' : captureMode === 'dinheiro_pendente' ? 'Receber dinheiro' : 'Confirmar pagamento externo'}
            </button>
          )}

          {manualSettled && changeCents > 0 && (
            <p className="mt-5 rounded-xl border border-koma-accent/30 bg-koma-accent/10 px-4 py-3 text-center text-sm font-black text-koma-accent">Troco: {money(changeCents)}</p>
          )}
          {manualSettled && remainingAfterCurrentCents > 0 && (
            <div className="mt-4 rounded-xl border border-koma-border bg-koma-page px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-koma-muted">Restante da mesa</p>
              <p className="mt-1 text-xl font-black text-koma-accent">{money(remainingAfterCurrentCents)}</p>
            </div>
          )}
          {!manualCapture && !manualSettled && (
            <p className="mt-5 border-t border-koma-border pt-4 text-xs text-koma-muted">A cobrança integrada será processada pelo aplicativo Android da maquininha. Depois que o terminal assumir a operação, o cancelamento fica bloqueado e o resultado precisa ser reconciliado.</p>
          )}
          {!manualSettled && intentId && (
            <button
              type="button"
              onClick={() => void cancelPaymentIntent()}
              disabled={isCancelling || isConfirmingManual}
              className="mt-3 min-h-12 w-full rounded-xl border border-red-900/60 px-4 text-xs font-black text-red-300 disabled:opacity-50"
            >
              {isCancelling ? 'Cancelando…' : 'Cancelar recebimento'}
            </button>
          )}
          {error && <p role="alert" className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</p>}
          {(paymentId || intentId) && <p className="mt-3 truncate font-mono text-[9px] text-koma-muted">{paymentId ? `Pagamento ${paymentId}` : intentId}</p>}
        </div>
        <button type="button" onClick={onBack} className="mt-5 min-h-14 w-full rounded-xl border border-koma-border px-4 text-sm font-black text-koma-muted">{manualSettled && remainingAfterCurrentCents > 0 ? 'Voltar e receber outra parte' : 'Voltar para a mesa'}</button>
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
            {captureMode && <div className="mt-3 flex items-center justify-between gap-3 text-sm"><span className="text-koma-muted">Captura</span><strong>{captureLabels[captureMode]}</strong></div>}
            <div className="mt-3 flex items-center justify-between gap-3 text-sm"><span className="text-koma-muted">Escopo</span><strong>{scope === 'itens' ? `${selectedItemIds.length} item(ns)` : 'Por valor'}</strong></div>
          </div>
          {captureMode === 'registro_externo' && (
            <p className="rounded-xl border border-koma-border bg-koma-surface px-3 py-3 text-xs text-koma-muted">Esta etapa apenas registra que a cobrança será feita em outra maquininha. Ainda não há baixa financeira.</p>
          )}
          {error && <p role="alert" className="rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</p>}
          <button type="button" onClick={() => void submitIntent()} disabled={isSubmitting} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-koma-accent px-4 text-sm font-black text-black disabled:opacity-60">
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <CircleDollarSign size={18} />}
            {isSubmitting ? 'Preparando…' : 'Preparar pagamento'}
          </button>
          <button type="button" onClick={() => setStep(method === 'dinheiro' ? 'metodo' : 'captura')} disabled={isSubmitting} className="min-h-12 rounded-xl border border-koma-border text-sm font-bold text-koma-muted">Voltar</button>
        </div>
      </section>
    );
  }

  if (step === 'captura') {
    return (
      <section className="pt-7">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Onde será cobrado?</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{methodLabel}</h1>
        <p className="mt-2 text-sm text-koma-muted">{money(amountCents)}</p>
        <div className="mt-6 grid gap-3">
          <button type="button" onClick={() => chooseCapture('provider_integrado')} className="flex min-h-20 items-center gap-4 rounded-2xl border border-koma-border bg-koma-surface px-4 text-left">
            <span className="flex size-11 items-center justify-center rounded-xl border border-koma-border bg-koma-page text-koma-accent"><CreditCard size={21} /></span>
            <span className="min-w-0 flex-1"><span className="block text-base font-black">Nesta maquininha</span><span className="mt-1 block text-[10px] font-medium text-koma-muted">Fluxo reservado para a integração do próprio terminal.</span></span>
            <ChevronRight size={18} className="text-koma-muted" />
          </button>
          <button type="button" onClick={() => chooseCapture('registro_externo')} className="flex min-h-20 items-center gap-4 rounded-2xl border border-koma-border bg-koma-surface px-4 text-left">
            <span className="flex size-11 items-center justify-center rounded-xl border border-koma-border bg-koma-page text-koma-accent"><ReceiptText size={21} /></span>
            <span className="min-w-0 flex-1"><span className="block text-base font-black">Outra maquininha</span><span className="mt-1 block text-[10px] font-medium text-koma-muted">Registra o meio usado em um dispositivo externo.</span></span>
            <ChevronRight size={18} className="text-koma-muted" />
          </button>
          <button type="button" onClick={() => setStep('metodo')} className="min-h-12 rounded-xl border border-koma-border text-sm font-bold text-koma-muted">Voltar</button>
        </div>
      </section>
    );
  }

  if (step === 'metodo') {
    const methods = [
      { id: 'dinheiro' as const, label: 'Dinheiro', detail: 'Conferência manual', icon: Banknote },
      { id: 'pix' as const, label: 'Pix', detail: 'Escolher onde será cobrado', icon: QrCode },
      { id: 'debito' as const, label: 'Débito', detail: 'Escolher onde será cobrado', icon: CreditCard },
      { id: 'credito' as const, label: 'Crédito', detail: 'Escolher onde será cobrado', icon: CreditCard },
    ];
    return (
      <section className="pt-7">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Forma de pagamento</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{money(amountCents)}</h1>
        <div className="mt-6 grid gap-3">
          {methods.map(({ id, label, detail, icon: Icon }) => (
            <button key={id} type="button" onClick={() => chooseMethod(id)} className="flex min-h-20 items-center gap-4 rounded-2xl border border-koma-border bg-koma-surface px-4 text-left">
              <span className="flex size-11 items-center justify-center rounded-xl border border-koma-border bg-koma-page text-koma-accent"><Icon size={21} /></span>
              <span className="min-w-0 flex-1"><span className="block text-base font-black">{label}</span><span className="mt-1 block text-[10px] font-medium text-koma-muted">{detail}</span></span>
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
