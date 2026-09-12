import clsx from 'clsx';
import React from 'react';
import { OperationalBanner } from '../../shared/OperationalBanner';
import type { useCashierSettings } from './useCashierSettings';
import { WAITER_PERMISSIONS } from './waiterPermissions';

type WaiterSettingsGroup = 'pedido' | 'fechamento' | 'atendimento';

type BoundaryProps = Pick<ReturnType<typeof useCashierSettings>, 'waiterPermissions' | 'updateConfiguracoes'> & {
  printingSettingsTab: 'impressao' | 'mesas' | 'garcom' | 'taxa';
  setConfigSalSubTab: React.Dispatch<React.SetStateAction<WaiterSettingsGroup>>;
  configSalSubTab: WaiterSettingsGroup;
};

const WAITER_SETTINGS_GROUPS = [
  {
    id: 'pedido',
    label: 'Pedidos',
    description: 'Criação, edição, cancelamento e envio para produção.',
  },
  {
    id: 'fechamento',
    label: 'Fechamento',
    description: 'O que o garçom pode fazer quando a conta vai ser encerrada.',
  },
  {
    id: 'atendimento',
    label: 'Atendimento',
    description: 'Transferências e recursos usados durante o serviço de mesa.',
  },
] as const;

/** One list renderer; definitions, values and mutation contracts are shared. */
export function CashierWaiterSettings({
  printingSettingsTab,
  waiterPermissions,
  setConfigSalSubTab,
  configSalSubTab,
  updateConfiguracoes,
}: BoundaryProps) {
  if (printingSettingsTab !== 'garcom') return null;

  const currentGroup = WAITER_SETTINGS_GROUPS.find((group) => group.id === configSalSubTab) ?? WAITER_SETTINGS_GROUPS[0];
  const currentPermissions = WAITER_PERMISSIONS.filter((item) => item.group === currentGroup.id);
  const availablePermissions = currentPermissions.filter((item) => item.available);
  const unavailablePermissions = currentPermissions.filter((item) => !item.available);
  const activeAvailablePermissions = availablePermissions.filter((item) => waiterPermissions[item.key]).length;
  const allAvailablePermissions = WAITER_PERMISSIONS.filter((item) => item.available);

  return (
    <>
      <OperationalBanner
        id="waiter-app-title"
        eyebrow="CONFIGURAÇÕES / EQUIPE"
        title="App do Garçom"
        accent="com autonomia sob controle"
        description="Defina apenas as ações que a equipe realmente pode executar. Recursos ainda não disponíveis aparecem separados e não podem ser ativados."
        metrics={[
          {
            label: 'permissões ativas',
            value: allAvailablePermissions.filter((item) => waiterPermissions[item.key]).length,
          },
          { label: 'ações disponíveis', value: allAvailablePermissions.length },
          { label: 'fechamento no app', value: waiterPermissions.perm_garcom_fechar ? 'Permitido' : 'Bloqueado' },
          { label: 'recursos futuros', value: WAITER_PERMISSIONS.filter((item) => !item.available).length },
        ]}
      />

      <section
        className="overflow-hidden rounded-[22px] border border-koma-border bg-koma-panel"
        aria-labelledby="waiter-permissions-heading"
      >
        <header className="border-b border-koma-border px-4 py-4 sm:px-5">
          <h3 id="waiter-permissions-heading" className="text-sm font-bold text-koma-foreground">
            Permissões da equipe
          </h3>
          <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-koma-muted">
            Escolha uma etapa do atendimento e libere somente o que o garçom precisa fazer no dia a dia.
          </p>
        </header>

        <nav
          className="grid gap-2 border-b border-koma-border bg-koma-page/60 p-3 sm:grid-cols-3 sm:p-4"
          aria-label="Etapas das permissões do App do Garçom"
        >
          {WAITER_SETTINGS_GROUPS.map((group) => {
            const selected = configSalSubTab === group.id;
            const groupPermissions = WAITER_PERMISSIONS.filter((item) => item.group === group.id && item.available);
            const activeCount = groupPermissions.filter((item) => waiterPermissions[item.key]).length;

            return (
              <button
                key={group.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setConfigSalSubTab(group.id)}
                className={clsx(
                  'min-h-[72px] rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                  selected
                    ? 'border-emerald-600 bg-emerald-500/10 text-emerald-800 dark:border-emerald-500/50 dark:text-emerald-200'
                    : 'border-koma-border bg-koma-card text-koma-secondary hover:border-koma-border-strong hover:bg-koma-raised hover:text-koma-foreground',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <strong className="text-xs">{group.label}</strong>
                  <span className="rounded-full border border-current/15 px-2 py-0.5 text-[8px] font-bold">
                    {activeCount}/{groupPermissions.length} ativas
                  </span>
                </span>
                <span className="mt-1.5 block text-[9px] font-medium leading-snug opacity-75">
                  {group.description}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="space-y-5 p-4 sm:p-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-koma-muted">
                {currentGroup.label}
              </span>
              <h4 className="mt-1 text-sm font-bold text-koma-foreground">Ações disponíveis agora</h4>
              <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">{currentGroup.description}</p>
            </div>
            <span className="text-[9px] font-bold text-koma-secondary">
              {activeAvailablePermissions} de {availablePermissions.length} liberadas
            </span>
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            {availablePermissions.map((item) => {
              const enabled = Boolean(waiterPermissions[item.key]);
              return (
                <label
                  key={item.key}
                  className="flex min-h-[88px] cursor-pointer items-start justify-between gap-4 rounded-2xl border border-koma-border bg-koma-card p-4 transition-colors hover:border-emerald-500/25"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="text-xs font-bold text-koma-foreground">{item.title}</strong>
                      <span
                        className={clsx(
                          'rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wide',
                          enabled ? 'koma-badge-success' : 'border border-koma-border bg-koma-raised text-koma-muted',
                        )}
                      >
                        {enabled ? 'Permitido' : 'Bloqueado'}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-[9px] leading-relaxed text-koma-muted">{item.description}</span>
                  </span>
                  <span className="relative mt-1 inline-flex shrink-0 items-center">
                    <input
                      type="checkbox"
                      aria-label={item.title}
                      checked={enabled}
                      onChange={(event) => void updateConfiguracoes({ [item.key]: event.target.checked })}
                      className="sr-only peer"
                    />
                    <span className="h-5 w-9 rounded-full bg-koma-raised transition-all after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-600 peer-checked:after:translate-x-full peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/50" />
                  </span>
                </label>
              );
            })}
          </div>

          {unavailablePermissions.length > 0 && (
            <section
              className="rounded-2xl border border-dashed border-koma-border bg-koma-page/60 p-4"
              aria-labelledby="waiter-future-permissions-heading"
            >
              <div className="mb-3">
                <h4 id="waiter-future-permissions-heading" className="text-xs font-bold text-koma-secondary">
                  Ainda não disponível
                </h4>
                <p className="mt-1 text-[9px] leading-relaxed text-koma-muted">
                  Estes recursos estão previstos, mas não fazem parte da operação atual. Eles não podem ser ativados aqui.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {unavailablePermissions.map((item) => (
                  <div key={item.key} className="rounded-xl border border-koma-border bg-koma-panel px-3 py-3 opacity-75">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[10px] font-bold text-koma-secondary">{item.title}</strong>
                      <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        Em preparação
                      </span>
                    </div>
                    <p className="mt-1.5 text-[9px] leading-relaxed text-koma-muted">{item.description}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
    </>
  );
}
