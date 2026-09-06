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
import { KomaSnapshotLoading } from "../components/shared/KomaSnapshotLoading";
import type { SuperAdminAuditLogEntry } from "./superAdminTypes";
import { superAdminFetch, superAdminErrorMessage } from "./superAdminApi";

export interface AuditLogItem {
  id: string;
  timestamp: string;
  level: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  source: string;
  message: string;
}

export interface SuperAdminAuditTabProps {
  logs?: AuditLogItem[];
  onClearLogs?: () => void;
}

export function SuperAdminAuditTab({ }: SuperAdminAuditTabProps) {
  const [auditLogs, setAuditLogs] = useState<SuperAdminAuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchAuditLogs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await superAdminFetch("/api/super-admin/audit");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setAuditLogs(data);
          setHasSnapshot(true);
        } else {
          throw new Error("Formato inválido da trilha de auditoria.");
        }
      } else {
        const errPayload = await res.json().catch(() => null);
        setError(errPayload?.detail || "Falha ao carregar trilha de auditoria.");
      }
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchAuditLogs();
  }, []);

  const filteredLogs = auditLogs.filter(log => {
    if (actionFilter === "ALL") return true;
    return log.action === actionFilter;
  });

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

  if (!hasSnapshot) {
    return (
      <KomaSnapshotLoading
        testId="superadmin-audit-snapshot-loading"
        title="Sincronizando auditoria"
        description="Carregando a trilha persistente antes de concluir que não existem registros."
        error={!isLoading ? error : null}
        errorDescription="Ainda não foi possível confirmar a trilha de auditoria. Nenhum histórico vazio será presumido."
        onRetry={() => void fetchAuditLogs()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
              <History className="w-5 h-5 text-[#00b894]" />
              Trilha de Auditoria Persistente
            </h2>
            <p className="text-xs text-koma-muted mt-0.5">
              Registro cronológico imutável (append-only) de todas as intervenções do Super Admin
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              className="bg-koma-page border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-koma-foreground focus:outline-none focus:border-[#00b894]"
            >
              <option value="ALL">Todas as Ações</option>
              <option value="SUPERADMIN_TENANT_UPDATE">Edições de Cadastro</option>
              <option value="SUPERADMIN_TENANT_SUSPEND">Suspensões</option>
              <option value="SUPERADMIN_TENANT_REACTIVATE">Reativações</option>
            </select>

            <button
              type="button"
              onClick={() => void fetchAuditLogs()}
              disabled={isLoading}
              className="p-2 bg-koma-page border border-zinc-800 hover:border-zinc-700 rounded-lg text-koma-secondary hover:text-koma-foreground transition-colors disabled:opacity-50 cursor-pointer"
              title="Atualizar trilha de auditoria"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/40 border border-rose-800/50 rounded-lg text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm">
        {filteredLogs.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <ShieldCheck className="w-8 h-8 text-[#00b894] mx-auto opacity-80" />
            <p className="text-xs font-semibold text-koma-foreground">
              Nenhum registro de auditoria encontrado
            </p>
            <p className="text-[11px] text-koma-muted">
              Mutações administrativas realizadas no Super Admin são persistidas no banco e exibidas aqui.
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
