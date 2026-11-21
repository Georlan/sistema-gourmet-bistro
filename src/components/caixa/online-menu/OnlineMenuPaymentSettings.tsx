import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';
import { fetchCardapioDigitalConfig, updateCardapioDigitalConfigCache } from './cardapioDigitalConfigClient';
import { AlertCircle, ArrowRight, CheckCircle2, CreditCard, ExternalLink, Loader2, Save, ShieldCheck } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  publicMenuUrl?: string | null;
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

export function OnlineMenuPaymentSettings({ apiBaseUrl, authHeaders, publicMenuUrl, onManageIntegrations }: Props) {
  const [methods, setMethods] = useState<string[]>([]);
  const [onlinePaymentEnabled, setOnlinePaymentEnabled] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const authorization = authHeaders.Authorization || authHeaders.authorization || '';
      const data = await fetchCardapioDigitalConfig<Record<string, unknown>>(apiBaseUrl, authorization);
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
      const authorization = authHeaders.Authorization || authHeaders.authorization || '';
      updateCardapioDigitalConfigCache(apiBaseUrl, authorization, data);
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
        <div className="flex items-center gap-2 text-xs font-semibold text-koma-muted">
          <Loader2 size={16} className="animate-spin" /> Carregando pagamentos…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <header className="flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-panel px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h2
            className="text-base font-bold text-koma-foreground"
            style={{ fontFamily: 'var(--koma-font-display)' }}
          >
            Pagamentos
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-koma-muted">
            Escolha como o cliente pode pagar no checkout e acompanhe o recebimento online.
          </p>
        </div>
        {publicMenuUrl && (
          <a
            href={publicMenuUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3.5 text-xs font-semibold text-koma-foreground transition hover:bg-koma-card"
          >
            <ExternalLink size={14} aria-hidden="true" />
            <span>Ver cardápio</span>
          </a>
        )}
      </header>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border"
            style={{
              background: 'var(--koma-success-bg)',
              borderColor: 'var(--koma-success-border)',
              color: 'var(--koma-success-text)',
            }}
          >
            <CreditCard size={18} aria-hidden="true" />
          </div>
          <div>
            <h3
              className="text-sm font-bold text-koma-foreground"
              style={{ fontFamily: 'var(--koma-font-display)' }}
            >
              Formas aceitas
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-koma-muted">
              Estas opções aparecem no checkout. A forma escolhida continua sendo validada pelo fluxo canônico do pedido.
            </p>
          </div>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {paymentOptions.map((option) => {
            const checked = methods.includes(option.id);
            return (
              <label
                key={option.id}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition"
                style={
                  checked
                    ? {
                        background: 'var(--koma-success-bg)',
                        borderColor: 'var(--koma-success-border)',
                      }
                    : {
                        background: 'var(--koma-surface-card)',
                        borderColor: 'var(--koma-border-default)',
                      }
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setMethods((current) => event.target.checked
                    ? [...current, option.id]
                    : current.filter((item) => item !== option.id))}
                  className="h-5 w-5 shrink-0"
                  style={{ accentColor: 'var(--koma-action-bg)' }}
                />
                <span>
                  <strong className="block text-sm font-semibold text-koma-foreground">{option.label}</strong>
                  <span className="mt-0.5 block text-xs leading-relaxed text-koma-muted">{option.helper}</span>
                </span>
              </label>
            );
          })}
        </div>

        {methods.length === 0 && (
          <div
            className="mt-3 flex items-start gap-2 rounded-xl border p-3.5 text-xs"
            style={{
              background: 'var(--koma-warning-bg)',
              borderColor: 'var(--koma-warning-border)',
              color: 'var(--koma-warning-text)',
            }}
          >
            <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>O cliente ficará sem opção de pagamento no checkout enquanto nenhuma forma estiver marcada.</span>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border"
              style={
                onlinePaymentEnabled
                  ? {
                      background: 'var(--koma-success-bg)',
                      borderColor: 'var(--koma-success-border)',
                      color: 'var(--koma-success-text)',
                    }
                  : {
                      background: 'var(--koma-surface-raised)',
                      borderColor: 'var(--koma-border-default)',
                      color: 'var(--koma-text-muted)',
                    }
              }
            >
              <ShieldCheck size={18} aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  className="text-sm font-bold text-koma-foreground"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  Recebimento online
                </h3>
                <span
                  className="rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                  style={
                    onlinePaymentEnabled
                      ? {
                          background: 'var(--koma-success-bg)',
                          borderColor: 'var(--koma-success-border)',
                          color: 'var(--koma-success-text)',
                        }
                      : {
                          background: 'var(--koma-surface-card)',
                          borderColor: 'var(--koma-border-default)',
                          color: 'var(--koma-text-muted)',
                        }
                  }
                >
                  {onlinePaymentEnabled ? 'Ativo' : 'Não conectado'}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-koma-muted">
                {onlinePaymentEnabled
                  ? 'O recebimento online (Pix Direto, Mercado Pago ou PagBank) está ativo. Confira o modo de confirmação e a conta recebedora em Integrações.'
                  : 'Nenhum provedor de pagamento online (Pix Direto, Mercado Pago ou PagBank) está ativo para este restaurante.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onManageIntegrations}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3.5 text-xs font-semibold text-koma-foreground transition hover:bg-koma-card"
          >
            <span>Gerenciar integração</span>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      </section>

      {(feedback || hasUnsavedChanges) && (
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 rounded-2xl border border-koma-border bg-koma-panel p-3 sm:bottom-3 sm:flex-row sm:items-center sm:justify-end">
          {feedback ? (
            <span
              role={feedback.type === 'error' ? 'alert' : 'status'}
              className="mr-auto inline-flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: feedback.type === 'success' ? 'var(--koma-success-text)' : 'var(--koma-danger-text)' }}
            >
              {feedback.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {feedback.text}
            </span>
          ) : (
            <span className="mr-auto text-xs font-semibold" style={{ color: 'var(--koma-warning-text)' }}>
              Alterações ainda não publicadas.
            </span>
          )}
          {hasUnsavedChanges && (
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void save()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-70"
              style={{
                background: 'var(--koma-action-bg)',
                color: 'var(--koma-action-text)',
              }}
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>{isSaving ? 'Publicando…' : 'Salvar e publicar'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
