import React, { useState, useEffect, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  Clock,
  ExternalLink,
  GitBranch,
  Globe,
  HelpCircle,
  Layers,
  Mail,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

export interface IntegrationServiceItem {
  id: string;
  name: string;
  category: string;
  purpose: string;
  status: "connected" | "warning" | "degraded" | "disconnected" | "not_configured" | string;
  configured: boolean;
  latency_ms: number | null;
  last_checked_at: string;
  console_url: string;
  detail: string;
}

interface IntegrationRegistryResponse {
  services: IntegrationServiceItem[];
  checked_at: string;
}

const serviceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  linear: Layers,
  posthog: BarChart2,
  github: GitBranch,
  railway: Server,
  cloudflare: Globe,
  resend: Mail,
};

export function SuperAdminIntegrationRegistry() {
  const [services, setServices] = useState<IntegrationServiceItem[]>([]);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchRegistry = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await superAdminFetch("/api/super-admin/integrations/registry");
      if (!response.ok) {
        throw new Error(`Falha ao obter status das integrações (HTTP ${response.status})`);
      }
      const data: IntegrationRegistryResponse = await response.json();
      setServices(data.services || []);
      setLastChecked(data.checked_at || null);
    } catch (err) {
      setServices([]);
      setLastChecked(null);
      setErrorMessage(superAdminErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  const getStatusBadge = (status: string, serviceId?: string) => {
    switch (status) {
      case "connected":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Conectado
          </span>
        );
      case "warning":
      case "degraded":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-950/60 px-2.5 py-0.5 text-[11px] font-bold text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Atenção / Degradado
          </span>
        );
      case "disconnected":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-950/60 px-2.5 py-0.5 text-[11px] font-bold text-rose-400">
            <XCircle className="h-3 w-3" /> Desconectado
          </span>
        );
      case "not_configured":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/80 px-2.5 py-0.5 text-[11px] font-bold text-zinc-400">
            <HelpCircle className="h-3 w-3" /> {["railway", "cloudflare", "linear"].includes(serviceId || "") ? "Acesso opcional não habilitado" : "Não configurado"}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/80 px-2.5 py-0.5 text-[11px] font-bold text-zinc-400">
            <HelpCircle className="h-3 w-3" /> Não verificado
          </span>
        );
    }
  };

  const formatTimestamp = (isoString?: string | null) => {
    if (!isoString) return "—";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="rounded-xl border border-[#1e293b] bg-koma-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-koma-foreground">Integrações da plataforma</h2>
            </div>
            <p className="mt-1 text-xs text-koma-muted">
              Consultas verificadas e acessos opcionais. Cada serviço informa o que foi testado e o que ainda falta.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {lastChecked && (
              <span className="inline-flex items-center gap-1 text-[11px] text-koma-muted">
                <Clock className="h-3.5 w-3.5" />
                Último probe: {formatTimestamp(lastChecked)}
              </span>
            )}
            <button
              type="button"
              onClick={fetchRegistry}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-koma-page px-3 py-1.5 text-xs font-bold text-koma-secondary transition hover:border-zinc-700 hover:text-koma-foreground disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin text-[#00b894]" : ""}`} />
              Testar conexões agora
            </button>
          </div>
        </div>
      </div>

      {/* Alerta de erro caso ocorra */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-800/40 bg-rose-950/20 p-4 text-xs text-rose-300">
          <p className="font-semibold">Erro ao sondar integrações:</p>
          <p className="mt-1 text-[11px] text-rose-400">{errorMessage}</p>
        </div>
      )}

      {/* Grid de Serviços */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {services.map((item) => {
          const Icon = serviceIcons[item.id] || Activity;
          return (
            <div
              key={item.id}
              className="flex flex-col justify-between rounded-xl border border-zinc-800/80 bg-koma-card p-5 shadow-sm transition hover:border-zinc-700"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-koma-page text-[#00b894]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-koma-foreground">{item.name}</h3>
                      <span className="text-[10px] uppercase tracking-wider text-koma-muted">
                        {({control_plane: "Engenharia", product_analytics: "Análise de produto", code_ci: "Código e publicação", runtime_infra: "Hospedagem", edge_dns: "Domínios", transactional_email: "E-mails"} as Record<string, string>)[item.category] || item.category}
                      </span>
                    </div>
                  </div>
                  {getStatusBadge(item.status, item.id)}
                </div>

                <p className="mt-3 text-xs leading-relaxed text-koma-secondary">{item.purpose}</p>

                <div className="mt-4 space-y-1.5 rounded-lg border border-zinc-800/60 bg-koma-page p-3 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-koma-muted">Diagnóstico:</span>
                    <span className="max-w-[190px] truncate font-medium text-koma-foreground" title={item.detail}>
                      {item.detail}
                    </span>
                  </div>
                  {item.latency_ms !== null && item.latency_ms !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-koma-muted">Latência:</span>
                      <span className="font-mono text-emerald-400">{item.latency_ms} ms</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-koma-muted">Sondagem:</span>
                    <span className="text-koma-secondary">{formatTimestamp(item.last_checked_at)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-zinc-800/80">
                <a
                  href={item.console_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700/80 bg-koma-page px-3 py-2 text-xs font-bold text-koma-foreground transition hover:border-[#00b894]/50 hover:bg-emerald-950/20 hover:text-emerald-300"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Abrir console / painel
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SuperAdminIntegrationRegistry;
