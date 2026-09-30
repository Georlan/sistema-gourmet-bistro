import React from "react";
import {
  ClipboardList,
  CreditCard,
  ReceiptText,
  Sparkles,
  Store,
  UsersRound,
} from "lucide-react";
import type { Tenant } from "./superAdminTypes";
import {
  SuperAdminContractsTab,
  type ContractInboxItem,
} from "./SuperAdminContractsTab";
import { SuperAdminSignupsTab } from "./SuperAdminSignupsTab";
import { SuperAdminTenantsTab } from "./SuperAdminTenantsTab";
import { SuperAdminTrialsTab } from "./SuperAdminTrialsTab";
import { SuperAdminAccessTab } from "./SuperAdminAccessTab";
import { SuperAdminPaymentsTab } from "./SuperAdminPaymentsTab";
import { SuperAdminBillingTab } from "./SuperAdminBillingTab";

export type ClientsView =
  | "new"
  | "restaurants"
  | "trials"
  | "access"
  | "payments"
  | "billing";

export type NewClientsView = "signups" | "contracts";

interface SuperAdminClientsHubProps {
  tenants: Tenant[];
  tenantsAvailable: boolean;
  isLoadingTenants: boolean;
  refreshTenants: () => void;
  globalSearch: string;
  contracts: ContractInboxItem[];
  contractsAvailable: boolean;
  isLoadingContracts: boolean;
  pendingContractsCount: number;
  refreshContracts: () => Promise<void>;
  activeView: ClientsView;
  onChangeView: (view: ClientsView) => void;
  activeNewClientsView: NewClientsView;
  onChangeNewClientsView: (view: NewClientsView) => void;
}

const clientViews = [
  { id: "new" as const, label: "Novos clientes", icon: ClipboardList },
  { id: "restaurants" as const, label: "Restaurantes", icon: Store },
];

const restaurantTools = [
  { id: "trials" as const, label: "Períodos grátis", icon: Sparkles },
  { id: "access" as const, label: "Equipe e acessos", icon: UsersRound },
  { id: "payments" as const, label: "Pagamentos", icon: CreditCard },
  { id: "billing" as const, label: "Planos", icon: ReceiptText },
];

export function SuperAdminClientsHub({
  tenants,
  tenantsAvailable,
  isLoadingTenants,
  refreshTenants,
  globalSearch,
  contracts,
  contractsAvailable,
  isLoadingContracts,
  pendingContractsCount,
  refreshContracts,
  activeView,
  onChangeView,
  activeNewClientsView,
  onChangeNewClientsView,
}: SuperAdminClientsHubProps) {
  const isRestaurantContext = activeView !== "new";

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#1e293b] bg-koma-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground">Clientes</h2>
            <p className="mt-1 text-xs text-koma-muted">
              Aquisição, implantação e operação dos restaurantes em um único contexto.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {clientViews.map((item) => {
              const Icon = item.icon;
              const selected = item.id === "new"
                ? activeView === "new"
                : isRestaurantContext;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeView(item.id)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                    selected
                      ? "border-[#00b894]/60 bg-[#00b894]/10 text-[#00b894]"
                      : "border-zinc-800 bg-koma-page text-koma-secondary hover:border-zinc-700 hover:text-koma-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  {item.id === "new" && pendingContractsCount > 0 && (
                    <span className="rounded-full bg-amber-950 px-1.5 py-0.5 text-[9px] text-amber-300">
                      {pendingContractsCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {isRestaurantContext && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={() => onChangeView("restaurants")}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold ${
                activeView === "restaurants"
                  ? "border-[#00b894]/60 bg-[#00b894]/10 text-[#00b894]"
                  : "border-zinc-800 text-koma-muted hover:text-koma-foreground"
              }`}
            >
              Lista de restaurantes
            </button>
            {restaurantTools.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeView(item.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold ${
                    activeView === item.id
                      ? "border-[#00b894]/60 bg-[#00b894]/10 text-[#00b894]"
                      : "border-zinc-800 text-koma-muted hover:text-koma-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {activeView === "new" && (
        <div className="space-y-4">
          <div className="flex gap-2 rounded-xl border border-zinc-800 bg-koma-card p-2">
            <button
              type="button"
              onClick={() => onChangeNewClientsView("signups")}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${
                activeNewClientsView === "signups"
                  ? "bg-[#00b894] text-black"
                  : "text-koma-muted hover:bg-koma-page hover:text-koma-foreground"
              }`}
            >
              Inscrições
            </button>
            <button
              type="button"
              onClick={() => onChangeNewClientsView("contracts")}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${
                activeNewClientsView === "contracts"
                  ? "bg-[#00b894] text-black"
                  : "text-koma-muted hover:bg-koma-page hover:text-koma-foreground"
              }`}
            >
              Contratações
              {pendingContractsCount > 0 ? ` (${pendingContractsCount})` : ""}
            </button>
          </div>

          {activeNewClientsView === "signups" ? (
            <SuperAdminSignupsTab globalSearch={globalSearch} />
          ) : (
            <SuperAdminContractsTab
              items={contracts}
              isLoading={isLoadingContracts}
              available={contractsAvailable}
              globalSearch={globalSearch}
              refreshContracts={refreshContracts}
            />
          )}
        </div>
      )}

      {activeView === "restaurants" && (
        <SuperAdminTenantsTab
          tenants={tenants}
          tenantsAvailable={tenantsAvailable}
          isLoading={isLoadingTenants}
          refreshTenants={refreshTenants}
          globalSearch={globalSearch}
        />
      )}
      {activeView === "trials" && (
        <SuperAdminTrialsTab
          tenants={tenants}
          globalSearch={globalSearch}
          refreshTenants={refreshTenants}
        />
      )}
      {activeView === "access" && <SuperAdminAccessTab globalSearch={globalSearch} />}
      {activeView === "payments" && (
        <SuperAdminPaymentsTab tenants={tenants} tenantsAvailable={tenantsAvailable} />
      )}
      {activeView === "billing" && (
        <SuperAdminBillingTab tenants={tenants} tenantsAvailable={tenantsAvailable} />
      )}
    </div>
  );
}

export default SuperAdminClientsHub;
