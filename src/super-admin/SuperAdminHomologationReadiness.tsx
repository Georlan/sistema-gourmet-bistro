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
  webhookUrl: string;
  publicAppUrl: string;
  checks: ReadinessCheck[];
};

function ReadinessGroup({ title, checks }: { title: string; checks: ReadinessCheck[] }) {
  return <div className="rounded-xl border border-zinc-800 bg-koma-page/60 p-3">
    <h4 className="mb-2 text-sm font-bold">{title}</h4>
    <div className="space-y-2">
      {checks.map(check => <div key={check.id} className="flex items-start gap-2 text-sm">
        <span className={check.ready ? 'text-emerald-400' : 'text-amber-400'} aria-hidden="true">{check.ready ? '✓' : '!'}</span>
        <div className="min-w-0">
          <p className="font-semibold">{check.label}</p>
          <p className="break-words text-xs text-koma-muted">{check.detail}</p>
        </div>
      </div>)}
    </div>
  </div>;
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
    } catch {
      setCopyNotice('Copie a URL do webhook manualmente.');
    }
  };

  const paymentChecks = data?.checks.filter(check => check.scope === 'payment') ?? [];
  const deliveryChecks = data?.checks.filter(check => check.scope === 'delivery') ?? [];

  return <section className="my-4 rounded-2xl border border-emerald-900/60 bg-emerald-950/10 p-4" aria-label="Prontidão da homologação SaaS">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-lg font-bold">Homologação SaaS</h3>
        <p className="text-sm text-koma-muted">Use este painel como fonte de verdade antes de simular cartão, Pix, liberação e primeiro acesso.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href="/contratar/pro?cobranca=anual" target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-500">Abrir checkout Pro anual</a>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm disabled:opacity-50">{loading ? 'Verificando…' : 'Verificar novamente'}</button>
      </div>
    </div>

    {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
    {data && <>
      <div className="my-3 flex flex-wrap gap-2 text-xs font-bold">
        <span className={`rounded-full px-2.5 py-1 ${data.readyForPayments ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>{data.readyForPayments ? 'Pagamentos prontos' : `${data.paymentBlockers.length} bloqueio(s) em pagamentos`}</span>
        <span className={`rounded-full px-2.5 py-1 ${data.readyForEndToEnd ? 'bg-emerald-950 text-emerald-300' : 'bg-zinc-900 text-zinc-300'}`}>{data.readyForEndToEnd ? 'Ponta a ponta pronto' : `${data.deliveryBlockers.length} bloqueio(s) em notificações`}</span>
        <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-zinc-300">Ambiente: {data.environment}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ReadinessGroup title="1. Cobrança e liberação" checks={paymentChecks} />
        <ReadinessGroup title="2. Convites e avisos" checks={deliveryChecks} />
      </div>

      <div className="mt-3 rounded-xl border border-zinc-800 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold">Webhook Mercado Pago</p>
            <code className="block break-all text-xs text-koma-muted">{data.webhookUrl}</code>
          </div>
          <button type="button" onClick={() => void copyWebhook()} className="rounded border border-zinc-700 px-2.5 py-1.5 text-xs">Copiar webhook</button>
        </div>
        {copyNotice && <p role="status" className="mt-1 text-xs text-koma-muted">{copyNotice}</p>}
      </div>

      <div className="mt-3 rounded-xl border border-zinc-800 p-3 text-sm">
        <p className="font-bold">Roteiro manual</p>
        <p className="mt-1 text-koma-muted">1. Deixe pagamentos prontos → 2. cartão sandbox → 3. confirme Aguardando liberação → 4. libere aqui no SuperAdmin → 5. ative o primeiro acesso → 6. repita com Pix → 7. valide e-mail e WhatsApp.</p>
      </div>
    </>}
  </section>;
}
