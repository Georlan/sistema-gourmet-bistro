import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, Search, X } from 'lucide-react';
import { MoneyInput } from '../MoneyInput';
import {
  RefundablePayment,
  estornarPagamento,
  listarPagamentosEstornaveis,
} from '../../config/caixaService';
import { formatBackendDateTime } from '../../utils/dateTime';

interface EstornoModalProps {
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const methodLabel: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao: 'Cartão',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
};

const normalizeCardMethod = (method: string) => (
  ['cartao', 'cartao_credito', 'cartao_debito'].includes(method) ? 'cartao' : method
);

export const EstornoModal: React.FC<EstornoModalProps> = ({ onClose, onSuccess }) => {
  const [payments, setPayments] = useState<RefundablePayment[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [value, setValue] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('');
  const [originValues, setOriginValues] = useState<Record<string, number | ''>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = payments.find(payment => payment.id === selectedId) || null;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listarPagamentosEstornaveis();
      setPayments(data);
      if (selectedId && !data.some(payment => payment.id === selectedId)) {
        setSelectedId('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar pagamentos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selected) {
      setValue('');
      setReason('');
      setPayoutMethod('');
      setOriginValues({});
      return;
    }
    setValue(selected.saldo_estornavel);
    setPayoutMethod(selected.metodo_original);
    setReason('');
    setOriginValues({});
    setError(null);
  }, [selectedId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return payments;
    return payments.filter(payment => [
      payment.origem,
      payment.metodo_original,
      payment.id,
      payment.numero_pedido,
      payment.mesa_id,
      ...payment.origens_financeiras.map(origin => origin.label),
    ].some(value => String(value ?? '').toLowerCase().includes(term)));
  }, [payments, search]);

  const multipleOrigins = (selected?.origens_financeiras?.filter(origin => origin.saldo_estornavel > 0).length || 0) > 1;
  const refundValue = Number(value || 0);
  const isFullRemaining = !!selected && Math.abs(refundValue - selected.saldo_estornavel) < 0.005;
  const explicitOriginTotal = Object.values(originValues).reduce<number>(
    (total, current) => total + Number(current || 0),
    0,
  );
  const needsOriginAllocation = multipleOrigins && !isFullRemaining;
  const payoutDiffers = !!selected && normalizeCardMethod(payoutMethod) !== normalizeCardMethod(selected.metodo_original);

  const submit = async () => {
    if (!selected || submitting) return;
    setError(null);
    if (refundValue <= 0 || refundValue > selected.saldo_estornavel + 0.005) {
      setError(`Informe um valor entre R$ 0,01 e ${currency.format(selected.saldo_estornavel)}.`);
      return;
    }
    if (reason.trim().length < 5) {
      setError('Informe uma justificativa com pelo menos 5 caracteres.');
      return;
    }
    if (needsOriginAllocation && Math.abs(explicitOriginTotal - refundValue) >= 0.005) {
      setError('Distribua exatamente o valor do estorno entre as Contas de origem.');
      return;
    }

    const allocations = needsOriginAllocation
      ? selected.origens_financeiras
          .map(origin => ({
            comanda_id: origin.comanda_id,
            valor: Number(originValues[origin.comanda_id] || 0),
          }))
          .filter(origin => origin.valor > 0)
      : [];

    const idempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `refund-${crypto.randomUUID()}`
      : `refund-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      setSubmitting(true);
      await estornarPagamento(selected.id, {
        valor: refundValue,
        motivo: reason.trim(),
        idempotency_key: idempotencyKey,
        metodo_devolucao: payoutMethod || selected.metodo_original,
        alocacoes: allocations,
      });
      await onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registrar estorno.');
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-koma-overlay p-3 backdrop-blur-sm" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-koma-border bg-koma-panel shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-koma-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300">
              <RotateCcw size={18} />
            </span>
            <div>
              <h2 className="text-sm font-bold text-koma-foreground">Estornar recebimento</h2>
              <p className="mt-0.5 text-[10px] text-koma-muted">A venda original permanece no histórico; a devolução é registrada como evento financeiro separado.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-koma-muted hover:bg-koma-raised hover:text-koma-foreground" aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(280px,.85fr)_minmax(0,1.15fr)]">
          <section className="min-h-0 border-b border-koma-border p-4 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Mesa, Conta, pedido ou meio..."
                  className="w-full rounded-xl border border-koma-border bg-koma-input py-2.5 pl-9 pr-3 text-xs text-koma-foreground outline-none focus:border-emerald-500/50"
                />
              </div>
              <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-koma-border bg-koma-card p-2.5 text-koma-muted hover:text-koma-foreground disabled:opacity-50" title="Atualizar">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="mt-3 max-h-[58vh] space-y-2 overflow-y-auto pr-1">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-xs text-koma-muted"><Loader2 size={16} className="animate-spin" /> Carregando recebimentos…</div>
              ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-koma-border px-4 py-8 text-center text-xs text-koma-muted">Nenhum pagamento com saldo estornável.</div>
              ) : filtered.map(payment => {
                const active = payment.id === selectedId;
                return (
                  <button
                    key={payment.id}
                    type="button"
                    onClick={() => setSelectedId(payment.id)}
                    className={`w-full rounded-2xl border p-3 text-left transition-colors ${active ? 'border-rose-500/50 bg-rose-500/10' : 'border-koma-border bg-koma-card hover:bg-koma-raised'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block truncate text-xs text-koma-foreground">{payment.origem}</strong>
                        <span className="mt-1 block text-[9px] text-koma-muted">{formatBackendDateTime(payment.criado_em)} · {methodLabel[payment.metodo_original] || payment.metodo_original}</span>
                      </div>
                      <strong className="shrink-0 text-xs tabular-nums text-rose-800 dark:text-rose-300">{currency.format(payment.saldo_estornavel)}</strong>
                    </div>
                    <span className="mt-2 block text-[9px] text-koma-muted">Original {currency.format(payment.valor_original)} · disponível para devolução</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="min-h-0 overflow-y-auto p-5">
            {!selected ? (
              <div className="flex min-h-72 flex-col items-center justify-center text-center">
                <RotateCcw size={24} className="text-koma-muted" />
                <strong className="mt-3 text-sm text-koma-foreground">Selecione um recebimento</strong>
                <span className="mt-1 max-w-sm text-[11px] leading-relaxed text-koma-muted">Somente pagamentos aprovados e ainda estornáveis aparecem na lista.</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-koma-border bg-koma-card p-3 text-[10px]">
                  <div><span className="block text-koma-muted">Recebimento original</span><strong className="mt-1 block text-koma-foreground">{currency.format(selected.valor_original)}</strong></div>
                  <div><span className="block text-koma-muted">Saldo estornável</span><strong className="mt-1 block text-rose-800 dark:text-rose-300">{currency.format(selected.saldo_estornavel)}</strong></div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Valor da devolução</label>
                  <div className="flex items-center rounded-xl border border-koma-border bg-koma-input px-3 focus-within:border-rose-500/50">
                    <span className="text-xs text-koma-muted">R$</span>
                    <MoneyInput
                      value={value}
                      onValueChange={setValue}
                      selectOnFocus
                      className="min-w-0 flex-1 bg-transparent px-2 py-3 text-lg font-bold tabular-nums text-koma-foreground outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Meio efetivo da devolução</label>
                  <select value={payoutMethod} onChange={event => setPayoutMethod(event.target.value)} className="w-full rounded-xl border border-koma-border bg-koma-input px-3 py-3 text-xs text-koma-foreground outline-none focus:border-rose-500/50">
                    <option value="dinheiro">Dinheiro</option>
                    <option value="pix">Pix</option>
                    <option value="cartao_credito">Cartão de crédito</option>
                    <option value="cartao_debito">Cartão de débito</option>
                  </select>
                  {payoutDiffers && (
                    <div className="mt-2 flex gap-2 rounded-xl border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-[10px] leading-relaxed text-amber-900 dark:text-amber-200">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      A venda foi recebida por {methodLabel[selected.metodo_original] || selected.metodo_original}, mas a devolução sairá por {methodLabel[payoutMethod] || payoutMethod}. O relatório preserva o meio original; o caixa usa o meio real da devolução.
                    </div>
                  )}
                </div>

                {needsOriginAllocation && (
                  <div className="rounded-2xl border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-3">
                    <div className="flex gap-2 text-[10px] leading-relaxed text-amber-900 dark:text-amber-200">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>Este recebimento foi dividido entre mais de uma Conta. Como o estorno é parcial, informe de qual origem sai cada parcela. O sistema não faz rateio automático.</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {selected.origens_financeiras.filter(origin => origin.saldo_estornavel > 0).map(origin => (
                        <div key={origin.comanda_id} className="grid grid-cols-[minmax(0,1fr)_130px] items-center gap-3 rounded-xl border border-koma-border bg-koma-panel p-2.5">
                          <div className="min-w-0">
                            <strong className="block truncate text-[10px] text-koma-foreground">{origin.label}</strong>
                            <span className="mt-0.5 block text-[9px] text-koma-muted">Disponível {currency.format(origin.saldo_estornavel)}</span>
                          </div>
                          <MoneyInput
                            value={originValues[origin.comanda_id] ?? ''}
                            onValueChange={next => setOriginValues(current => ({ ...current, [origin.comanda_id]: next }))}
                            placeholder="0,00"
                            className="w-full rounded-lg border border-koma-border bg-koma-input px-2 py-2 text-right text-xs font-bold tabular-nums text-koma-foreground outline-none focus:border-rose-500/50"
                          />
                        </div>
                      ))}
                      <div className="flex justify-between text-[10px] font-semibold text-koma-muted"><span>Distribuído</span><span className={Math.abs(explicitOriginTotal - refundValue) < 0.005 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>{currency.format(explicitOriginTotal)} / {currency.format(refundValue)}</span></div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Justificativa obrigatória</label>
                  <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3} placeholder="Ex.: cobrança duplicada, item devolvido, erro operacional…" className="w-full resize-none rounded-xl border border-koma-border bg-koma-input px-3 py-2.5 text-xs text-koma-foreground outline-none focus:border-rose-500/50" />
                </div>

                {error && <div className="rounded-xl border border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-3 text-[11px] text-rose-800 dark:text-rose-300">{error}</div>}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl border border-koma-border bg-koma-card px-4 py-2.5 text-xs font-bold text-koma-secondary hover:text-koma-foreground disabled:opacity-50">Cancelar</button>
                  <button type="button" onClick={() => void submit()} disabled={submitting} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-50">
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Confirmar estorno
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default EstornoModal;
