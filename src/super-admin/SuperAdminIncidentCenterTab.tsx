import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Database,
  Info,
  Play,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  Users,
  X,
} from "lucide-react";
import { superAdminFetch } from "./superAdminApi";
import type { Tenant } from "./superAdminTypes";

export type IncidentSeverity = "critical" | "high" | "medium" | "low" | "info";
export type IncidentSource = "outbox" | "mercado_pago" | "impressao" | "acesso" | "tenant";

export interface IncidentItem {
  id: string;
  tenant_id: number;
  tenant_name: string;
  source: IncidentSource;
  severity: IncidentSeverity;
  title: string;
  detail: string;
  evidence: Record<string, any>;
  detected_at: string;
  last_seen_at?: string | null;
  recommended_action: string;
  action_available: boolean;
  action_type?: string | null;
  action_target_id?: string | null;
}

interface SummaryData {
  total: number;
  by_severity: Record<string, number>;
  by_source: Record<string, number>;
}

interface SuperAdminIncidentCenterTabProps {
  tenants: Tenant[];
  globalSearch: string;
}

function severityBadge(severity: IncidentSeverity) {
  switch (severity) {
    case "critical":
      return (
        <span className="inline-flex items-center gap-1 rounded border border-rose-800/60 bg-rose-950/70 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-300">
          <AlertOctagon className="h-3 w-3" /> Crítico
        </span>
      );
    case "high":
      return (
        <span className="inline-flex items-center gap-1 rounded border border-amber-800/60 bg-amber-950/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
          <AlertTriangle className="h-3 w-3" /> Alto
        </span>
      );
    case "medium":
      return (
        <span className="inline-flex items-center gap-1 rounded border border-yellow-800/60 bg-yellow-950/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-300">
          <AlertCircle className="h-3 w-3" /> Médio
        </span>
      );
    case "low":
      return (
        <span className="inline-flex items-center gap-1 rounded border border-blue-800/60 bg-blue-950/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-300">
          <Info className="h-3 w-3" /> Baixo
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400">
          Info
        </span>
      );
  }
}

function sourceIcon(source: IncidentSource) {
  switch (source) {
    case "outbox":
      return <span title="Transactional Outbox"><Database className="h-3.5 w-3.5 text-indigo-400" /></span>;
    case "mercado_pago":
      return <span title="Mercado Pago"><CreditCard className="h-3.5 w-3.5 text-cyan-400" /></span>;
    case "impressao":
      return <span title="Core de Impressão"><Printer className="h-3.5 w-3.5 text-amber-400" /></span>;
    case "acesso":
      return <span title="Acessos e Equipe"><Users className="h-3.5 w-3.5 text-purple-400" /></span>;
    case "tenant":
      return <span title="Status do Tenant"><Store className="h-3.5 w-3.5 text-rose-400" /></span>;
  }
}

function sourceLabel(source: IncidentSource) {
  switch (source) {
    case "outbox":
      return "Outbox";
    case "mercado_pago":
      return "Mercado Pago";
    case "impressao":
      return "Impressão";
    case "acesso":
      return "Acessos";
    case "tenant":
      return "Tenant";
  }
}

