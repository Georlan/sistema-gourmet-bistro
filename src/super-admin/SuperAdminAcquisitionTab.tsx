import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search, TrendingUp } from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

interface AttributionRow {
  id: number;
  restauranteId: number;
  restaurantName: string;
  orderId: string;
  orderNumber?: number | null;
  sourcePlatform: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  referrerHost?: string | null;
  landingPath?: string | null;
  createdAt: string;
}

export function SuperAdminAcquisitionTab() {
  const [rows, setRows] = useState<AttributionRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await superAdminFetch("/api/super-admin/order-attribution?limit=200");
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body.items)) throw new Error(body.detail || "Falha ao carregar aquisição.");
      setRows(body.items as AttributionRow[]);
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? rows.filter((row) => [row.restaurantName, row.sourcePlatform, row.utmSource, row.utmCampaign, row.referrerHost, row.orderNumber]
        .some((value) => String(value || "").toLowerCase().includes(normalizedQuery)))
    : rows;

  return (
    <section className="space-y-4" data-testid="superadmin-acquisition">
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-koma-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-[#00b894]" /><h2 className="text-lg font-black">Aquisição de pedidos</h2></div>
          <p className="mt-1 text-xs text-koma-muted">Atribuição privada do KÔMA. Não aparece para o restaurante.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-700 px-3 text-xs font-bold">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-muted" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Restaurante, origem, campanha ou pedido..." className="h-10 w-full rounded-lg border border-zinc-800 bg-koma-card pl-9 pr-3 text-xs outline-none focus:border-[#00b894]" />
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-800/60 bg-rose-950/30 p-3 text-xs text-rose-300">{error}</div>}
      {!error && (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-koma-card">
          <table className="w-full min-w-[920px] text-left text-xs">
            <thead className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-koma-muted">
              <tr><th className="p-3">Data</th><th className="p-3">Restaurante</th><th className="p-3">Pedido</th><th className="p-3">Origem</th><th className="p-3">Campanha</th><th className="p-3">Referência</th></tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-zinc-900 last:border-0">
                  <td className="p-3 whitespace-nowrap">{new Date(row.createdAt).toLocaleString("pt-BR")}</td>
                  <td className="p-3 font-bold">{row.restaurantName} <span className="text-koma-muted">#{row.restauranteId}</span></td>
                  <td className="p-3">#{row.orderNumber ?? row.orderId}</td>
                  <td className="p-3"><span className="rounded-full border border-emerald-800/50 bg-emerald-950/40 px-2 py-1 font-bold text-emerald-300">{row.sourcePlatform || "direto"}</span><div className="mt-1 text-koma-muted">{[row.utmSource, row.utmMedium].filter(Boolean).join(" / ") || "sem UTM"}</div></td>
                  <td className="p-3">{row.utmCampaign || "—"}{row.utmContent && <div className="mt-1 text-koma-muted">{row.utmContent}</div>}</td>
                  <td className="p-3">{row.referrerHost || "—"}{row.landingPath && <div className="mt-1 max-w-xs truncate text-koma-muted" title={row.landingPath}>{row.landingPath}</div>}</td>
                </tr>
              ))}
              {!loading && visible.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-koma-muted">Nenhuma atribuição encontrada.</td></tr>}
              {loading && <tr><td colSpan={6} className="p-8 text-center text-koma-muted">Carregando…</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
