import React from "react";
import { Building2, ShieldAlert, Sliders } from "lucide-react";
import { Tenant } from "./SuperAdminTenantControl";

interface SuperAdminWhitelabelProps {
  tenants: Tenant[];
  selectedTenantId: string;
  setSelectedTenantId: (id: string) => void;
  onAddLog: (text: string, type: "info" | "success" | "warning" | "error" | "critical") => void;
  onTriggerTelegramAlert: (text: string) => void;
}

export default function SuperAdminWhitelabel({
  tenants,
  selectedTenantId,
  setSelectedTenantId,
}: SuperAdminWhitelabelProps) {
  const selectedTenant = tenants.find(tenant => tenant.id === selectedTenantId);

  return (
    <div className="space-y-6" id="superadmin-whitelabel-panel">
      <header className="rounded border border-[#1e293b]/40 bg-koma-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-koma-foreground">
          <Sliders className="h-4 w-4 text-[#00b894]" />
          Identidade visual por restaurante
        </h2>
        <p className="mt-1 text-xs text-koma-muted">
          Selecione o restaurante para verificar a disponibilidade do configurador.
        </p>
      </header>

      <section className="rounded border border-[#1e293b]/40 bg-koma-card p-5">
        <label htmlFor="whitelabel-tenant" className="mb-2 block text-xs font-bold text-koma-secondary">
          Restaurante
        </label>
        <select
          id="whitelabel-tenant"
          value={selectedTenantId}
          onChange={event => setSelectedTenantId(event.target.value)}
          className="w-full rounded border border-[#334155] bg-koma-page px-3 py-2 text-sm text-koma-foreground"
        >
          <option value="">Selecione...</option>
          {tenants.map(tenant => (
            <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
          ))}
        </select>
      </section>

      {selectedTenant && (
        <section className="rounded border border-[#1e293b]/40 bg-koma-card p-5">
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-5 w-5 text-koma-muted" />
            <div>
              <h3 className="font-bold text-koma-foreground">{selectedTenant.name}</h3>
              <p className="mt-1 text-xs text-koma-muted">{selectedTenant.subdomain}</p>
            </div>
          </div>
        </section>
      )}

      <section className="rounded border border-amber-800/60 bg-amber-950/20 p-5 text-amber-200" role="status">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h3 className="text-sm font-bold">Configurador indisponível no SuperAdmin</h3>
            <p className="mt-2 text-xs leading-relaxed">
              O backend ainda não oferece uma rota SuperAdmin auditável para ler ou alterar a identidade de outro restaurante. As rotas atuais do Caixa usam o contexto do próprio restaurante e não devem receber a sessão privilegiada do SuperAdmin. Nenhuma alteração local ou simulada será aplicada.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