export function SuperAdminIncidentCenterTab({
  tenants,
  globalSearch,
}: SuperAdminIncidentCenterTabProps) {
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const [selectedTenantFilter, setSelectedTenantFilter] = useState<string>("ALL");
  const [selectedSourceFilter, setSelectedSourceFilter] = useState<string>("ALL");
  const [selectedSeverityFilter, setSelectedSeverityFilter] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});

  // Modal de Ação Corretiva
  const [actionIncident, setActionIncident] = useState<IncidentItem | null>(null);
  const [actionReason, setActionReason] = useState<string>("");
  const [isSubmittingAction, setIsSubmittingAction] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchIncidents = async () => {
    setIsLoading(true);
    setErrorNotice(null);
    try {
      const params = new URLSearchParams();
      if (selectedTenantFilter !== "ALL") params.append("tenant_id", selectedTenantFilter);
      if (selectedSourceFilter !== "ALL") params.append("source", selectedSourceFilter);
      if (selectedSeverityFilter !== "ALL") params.append("severity", selectedSeverityFilter);

      const [incidentsRes, summaryRes] = await Promise.all([
        superAdminFetch(`/api/super-admin/incidents?${params.toString()}`),
        superAdminFetch(`/api/super-admin/incidents/summary${selectedTenantFilter !== "ALL" ? `?tenant_id=${selectedTenantFilter}` : ""}`),
      ]);

      if (!incidentsRes.ok) throw new Error("Falha ao consultar diagnósticos de incidentes.");
      const incidentsData = await incidentsRes.json();
      setIncidents(Array.isArray(incidentsData) ? incidentsData : []);

      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        setSummary(summaryData);
      }
    } catch (err: any) {
      setErrorNotice(err?.message || "Erro de conexão ao carregar Central de Incidentes.");
      setIncidents([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, [selectedTenantFilter, selectedSourceFilter, selectedSeverityFilter]);

  const toggleEvidence = (id: string) => {
    setExpandedEvidence((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const effectiveSearch = (globalSearch || searchTerm).toLowerCase().trim();
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      if (!effectiveSearch) return true;
      return (
        inc.title.toLowerCase().includes(effectiveSearch) ||
        inc.detail.toLowerCase().includes(effectiveSearch) ||
        inc.tenant_name.toLowerCase().includes(effectiveSearch) ||
        String(inc.tenant_id).includes(effectiveSearch) ||
        inc.source.toLowerCase().includes(effectiveSearch)
      );
    });
  }, [incidents, effectiveSearch]);

  const handleExecuteAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionIncident || !actionIncident.action_type || !actionIncident.action_target_id) return;

    if (actionReason.trim().length < 3) {
      setActionError("O motivo da ação corretiva é obrigatório (mínimo 3 caracteres).");
      return;
    }

    setIsSubmittingAction(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const response = await superAdminFetch("/api/super-admin/incidents/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action_type: actionIncident.action_type,
          target_id: actionIncident.action_target_id,
          reason: actionReason.trim(),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || "Falha ao executar ação corretiva.");
      }

      const resData = await response.json();
      setActionSuccess(resData.message || "Ação corretiva executada com sucesso.");
      setTimeout(() => {
        setActionIncident(null);
        setActionReason("");
        setActionSuccess(null);
        fetchIncidents();
      }, 1200);
    } catch (err: any) {
      setActionError(err?.message || "Erro inesperado ao executar ação.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-5 lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <AlertOctagon className="h-6 w-6 text-rose-400" />
            <h2 className="text-xl font-bold tracking-tight text-zinc-100">
              Central de Incidentes & Diagnóstico Operacional
            </h2>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Diagnóstico em tempo real baseado exclusivamente em evidências concretas das tabelas
            de mensageria (Outbox), pagamentos, webhooks, impressão e integridade de acessos.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchIncidents}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
            title="Atualizar diagnósticos operacionais"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin text-[#00b894]" : ""}`} />
            Atualizar Diagnósticos
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 p-4">
            <div className="flex items-center justify-between text-xs text-rose-300">
              <span>Críticos</span>
              <AlertOctagon className="h-4 w-4 text-rose-400" />
            </div>
            <p className="mt-2 text-2xl font-black text-rose-200">
              {summary.by_severity.critical || 0}
            </p>
          </div>

          <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4">
            <div className="flex items-center justify-between text-xs text-amber-300">
              <span>Altos</span>
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            </div>
            <p className="mt-2 text-2xl font-black text-amber-200">
              {summary.by_severity.high || 0}
            </p>
          </div>

          <div className="rounded-xl border border-yellow-900/30 bg-yellow-950/20 p-4">
            <div className="flex items-center justify-between text-xs text-yellow-300">
              <span>Médios</span>
              <AlertCircle className="h-4 w-4 text-yellow-400" />
            </div>
            <p className="mt-2 text-2xl font-bold text-yellow-200">
              {summary.by_severity.medium || 0}
            </p>
          </div>

          <div className="rounded-xl border border-blue-900/30 bg-blue-950/20 p-4">
            <div className="flex items-center justify-between text-xs text-blue-300">
              <span>Baixos / Info</span>
              <Info className="h-4 w-4 text-blue-400" />
            </div>
            <p className="mt-2 text-2xl font-bold text-blue-200">
              {(summary.by_severity.low || 0) + (summary.by_severity.info || 0)}
            </p>
          </div>

          <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:col-span-1">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Total Ativos</span>
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            </div>
            <p className="mt-2 text-2xl font-bold text-zinc-100">
              {summary.total || 0}
            </p>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar por título, detalhe ou ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-[#00b894] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Tenant filter */}
          <select
            value={selectedTenantFilter}
            onChange={(e) => setSelectedTenantFilter(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 focus:border-[#00b894] focus:outline-none"
          >
            <option value="ALL">Todos os Restaurantes</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.id} - {t.name}
              </option>
            ))}
          </select>

          {/* Source filter */}
          <select
            value={selectedSourceFilter}
            onChange={(e) => setSelectedSourceFilter(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 focus:border-[#00b894] focus:outline-none"
          >
            <option value="ALL">Todas as Origens</option>
            <option value="outbox">Outbox</option>
            <option value="mercado_pago">Mercado Pago</option>
            <option value="impressao">Impressão</option>
            <option value="acesso">Acessos</option>
            <option value="tenant">Tenant</option>
          </select>

          {/* Severity filter */}
          <select
            value={selectedSeverityFilter}
            onChange={(e) => setSelectedSeverityFilter(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 focus:border-[#00b894] focus:outline-none"
          >
            <option value="ALL">Todas as Severidades</option>
            <option value="critical">Crítico</option>
            <option value="high">Alto</option>
            <option value="medium">Médio</option>
            <option value="low">Baixo</option>
          </select>
        </div>
      </div>

      {errorNotice && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-800/60 bg-rose-950/40 p-3 text-xs text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorNotice}</span>
        </div>
      )}

      {/* Incidents List */}
      <div className="space-y-3">
        {isLoading && incidents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
            <RefreshCw className="h-8 w-8 animate-spin text-[#00b894]" />
            <p className="mt-3 text-xs">Diagnosticando subsistemas em tempo real...</p>
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-12 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400/80" />
            <h3 className="mt-3 text-sm font-bold text-zinc-200">
              Nenhum incidente detectado nas fontes monitoradas.
            </h3>
            <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
              Nenhum erro ativo foi encontrado na fila do Outbox, webhooks do Mercado Pago,
              agentes de impressão ou integridade de equipe para os filtros selecionados.
            </p>
          </div>
        ) : (
          filteredIncidents.map((inc) => {
            const isExpanded = !!expandedEvidence[inc.id];
            return (
              <div
                key={inc.id}
                className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {severityBadge(inc.severity)}
                      <span className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
                        {sourceIcon(inc.source)}
                        <span>{sourceLabel(inc.source)}</span>
                      </span>
                      <span className="text-xs font-semibold text-zinc-300">
                        {inc.tenant_name}{" "}
                        <span className="font-mono text-zinc-500">#{inc.tenant_id}</span>
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-zinc-100">{inc.title}</h4>
                    <p className="text-xs text-zinc-300 leading-relaxed">{inc.detail}</p>

                    <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-300/90 bg-amber-950/30 border border-amber-900/30 rounded-lg p-2">
                      <span className="font-semibold text-amber-200">Ação recomendada:</span>
                      <span>{inc.recommended_action}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className="font-mono text-[11px] text-zinc-500" title={inc.detected_at}>
                      {new Date(inc.detected_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleEvidence(inc.id)}
                        className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                      >
                        Evidência {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>

                      {inc.action_available && (
                        <button
                          type="button"
                          onClick={() => {
                            setActionIncident(inc);
                            setActionReason("");
                            setActionError(null);
                            setActionSuccess(null);
                          }}
                          className="flex items-center gap-1 rounded bg-[#00b894] px-2.5 py-1 text-[11px] font-bold text-black hover:bg-[#00a884] shadow-sm shadow-[#00b894]/20"
                        >
                          <Play className="h-3 w-3 fill-black" />
                          Resolver
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 border-t border-zinc-800/80 pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Evidência técnica estruturada:
                    </span>
                    <pre className="mt-1 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300">
                      {JSON.stringify(inc.evidence, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal de Execução de Ação Corretiva */}
      {actionIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-[#00b894]">
                <Play className="h-5 w-5 fill-[#00b894]" />
                <h3 className="text-base font-bold text-zinc-100">
                  Executar Ação Corretiva
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActionIncident(null)}
                className="text-zinc-400 hover:text-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-300">
              <p>
                <strong>Incidente:</strong> {actionIncident.title}
              </p>
              <p>
                <strong>Estabelecimento:</strong> {actionIncident.tenant_name} (#{actionIncident.tenant_id})
              </p>
              <p>
                <strong>Ação:</strong>{" "}
                <span className="font-mono text-[#00b894]">
                  {actionIncident.action_type}
                </span>
              </p>
            </div>

            <form onSubmit={handleExecuteAction} className="space-y-4 text-xs">
              <label className="block">
                <span className="mb-1 block font-medium text-zinc-300">
                  Motivo da Intervenção <span className="text-rose-400">*</span>
                </span>
                <textarea
                  rows={3}
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  required
                  placeholder="Ex: Falha na impressora resolvida no local; reenviando comanda."
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-zinc-100 placeholder:text-zinc-500 focus:border-[#00b894] focus:outline-none"
                />
                <span className="mt-1 block text-[10px] text-zinc-500">
                  Obrigatório para a trilha de auditoria append-only do Super Admin.
                </span>
              </label>

              {actionError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-800/60 bg-rose-950/40 p-2.5 text-xs text-rose-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {actionSuccess && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-800/60 bg-emerald-950/40 p-2.5 text-xs text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{actionSuccess}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3">
                <button
                  type="button"
                  onClick={() => setActionIncident(null)}
                  disabled={isSubmittingAction}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAction}
                  className="flex items-center gap-1.5 rounded-lg bg-[#00b894] px-4 py-2 font-bold text-black hover:bg-[#00a884] disabled:opacity-50"
                >
                  {isSubmittingAction ? "Executando..." : "Confirmar e Executar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
