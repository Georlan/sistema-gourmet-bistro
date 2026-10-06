import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, MousePointerClick } from 'lucide-react';
import { superAdminFetch } from './superAdminApi';

type AcquisitionItem = {
  tenant_id: number;
  restaurant_name: string;
  order_id: string;
  numero_pedido?: number | string | null;
  created_at?: string | null;
  source: string;
  platform?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  referrer_host?: string | null;
  entry_path?: string | null;
};

type AcquisitionResponse = {
  checked_at: string;
  window_days: number;
  tracked_orders: number;
  by_source: Record<string, number>;
  by_campaign: Record<string, number>;
  items: AcquisitionItem[];
};

export function SuperAdminAcquisitionTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AcquisitionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await superAdminFetch(`/api/super-admin/acquisition?days=${days}&limit=200`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Não foi possível carregar a aquisição.');
      setData(payload as AcquisitionResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar aquisição.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [days]);

  const topSources = useMemo(
    () => Object.entries(data?.by_source || {}).sort((a, b) => b[1] - a[1]).slice(0, 8),
    [data],
  );
  const topCampaigns = useMemo(
    () => Object.entries(data?.by_campaign || {}).sort((a, b) => b[1] - a[1]).slice(0, 8),
    [data],
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MousePointerClick className="h-5 w-5 text-emerald-500" />
            <h2 className="text-xl font-black">Aquisição</h2>
          </div>
          <p className="mt-1 text-xs text-koma-muted">
            Conversões do cardápio online vistas somente pelo SuperAdmin. Sem PII do consumidor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="h-9 rounded-lg border border-koma-border bg-koma-card px-3 text-xs"
          >
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-koma-border bg-koma-card px-3 text-xs font-bold"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-800/50 bg-rose-950/20 p-3 text-xs text-rose-300">{error}</div>}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-koma-border bg-koma-card p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">Pedidos rastreados</p>
          <p className="mt-2 text-2xl font-black">{data?.tracked_orders ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-koma-border bg-koma-card p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">Principal origem</p>
          <p className="mt-2 text-lg font-black">{topSources[0]?.[0] || '—'}</p>
          <p className="text-xs text-koma-muted">{topSources[0]?.[1] ? `${topSources[0][1]} pedido(s)` : 'Sem dados ainda'}</p>
        </div>
        <div className="rounded-xl border border-koma-border bg-koma-card p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">Principal campanha</p>
          <p className="mt-2 truncate text-lg font-black">{topCampaigns[0]?.[0] || '—'}</p>
          <p className="text-xs text-koma-muted">{topCampaigns[0]?.[1] ? `${topCampaigns[0][1]} pedido(s)` : 'Use UTMs para detalhar Story, anúncio, bio etc.'}</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-koma-border bg-koma-card">
        <div className="border-b border-koma-border px-4 py-3">
          <h3 className="text-sm font-black">Conversões recentes</h3>
        </div>
        {loading && !data ? (
          <div className="p-8 text-center text-xs text-koma-muted">Carregando aquisição…</div>
        ) : (data?.items || []).length === 0 ? (
          <div className="p-8 text-center text-xs text-koma-muted">Nenhum pedido com atribuição neste período.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-koma-page/60 text-[10px] uppercase tracking-wider text-koma-muted">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Restaurante</th>
                  <th className="px-4 py-3">Pedido</th>
                  <th className="px-4 py-3">Origem</th>
                  <th className="px-4 py-3">Campanha</th>
                  <th className="px-4 py-3">Referência</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items || []).map((item) => (
                  <tr key={`${item.tenant_id}:${item.order_id}`} className="border-t border-koma-border/70">
                    <td className="px-4 py-3 whitespace-nowrap">{item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : '—'}</td>
                    <td className="px-4 py-3 font-semibold">{item.restaurant_name} <span className="text-koma-muted">#{item.tenant_id}</span></td>
                    <td className="px-4 py-3 font-mono">#{item.numero_pedido ?? item.order_id}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold">{item.source}</div>
                      <div className="text-[10px] text-koma-muted">{item.platform || 'browser'}{item.utm_medium ? ` · ${item.utm_medium}` : ''}</div>
                    </td>
                    <td className="px-4 py-3">{item.utm_campaign || '—'}{item.utm_content ? <div className="text-[10px] text-koma-muted">{item.utm_content}</div> : null}</td>
                    <td className="px-4 py-3 text-koma-muted">{item.referrer_host || item.entry_path || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
