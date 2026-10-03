import React, { useState, useEffect } from "react";
import {
  History,
  ShieldCheck,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  User,
  Store,
  FileText,
  AlertCircle,
} from "lucide-react";
import type { SuperAdminAuditLogEntry } from "./superAdminTypes";
import { filterAuditLogs } from "./auditFilters";
import { superAdminFetch, superAdminErrorMessage } from "./superAdminApi";

export interface AuditLogItem {
  id: string;
  timestamp: string;
  level: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  source: string;
  message: string;
}

export function SuperAdminAuditTab({ tenantId }: { tenantId?: string }) {
  const [auditLogs, setAuditLogs] = useState<SuperAdminAuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState("ALL");
  const [actorFilter, setActorFilter] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchAuditLogs = async () => {
    setIsLoading(true);
    setError(null);
    setAuditLogs([]);
    try {
      const res = await superAdminFetch(`/api/super-admin/audit${tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setAuditLogs(data);
        } else {
          throw new Error("Resposta de auditoria inválida.");
        }
      } else {
        const errPayload = await res.json().catch(() => null);
        setError(errPayload?.detail || "Falha ao carregar trilha de auditoria.");
        setAuditLogs([]);
      }
    } catch (err) {
      setError(superAdminErrorMessage(err));
      setAuditLogs([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, [tenantId]);

  const filteredLogs = filterAuditLogs(auditLogs, {
    action: actionFilter, tenant: tenantId || tenantFilter, actor: actorFilter,
    search, fromDate, toDate,
  });
  const tenantOptions = Array.from(new Map(auditLogs.map(log => [log.restauranteId, log.restaurantName])).entries());
  const actorOptions = Array.from(new Set(auditLogs.map(log => log.actor))).sort();

  const actionOptions = Array.from(new Set(auditLogs.map(log => log.action))).sort();

  const toggleExpand = (id: string) => {
    setExpandedLogId(prev => (prev === id ? null : id));
  };

  const actionBadge = (action: string) => {
    switch (action) {
      case "SUPERADMIN_TENANT_SUSPEND":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/60 text-rose-300 border border-rose-800/40">
            SUSPENSÃO
          </span>
        );
      case "SUPERADMIN_TENANT_REACTIVATE":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
            REATIVAÇÃO
          </span>
        );
      case "SUPERADMIN_TENANT_UPDATE":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950/60 text-blue-300 border border-blue-800/40">
            EDIÇÃO
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-koma-secondary">
            {action}
          </span>
        );
    }
  };

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return "—";
    const d = new Date(isoString);
    return Number.isNaN(d.getTime()) ? isoString : d.toLocaleString("pt-BR");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
              <History className="w-5 h-5 text-[#00b894]" />
              Trilha de Auditoria Persistente
            </h2>
            <p className="text-xs text-koma-muted mt-0.5">
              {tenantId ? `Histórico administrativo do tenant #${tenantId}` : "Intervenções administrativas de todos os tenants"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              className="bg-koma-page border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-koma-foreground focus:outline-none focus:border-[#00b894]"
            >
              <option value="ALL">Todas as Ações</option>
              {actionOptions.map(action => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={fetchAuditLogs}
              disabled={isLoading}
              className="p-2 bg-koma-page border border-zinc-800 hover:border-zinc-700 rounded-lg text-koma-secondary hover:text-koma-foreground transition-colors disabled:opacity-50 cursor-pointer"
              title="Atualizar trilha de auditoria"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-koma-muted">Buscar ID, ator, motivo ou alteração
            <input value={search} onChange={e => setSearch(e.target.value)} type="search" className="mt-1 block rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-koma-foreground" />
          </label>
          {!tenantId && <label className="text-xs text-koma-muted">Restaurante
            <select value={tenantFilter} onChange={e => setTenantFilter(e.target.value)} className="mt-1 block rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-koma-foreground">
              <option value="ALL">Todos os restaurantes</option>
              {tenantOptions.map(([id, name]) => <option key={id} value={id}>#{id} — {name}</option>)}
            </select>
          </label>}
          <label className="text-xs text-koma-muted">Ator
            <select value={actorFilter} onChange={e => setActorFilter(e.target.value)} className="mt-1 block rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-koma-foreground">
              <option value="ALL">Todos os atores</option>
              {actorOptions.map(actor => <option key={actor} value={actor}>{actor}</option>)}
            </select>
          </label>
          <label className="text-xs text-koma-muted">De
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="mt-1 block rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-koma-foreground" />
          </label>
          <label className="text-xs text-koma-muted">Até
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="mt-1 block rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-koma-foreground" />
          </label>
          <button type="button" onClick={() => { setSearch(""); setTenantFilter("ALL"); setActorFilter("ALL"); setActionFilter("ALL"); setFromDate(""); setToDate(""); }} className="rounded-lg border border-zinc-800 px-3 py-2 text-xs text-koma-secondary">Limpar filtros</button>
        </div>
        <p className="text-[11px] text-koma-muted">
          {filteredLogs.length} de {auditLogs.length} registros retornados. {tenantId ? "Até 100 ações recentes deste tenant." : "Até 200 ações recentes da plataforma, com limite de 100 por tenant."} Os filtros pesquisam somente esta janela; eventos mais antigos podem existir.
        </p>

        {error && (
          <div className="p-3 bg-rose-950/40 border border-rose-800/50 rounded-lg text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Logs Table / List */}
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm">
        {filteredLogs.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            {error ? (
              <AlertCircle className="w-8 h-8 text-rose-400 mx-auto opacity-90" />
            ) : (
              <ShieldCheck className="w-8 h-8 text-[#00b894] mx-auto opacity-80" />
            )}
            <p className="text-xs font-semibold text-koma-foreground">
              {isLoading
                ? "Carregando auditoria..."
                : error
                  ? "Auditoria indisponível"
                  : actionFilter !== "ALL" || search || tenantFilter !== "ALL" || actorFilter !== "ALL" || fromDate || toDate
                    ? "Nenhum registro nesta janela para os filtros selecionados"
                    : "Nenhum registro de auditoria encontrado"}
            </p>
            <p className="text-[11px] text-koma-muted">
              {error
                ? "A consulta falhou; ausência de registros não deve ser interpretada como ausência de ações administrativas."
                : "Mutações administrativas realizadas no Super Admin são persistidas no banco e exibidas aqui."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredLogs.map(log => {
              const isExpanded = expandedLogId === log.id;
              const hasData = log.beforeData || log.afterData;

              return (
                <div
                  key={log.id}
                  className="p-4 rounded-xl border border-zinc-800 bg-koma-page/70 space-y-3 text-xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {actionBadge(log.action)}
                      <span className="font-bold text-koma-foreground flex items-center gap-1">
                        <Store className="w-3.5 h-3.5 text-[#00b894]" />
                        {log.restaurantName || `Restaurante #${log.restauranteId}`}
                      </span>
                      <span className="text-[11px] text-koma-subtle font-mono">
                        (ID #{log.restauranteId})
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-koma-muted font-mono text-[11px]">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3 text-koma-subtle" />
                        {log.actor}
                      </span>
                      <span>•</span>
                      <span>{formatDate(log.createdAt)}</span>
                    </div>
                  </div>

                  <p className="font-mono text-[11px] text-koma-muted">Registro #{log.id}</p>
                  <div className="flex items-start gap-2 bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800/80">
                    <FileText className="w-3.5 h-3.5 text-koma-subtle shrink-0 mt-0.5" />
                    <div>
                      <span className="text-koma-muted font-medium">Motivo: </span>
                      <span className="text-koma-secondary">{log.reason}</span>
                    </div>
                  </div>

                  {hasData && (
                    <div>
                      <button
                        type="button"
                        onClick={() => toggleExpand(log.id)}
                        className="text-[11px] text-koma-muted hover:text-[#00b894] flex items-center gap-1 font-semibold cursor-pointer"
                      >
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        {isExpanded ? "Ocultar snapshot dos dados" : "Ver alterações (before / after)"}
                      </button>

                      {isExpanded && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 pt-2 border-t border-zinc-800/60 font-mono text-[11px]">
                          <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                            <span className="text-koma-muted font-bold block mb-1">Estado Anterior (Before):</span>
                            <pre className="text-amber-300/80 whitespace-pre-wrap">
                              {JSON.stringify(log.beforeData || {}, null, 2)}
                            </pre>
                          </div>
                          <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                            <span className="text-koma-muted font-bold block mb-1">Novo Estado (After):</span>
                            <pre className="text-emerald-300/80 whitespace-pre-wrap">
                              {JSON.stringify(log.afterData || {}, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default SuperAdminAuditTab;
