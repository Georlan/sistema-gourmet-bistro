import React, { useCallback, useEffect, useState } from 'react';
import { superAdminFetch } from './superAdminApi';

type ReadinessScope = 'payment' | 'delivery';
type ReadinessCheck = {
  id: string;
  label: string;
  ready: boolean;
  detail: string;
  scope: ReadinessScope;
};

type HomologationReadiness = {
  environment: string;
  readyForPayments: boolean;
  readyForEndToEnd: boolean;
  paymentBlockers: string[];
  deliveryBlockers: string[];
  publicApiUrl?: string;
  webhookUrl: string;
  webhookPath?: string;
  requiredWebhookEvents?: string[];
  publicAppUrl: string;
  checks: ReadinessCheck[];
};

function ReadinessGroup({ title, checks }: { title: string; checks: ReadinessCheck[] }) {
  const blockers = checks.filter(c => !c.ready);
  const readyChecks = checks.filter(c => c.ready);

  return (
    <div className="rounded-xl border border-zinc-800 bg-koma-page/60 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-zinc-100">{title}</h4>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            blockers.length === 0
              ? 'border border-emerald-800/50 bg-emerald-950/80 text-emerald-300'
              : 'border border-amber-800/50 bg-amber-950/80 text-amber-300'
          }`}
        >
          {blockers.length === 0 ? 'Tudo pronto' : `${blockers.length} pendência(s)`}
        </span>
      </div>

      {blockers.length > 0 && (
        <div className="mb-3 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
            Ações necessárias (bloqueadores)
          </p>
          {blockers.map(check => (
            <div
              key={check.id}
              className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2.5 text-sm"
            >
              <div className="flex items-start gap-2">
                <span className="shrink-0 font-bold text-amber-400" aria-hidden="true">
                  !
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-zinc-100">{check.label}</p>
                  <p className="mt-0.5 break-words font-mono text-xs text-amber-200/90">
                    {check.detail}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {readyChecks.length > 0 && (
        <div className="space-y-1.5">
          {blockers.length > 0 && (
            <p className="pt-1 text-[11px] font-bold uppercase tracking-wider text-emerald-500/80">
              Prontos
            </p>
          )}
          {readyChecks.map(check => (
            <div key={check.id} className="flex items-start gap-2 py-1 text-sm">
              <span className="shrink-0 font-bold text-emerald-400" aria-hidden="true">
                ✓
              </span>
              <div className="min-w-0">
                <p className="font-medium text-zinc-200">{check.label}</p>
                <p className="break-words text-xs text-koma-muted">{check.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SuperAdminHomologationReadiness() {
  const [data, setData] = useState<HomologationReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyNotice, setCopyNotice] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await superAdminFetch('/api/super-admin/homologation/readiness', { signal });
      if (!response.ok) throw new Error('Não foi possível verificar a prontidão da homologação.');
      setData(await response.json());
      setError('');
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Falha ao verificar a homologação.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const copyWebhook = async () => {
    if (!data?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(data.webhookUrl);
      setCopyNotice('Webhook copiado.');
      window.setTimeout(() => setCopyNotice(''), 2500);
    } catch {
      setCopyNotice('Copie a URL do webhook manualmente.');
      window.setTimeout(() => setCopyNotice(''), 4000);
    }
  };

  const copyConfig = async () => {
    if (!data?.webhookUrl) return;
    const configText = `Webhook:\n${data.webhookUrl}\n\nEventos:\npagamentos\nassinaturas\nsubscription_authorized_payment`;
    try {
      await navigator.clipboard.writeText(configText);
      setCopyNotice('Configuração copiada.');
      window.setTimeout(() => setCopyNotice(''), 2500);
    } catch {
      setCopyNotice('Copie a configuração manualmente.');
      window.setTimeout(() => setCopyNotice(''), 4000);
    }
  };

  const paymentChecks = data?.checks.filter(check => check.scope === 'payment') ?? [];
  const deliveryChecks = data?.checks.filter(check => check.scope === 'delivery') ?? [];

  return (
    <section
      className="my-4 rounded-2xl border border-emerald-900/60 bg-emerald-950/10 p-4"
      aria-label="Prontidão da homologação SaaS"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h3 className="text-lg font-bold text-zinc-100">Homologação SaaS</h3>
          <p className="text-sm text-koma-muted">
            Use este painel como fonte de verdade antes de simular cartão, Pix, liberação e primeiro acesso.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <a
            href="/contratar/pro?cobranca=anual"
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[42px] items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-bold text-white transition-colors hover:bg-emerald-500"
          >
            Abrir checkout Pro anual
          </a>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex min-h-[42px] items-center justify-center rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? 'Verificando…' : 'Verificar novamente'}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
      {data && (
        <>
          <div className="my-3 flex flex-wrap gap-2 text-xs font-bold">
            <span
              className={`rounded-full px-2.5 py-1 ${
                data.readyForPayments ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'
              }`}
            >
              {data.readyForPayments
                ? 'Pagamentos prontos'
                : `${data.paymentBlockers.length} bloqueio(s) em pagamentos`}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 ${
                data.readyForEndToEnd ? 'bg-emerald-950 text-emerald-300' : 'bg-zinc-900 text-zinc-300'
              }`}
            >
              {data.readyForEndToEnd
                ? 'Ponta a ponta pronto'
                : `${data.deliveryBlockers.length} bloqueio(s) em notificações`}
            </span>
            <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-zinc-300">
              Ambiente: {data.environment}
            </span>
          </div>

          {!data.readyForPayments && (
            <div className="mb-3 rounded-xl border border-amber-800/40 bg-amber-950/20 p-3 text-xs text-amber-200">
              <strong>Aviso operacional:</strong> O checkout está pausado porque o gateway TEST ainda não está disponível (<code className="font-mono text-amber-100">KOMA_SAAS_CHECKOUT_ENABLED=false</code>). O botão acima permite inspecionar o fluxo contratual até a etapa de pagamento, onde a trava é comunicada honestamente ao usuário.
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <ReadinessGroup title="1. Cobrança e liberação" checks={paymentChecks} />
            <ReadinessGroup title="2. Convites e avisos" checks={deliveryChecks} />
          </div>

          <div className="mt-3 space-y-3 rounded-xl border border-zinc-800 bg-koma-page/50 p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Backend de homologação</p>
                  <p className="mt-0.5 font-mono text-xs text-zinc-200">
                    <span className="text-koma-muted">KOMA_PUBLIC_API_URL: </span>
                    {data.publicApiUrl ? (
                      <span className="font-semibold text-emerald-400">{data.publicApiUrl}</span>
                    ) : (
                      <span className="font-semibold text-amber-400">Não configurada (defina KOMA_PUBLIC_API_URL)</span>
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Webhook SaaS</p>
                  <code className="mt-0.5 block break-all font-mono text-xs font-semibold text-emerald-300">
                    {data.webhookUrl}
                  </code>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Eventos necessários no Mercado Pago</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-zinc-300">
                    <li>pagamentos (<code className="font-mono text-zinc-400">payment</code>)</li>
                    <li>assinaturas (<code className="font-mono text-zinc-400">subscription_preapproval</code>)</li>
                    <li>faturas autorizadas / <code className="font-mono text-amber-300">subscription_authorized_payment</code></li>
                  </ul>
                </div>

                <p className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-2.5 text-xs text-amber-200">
                  ⚠️ <strong>Atenção:</strong> Não use o webhook de pagamentos dos restaurantes. Este endpoint é exclusivo da cobrança da assinatura KÔMA.
                </p>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto">
                <button
                  type="button"
                  onClick={() => void copyWebhook()}
                  className="flex min-h-[38px] items-center justify-center rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
                >
                  Copiar webhook
                </button>
                <button
                  type="button"
                  onClick={() => void copyConfig()}
                  className="flex min-h-[38px] items-center justify-center rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                >
                  Copiar configuração
                </button>
              </div>
            </div>
            {copyNotice && <p role="status" className="mt-1 text-xs font-medium text-emerald-400">{copyNotice}</p>}
          </div>

          <div className="mt-3 rounded-xl border border-zinc-800 p-3 text-sm">
            <p className="font-bold text-zinc-200">Roteiro manual</p>
            <p className="mt-1 text-koma-muted">
              1. Deixe pagamentos prontos → 2. cartão sandbox → 3. confirme Aguardando liberação → 4. libere aqui no SuperAdmin → 5. ative o primeiro acesso → 6. repita com Pix → 7. valide e-mail e WhatsApp.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
