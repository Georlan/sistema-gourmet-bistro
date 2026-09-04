import clsx from 'clsx';
import { AlertCircle, CheckCircle2, CreditCard, ExternalLink, Loader2, Save, ShieldCheck } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { OperationalBanner } from '../../shared/OperationalBanner';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onManageIntegrations: () => void;
}

const paymentOptions = [
  { id: 'Pix', label: 'Pix', helper: 'Pode ser informado como forma aceita no pedido.' },
  { id: 'Dinheiro', label: 'Dinheiro', helper: 'Pagamento no atendimento ou na entrega.' },
  { id: 'Cartão de crédito', label: 'Crédito', helper: 'Cartão de crédito no atendimento.' },
  { id: 'Cartão de débito', label: 'Débito', helper: 'Cartão de débito no atendimento.' },
] as const;

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizePayments(value: unknown): string[] {
  const parsed = parseStructuredValue(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function OnlineMenuPaymentSettings({ apiBaseUrl, authHeaders, onManageIntegrations }: Props) {
  const [methods, setMethods] = useState<string[]>([]);
  const [onlinePaymentEnabled, setOnlinePaymentEnabled] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/config`, { headers: authHeaders, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível carregar os pagamentos.');
      const nextMethods = normalizePayments(data.formas_pagamento_aceitas);
      setMethods(nextMethods);
      setOnlinePaymentEnabled(data.pagamento_online_ativo === true);
      setSavedSnapshot(JSON.stringify(nextMethods));
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao carregar pagamentos.' });
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const hasUnsavedChanges = useMemo(() => JSON.stringify(methods) !== savedSnapshot, [methods, savedSnapshot]);

  const save = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/config`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ formas_pagamento_aceitas: methods }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível salvar as formas de pagamento.');
      const nextMethods = normalizePayments(data.formas_pagamento_aceitas);
      setMethods(nextMethods);
      setSavedSnapshot(JSON.stringify(nextMethods));
      setFeedback({ type: 'success', text: 'Formas de pagamento publicadas.' });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar pagamentos.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-2xl border border-koma-border bg-koma-panel">
        <div className="flex items-center gap-2 text-xs font-bold text-koma-muted">
          <Loader2 size={16} className="animate-spin" /> Carregando pagamentos…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <OperationalBanner
        id="online-menu-payments-heading"
        eyebrow="CARDÁPIO ONLINE"
        title="Pagamentos"
        accent="sem misturar integração"
        description="Escolha o que o cliente pode selecionar no canal. Credenciais e conexão do provedor continuam em Sistema → Integrações."
        metrics={[
          { label: 'formas aceitas', value: methods.length },
          { label: 'pagamento online', value: onlinePaymentEnabled ? 'Conectado' : 'Desconectado' },
        ]}
      />

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
            <CreditCard size={17} />
          </div>
          <div>
            <h3 className="text-sm font-black text-koma-foreground">Formas aceitas</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Estas opções aparecem no checkout. A forma escolhida continua sendo validada pelo fluxo canônico do pedido.</p>
          </div>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {paymentOptions.map((option) => {
            const checked = methods.includes(option.id);
            return (
              <label
                key={option.id}
                className={clsx(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition',
                  checked ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-koma-border bg-koma-card hover:border-emerald-500/25',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setMethods((current) => event.target.checked
                    ? [...current, option.id]
                    : current.filter((item) => item !== option.id))}
                  className="mt-0.5 h-4 w-4 accent-emerald-500"
                />
                <span>
                  <strong className="block text-xs text-koma-foreground">{option.label}</strong>
                  <span className="mt-1 block text-[9px] leading-relaxed text-koma-muted">{option.helper}</span>
                </span>
              </label>
            );
          })}
        </div>

        {methods.length === 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-3 text-[10px] text-amber-700 dark:text-amber-300">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> O cliente ficará sem opção de pagamento no checkout enquanto nenhuma forma estiver marcada.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className={clsx(
              'grid h-9 w-9 shrink-0 place-items-center rounded-xl border',
              onlinePaymentEnabled
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                : 'border-koma-border bg-koma-raised text-koma-muted',
            )}>
              <ShieldCheck size={17} />
            </div>
            <div>
              <h3 className="text-sm font-black text-koma-foreground">Pagamento online</h3>
              <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">
                {onlinePaymentEnabled
                  ? 'Mercado Pago está conectado. Este painel só mostra o estado operacional; OAuth, webhook e credenciais permanecem no owner técnico.'
                  : 'Nenhum provedor de pagamento online está ativo para este restaurante.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onManageIntegrations}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-4 text-[10px] font-black uppercase tracking-wider text-koma-secondary transition hover:border-emerald-500/40 hover:text-emerald-600"
          >
            <ExternalLink size={13} /> Gerenciar integração
          </button>
        </div>
      </section>

      <div className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-2xl border border-koma-border bg-koma-panel/95 p-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-end">
        {feedback ? (
          <span className={clsx('mr-auto inline-flex items-center gap-1.5 text-[10px] font-bold', feedback.type === 'success' ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>
            {feedback.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}{feedback.text}
          </span>
        ) : (
          <span className="mr-auto text-[10px] font-semibold text-koma-muted">{hasUnsavedChanges ? 'Há alterações que ainda não foram publicadas.' : 'Tudo salvo.'}</span>
        )}
        <button
          type="button"
          disabled={isSaving || !hasUnsavedChanges}
          onClick={() => void save()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-4 text-[10px] font-black uppercase tracking-wider text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300 disabled:cursor-default disabled:border-koma-border disabled:bg-koma-raised disabled:text-koma-muted disabled:opacity-70"
        >
          {isSaving ? <Loader2 size={13} className="animate-spin" /> : hasUnsavedChanges ? <Save size={13} /> : <CheckCircle2 size={13} />}
          {isSaving ? 'Publicando…' : hasUnsavedChanges ? 'Salvar pagamentos' : 'Tudo salvo'}
        </button>
      </div>
    </div>
  );
}
