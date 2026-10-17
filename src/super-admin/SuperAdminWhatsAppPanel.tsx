import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, MessageCircle, RefreshCw } from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

type Permissions = {
  managed: boolean;
  operator_allowed: boolean;
  customer_allowed: boolean;
  operator_registered: boolean;
  customer_requested: boolean;
  operator_effective: boolean;
  customer_effective: boolean;
};
type Usage = {
  attempts: number;
  accepted: number;
  failed: number;
  discarded: number;
  deferred: number;
  average_queue_ms: number | null;
  estimated_customer_cost_brl: string | null;
};
type Queue = {
  total: number;
  by_kind: Record<string, number>;
  oldest_seconds: number | null;
  groups_near_expiry: number;
  ttl_risk: boolean;
};
type Tenant = {
  restaurant_id: number;
  restaurant_name: string;
  saas_status: string;
  permissions: Permissions | null;
  usage: Usage;
  queue: Queue;
};
type Overview = {
  checked_at: string;
  month_utc: string;
  total_restaurants: number;
  page_offset: number;
  page_limit: number;
  sender: {
    state: string;
    connection: string;
    interval_seconds?: number;
    failures?: number;
    next_send_at?: string | null;
    circuit_open_until?: string | null;
  };
  page_totals: Record<string, number>;
  tenants: Tenant[];
};

