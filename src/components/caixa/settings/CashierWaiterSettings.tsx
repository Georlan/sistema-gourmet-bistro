import clsx from 'clsx';
import React from 'react';
import { OperationalBanner } from '../../shared/OperationalBanner';
import type { useCashierSettings } from './useCashierSettings';
import { WAITER_PERMISSIONS } from './waiterPermissions';

type BoundaryProps = Pick<ReturnType<typeof useCashierSettings>, 'waiterPermissions' | 'updateConfiguracoes'> & {
  printingSettingsTab: 'impressao' | 'mesas' | 'garcom' | 'taxa';
  setConfigSalSubTab: React.Dispatch<React.SetStateAction<'pedido' | 'fechamento' | 'atendimento'>>;
  configSalSubTab: 'pedido' | 'fechamento' | 'atendimento';
};

/** One list renderer; definitions, values and mutation contracts are shared. */
export function CashierWaiterSettings({
  printingSettingsTab, waiterPermissions, setConfigSalSubTab, configSalSubTab, updateConfiguracoes,
}: BoundaryProps) {
  if (printingSettingsTab !== 'garcom') return null;
  return <>
    <OperationalBanner
      id="waiter-app-title"
      eyebrow="CONFIGURAÇÕES / EQUIPE"
      title="Atendimento"
      accent="com autonomia controlada"
      description="Veja rapidamente o que a equipe pode fazer antes de ajustar cada permissão."
      metrics={[
        {
          label: 'permissões ativas',
          value: WAITER_PERMISSIONS.filter(item => item.overview && waiterPermissions[item.key]).length,
        },
        { label: 'impressão de pedido', value: waiterPermissions.perm_garcom_print ? 'Automática' : 'Manual' },
        { label: 'fechamento no app', value: waiterPermissions.perm_garcom_fechar ? 'Permitido' : 'Bloqueado' },
        { label: 'integrações pendentes', value: WAITER_PERMISSIONS.filter(item => !item.available).length },
      ]}
    />
    <div
      className={"lg:col-span-2 bg-koma-card/60 border border-koma-border rounded-3xl p-5 space-y-4 flex flex-col overflow-hidden"}
    >
      <div
        className={"border-b border-koma-border pb-3 flex justify-between items-center shrink-0"}
      >
        <span className={"font-serif font-bold text-koma-secondary"}>
          Configurações de Permissões do App do Garçom
        </span>
      </div>

      {/* Sub tabs inside configurations */}
      <div
        className={"flex gap-1.5 bg-koma-page p-1 rounded-xl border border-koma-border w-fit shrink-0"}
      >
        {[
          { id: 'pedido', label: '1. Pedido' },
          { id: 'fechamento', label: '2. Fechamento de Conta' },
          { id: 'atendimento', label: '3. Atendimento' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setConfigSalSubTab(tab.id as any)}
            className={`px-3 py-1.5 text-[9px] font-bold rounded-lg cursor-pointer transition-all ${
              configSalSubTab === tab.id
                ? 'bg-emerald-600 text-white shadow'
                : 'text-koma-subtle hover:text-koma-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-3.5 pt-2">
        <div key={configSalSubTab} className="space-y-3.5 animate-scale-in">
          {WAITER_PERMISSIONS.filter(item => item.group === configSalSubTab).map(item => (
              <div key={item.key} className={"flex justify-between items-start gap-4"}>
                <div className="space-y-0.5">
                  <div className={"flex items-center gap-2"}>
                    <strong
                      className={clsx(
                        item.available ? 'text-koma-foreground' : 'text-koma-subtle',
                        'block',
                        'font-semibold',
                      )}
                    >
                      {item.title}
                    </strong>
                    {!item.available && (
                      <span
                        className={"rounded-full border border-amber-700/40 bg-amber-900/20 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-400"}
                      >
                        Integração pendente
                      </span>
                    )}
                  </div>
                  <span className={"text-[9px] text-koma-muted block leading-relaxed"}>
                    {item.description}
                  </span>
                </div>
                <label
                  className={clsx(
                    'relative',
                    'inline-flex',
                    'items-center',
                    item.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-45',
                    'shrink-0',
                    'mt-0.5',
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={item.title}
                    checked={Boolean(waiterPermissions[item.key])}
                    disabled={!item.available}
                    onChange={(e) => void updateConfiguracoes({ [item.key]: e.target.checked })}
                    className={"sr-only peer"}
                  />
                  <div
                    className={"w-8 h-4.5 bg-koma-raised peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-600"}
                  ></div>
                </label>
              </div>
          ))}
        </div>
      </div>
    </div>
  </>;
}
