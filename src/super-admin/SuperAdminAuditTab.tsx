import React, { useState } from "react";
import {
  History,
  ShieldCheck,
  Filter,
  Trash2,
  AlertTriangle,
  Info,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export interface AuditLogItem {
  id: string;
  timestamp: string;
  level: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  source: string;
  message: string;
}

interface SuperAdminAuditTabProps {
  logs: AuditLogItem[];
  onClearLogs: () => void;
}

export function SuperAdminAuditTab({ logs, onClearLogs }: SuperAdminAuditTabProps) {
  const [filter, setFilter] = useState<string>("ALL");

  const filteredLogs = logs.filter(log => {
    if (filter === "ALL") return true;
    return log.level === filter;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
              <History className="w-5 h-5 text-[#00b894]" />
              Trilha de Auditoria Operacional
            </h2>
            <p className="text-xs text-koma-muted mt-0.5">
              Registro cronológico de ações administrativas, mudanças de status e eventos de segurança
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="bg-koma-page border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-koma-foreground focus:outline-none focus:border-[#00b894]"
            >
              <option value="ALL">Todas as Severidades</option>
              <option value="INFO">Informações (INFO)</option>
              <option value="WARNING">Avisos (WARNING)</option>
              <option value="ERROR">Erros (ERROR)</option>
              <option value="CRITICAL">Críticos (CRITICAL)</option>
            </select>

            <button
              type="button"
              onClick={onClearLogs}
              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-koma-secondary hover:text-koma-foreground rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
              title="Limpar histórico da sessão"
            >
              <Trash2 className="w-3.5 h-3.5" /> Limpar
            </button>
          </div>
        </div>
      </div>

      {/* Logs Timeline / Table */}
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm">
        {filteredLogs.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <ShieldCheck className="w-8 h-8 text-[#00b894] mx-auto opacity-80" />
            <p className="text-xs font-semibold text-koma-foreground">Nenhum evento registrado no filtro atual</p>
            <p className="text-[11px] text-koma-muted">
              Ações executadas nesta sessão de Super Admin aparecerão aqui automaticamente.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredLogs.map(log => {
              const isCrit = log.level === "CRITICAL";
              const isErr = log.level === "ERROR";
              const isWarn = log.level === "WARNING";

              return (
                <div
                  key={log.id}
                  className={`p-3.5 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isCrit
                      ? "bg-rose-950/40 border-rose-800/60 text-rose-200"
                      : isErr
                      ? "bg-red-950/30 border-red-800/40 text-red-200"
                      : isWarn
                      ? "bg-amber-950/30 border-amber-800/40 text-amber-200"
                      : "bg-koma-page/80 border-zinc-800 text-koma-secondary"
                  }`}
                >
                  <div className="flex items-start sm:items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono shrink-0 ${
                      isCrit
                        ? "bg-rose-600 text-white"
                        : isErr
                        ? "bg-red-600 text-white"
                        : isWarn
                        ? "bg-amber-500 text-black"
                        : "bg-zinc-800 text-koma-muted"
                    }`}>
                      {log.level}
                    </span>

                    <div>
                      <p className="font-medium text-koma-foreground text-xs">{log.message}</p>
                      <span className="text-[10px] text-koma-muted font-mono">Fonte: {log.source}</span>
                    </div>
                  </div>

                  <span className="text-[11px] text-koma-muted font-mono shrink-0">
                    {log.timestamp}
                  </span>
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
