import React from "react";
import { Activity, History, Settings } from "lucide-react";
import { SuperAdminAuditTab } from "./SuperAdminAuditTab";
import { SuperAdminOperationsTab } from "./SuperAdminOperationsTab";
import { SuperAdminSettingsTab } from "./SuperAdminSettingsTab";

export type PlatformView = "health" | "integrations" | "audit";

interface SuperAdminPlatformHubProps {
  activeView: PlatformView;
  onChangeView: (view: PlatformView) => void;
  onAddLog: (
    text: string,
    level?: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | "info" | "warning" | "error" | "critical" | "success",
    source?: string,
  ) => void;
  onTriggerTelegramAlert: (text: string) => Promise<boolean>;
}

const views = [
  { id: "health" as const, label: "Saúde", icon: Activity },
  { id: "integrations" as const, label: "Integrações", icon: Settings },
  { id: "audit" as const, label: "Auditoria", icon: History },
];

export function SuperAdminPlatformHub({
  activeView,
  onChangeView,
  onAddLog,
  onTriggerTelegramAlert,
}: SuperAdminPlatformHubProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#1e293b] bg-koma-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground">Plataforma</h2>
            <p className="mt-1 text-xs text-koma-muted">
              Saúde técnica, integrações e governança do KÔMA sem confundir configuração com disponibilidade.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {views.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeView(item.id)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${
                    activeView === item.id
                      ? "border-[#00b894]/60 bg-[#00b894]/10 text-[#00b894]"
                      : "border-zinc-800 bg-koma-page text-koma-secondary hover:border-zinc-700 hover:text-koma-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeView === "health" && (
        <SuperAdminOperationsTab
          onAddLog={onAddLog}
          onTriggerTelegramAlert={onTriggerTelegramAlert}
        />
      )}
      {activeView === "integrations" && (
        <SuperAdminSettingsTab
          onAddLog={onAddLog}
          onTriggerTelegramAlert={onTriggerTelegramAlert}
        />
      )}
      {activeView === "audit" && <SuperAdminAuditTab />}
    </div>
  );
}

export default SuperAdminPlatformHub;