function optionalDate(value?: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

export function SuperAdminWhatsAppPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [offset, setOffset] = useState(0);

  const refresh = useCallback(async (verify = false, nextOffset = offset) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        limit: "25",
        offset: String(nextOffset),
        verify_sender: String(verify),
      });
      const response = await superAdminFetch(`/api/super-admin/whatsapp/overview?${query.toString()}`);
      if (!response.ok) throw new Error(`Falha ao consultar WhatsApp (HTTP ${response.status}).`);
      const payload: Overview = await response.json();
      setData(payload);
      setOffset(nextOffset);
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => { void refresh(false, 0); }, []); // No polling: explicit refresh only.

  const change = async (tenant: Tenant, channel: "operator" | "customer") => {
    if (reason.trim().length < 3) {
      setError("Informe um motivo com pelo menos três caracteres antes de alterar permissões.");
      return;
    }
    const current = channel === "operator"
      ? tenant.permissions?.operator_allowed === true
      : tenant.permissions?.customer_allowed === true;
    if (!window.confirm(`${current ? "Suspender" : "Autorizar"} avisos de ${channel === "operator" ? "comandas" : "clientes"} para ${tenant.restaurant_name}?`)) return;
    setBusyId(tenant.restaurant_id);
    setError(null);
    try {
      const response = await superAdminFetch(
        `/api/super-admin/whatsapp/restaurantes/${tenant.restaurant_id}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim(),
          [channel === "operator" ? "operator_allowed" : "customer_allowed"]: !current,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "Falha ao alterar autorização.");
      }
      await refresh(false, offset);
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-koma-border bg-koma-card p-4 sm:p-5" aria-label="Controle central WhatsApp">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-koma-foreground">
            <MessageCircle className="h-5 w-5 text-emerald-500" /> WhatsApp Business compartilhado
          </h2>
          <p className="mt-1 text-xs text-koma-muted">Liberação por restaurante, fila e aceites HTTP. Nenhum disparo ocorre neste painel.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={loading} onClick={() => void refresh(false, offset)}
            className="rounded-lg border border-koma-border px-3 py-2 text-xs font-semibold disabled:opacity-50">
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" /> Atualizar dados
          </button>
          <button type="button" disabled={loading} onClick={() => void refresh(true, offset)}
            className="rounded-lg border border-koma-border px-3 py-2 text-xs font-semibold disabled:opacity-50">
            Verificar sessão
          </button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-rose-700/50 p-3 text-xs text-rose-400">{error}</p>}
      {!data && !error && <p className="text-xs text-koma-muted">{loading ? "Consultando…" : "Dados indisponíveis."}</p>}
      {data && <>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-koma-border p-3 text-xs">
            <div className="text-koma-muted">Canal</div>
            <strong>{data.sender.state === "configured" ? "Configurado" : "Desligado / indisponível"}</strong>
            <p className="mt-1 text-koma-muted">Sessão: {data.sender.connection === "matched" ? "Identidade confirmada" : data.sender.connection === "not_verified" ? "Não verificada nesta consulta" : data.sender.connection}</p>
          </div>
          <div className="rounded-lg border border-koma-border p-3 text-xs">
            <div className="text-koma-muted">Vazão central</div>
            <strong>{data.sender.interval_seconds != null ? `1 tentativa a cada ${data.sender.interval_seconds}s` : "Indisponível"}</strong>
            <p className="mt-1 text-koma-muted">Falhas consecutivas: {data.sender.failures ?? "—"}. Circuito até: {optionalDate(data.sender.circuit_open_until)}</p>
          </div>
          <div className="rounded-lg border border-koma-border p-3 text-xs">
            <div className="text-koma-muted">Agregado desta página ({data.month_utc})</div>
            <strong>{data.page_totals.attempts} tentativas · {data.page_totals.accepted} aceites HTTP</strong>
            <p className="mt-1 text-koma-muted">{data.page_totals.waiting} na fila · {data.page_totals.failed} falhas · {data.page_totals.discarded} descartes</p>
          </div>
        </div>

        <label className="block text-xs font-semibold text-koma-foreground">
          Motivo obrigatório para liberar ou suspender um canal
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={1000}
            placeholder="Ex.: homologação autorizada pelo responsável"
            className="mt-2 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-xs text-koma-foreground"
          />
        </label>

        <div className="space-y-3">
          {data.tenants.map(tenant => (
            <div key={tenant.restaurant_id} className="rounded-xl border border-koma-border bg-koma-page p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-koma-foreground">{tenant.restaurant_name} · #{tenant.restaurant_id}</strong>
                <span className="text-koma-muted">{tenant.permissions?.managed ? "Política administrada" : "Piloto legado / não configurado"}</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <p>Comandas: <strong>{tenant.permissions?.operator_effective ? "Disponível" : tenant.permissions?.operator_allowed ? "Permitido, aguardando cadastro/canal" : "Não autorizado"}</strong></p>
                  <p className="text-koma-muted">Destino cadastrado: {tenant.permissions?.operator_registered ? "Sim" : "Não"}</p>
                  <button type="button" disabled={busyId !== null || loading || !tenant.permissions}
                    onClick={() => void change(tenant, "operator")}
                    className="mt-2 rounded-lg border border-koma-border px-3 py-2 font-semibold disabled:opacity-50">
                    {tenant.permissions?.operator_allowed ? "Suspender comandas" : "Autorizar comandas"}
                  </button>
                </div>
                <div>
                  <p>Avisos ao cliente: <strong>{tenant.permissions?.customer_effective ? "Ativos" : tenant.permissions?.customer_allowed ? "Permitidos, exigem autorização da loja" : "Não autorizados"}</strong></p>
                  <p className="text-koma-muted">Permissão da loja: {tenant.permissions?.customer_requested ? "Sim" : "Não"}</p>
                  <button type="button" disabled={busyId !== null || loading || !tenant.permissions}
                    onClick={() => void change(tenant, "customer")}
                    className="mt-2 rounded-lg border border-koma-border px-3 py-2 font-semibold disabled:opacity-50">
                    {tenant.permissions?.customer_allowed ? "Suspender avisos" : "Autorizar avisos"}
                  </button>
                </div>
              </div>
              <div className="mt-3 border-t border-koma-border pt-2 text-koma-muted">
                {tenant.usage.attempts} tentativas · {tenant.usage.accepted} aceites HTTP · {tenant.usage.failed} falhas · {tenant.usage.discarded} descartes · {tenant.usage.deferred} adiamentos
                <span className="ml-2">· {tenant.queue.total} aguardando</span>
                {tenant.queue.ttl_risk && <span className="ml-2 text-amber-400"><AlertTriangle className="mr-1 inline h-3 w-3" />Fila próxima de expirar</span>}
                <p className="mt-1">Fila mais antiga: {tenant.queue.oldest_seconds == null ? "—" : `${tenant.queue.oldest_seconds}s`}; espera média de tentativas: {tenant.usage.average_queue_ms == null ? "—" : `${tenant.usage.average_queue_ms}ms`}. Não equivale a entrega no aparelho.</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs text-koma-muted">
          <span>Mostrando {data.tenants.length} de {data.total_restaurants} restaurantes · {optionalDate(data.checked_at)}</span>
          <div className="flex gap-2">
            <button type="button" disabled={loading || offset === 0} onClick={() => void refresh(false, Math.max(0, offset - 25))} className="rounded border border-koma-border px-2 py-1 disabled:opacity-40">Anterior</button>
            <button type="button" disabled={loading || offset + data.page_limit >= data.total_restaurants} onClick={() => void refresh(false, offset + 25)} className="rounded border border-koma-border px-2 py-1 disabled:opacity-40">Próxima</button>
          </div>
        </div>
      </>}
    </section>
  );
}
