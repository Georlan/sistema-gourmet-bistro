import clsx from 'clsx';
import React from 'react';
import { OperationalBanner } from '../../shared/OperationalBanner';
import type { useCashierSettings } from './useCashierSettings';
type BoundaryProps = Pick<
  ReturnType<typeof useCashierSettings>,
  | 'permDelivery'
  | 'permEdit'
  | 'permCancel'
  | 'permShowStatus'
  | 'permAutoPrint'
  | 'permCloseAccount'
  | 'permTransferTables'
  | 'permTransferItems'
  | 'updateConfiguracoes'
  | 'permAddCharges'
  | 'permOpenEmpty'
  | 'permDiscount'
  | 'permSurcharge'
  | 'permPeopleCount'
  | 'permClientCall'
  | 'permShowIdleTables'
> & {
  printingSettingsTab: 'impressao' | 'mesas' | 'garcom' | 'taxa';
  setConfigSalSubTab: React.Dispatch<React.SetStateAction<'pedido' | 'fechamento' | 'atendimento'>>;
  configSalSubTab: 'pedido' | 'fechamento' | 'atendimento';
};

/** Waiter permissions presentation; values and writes remain in the shared settings controller. */
export function CashierWaiterSettings({
  printingSettingsTab,
  permDelivery,
  permEdit,
  permCancel,
  permShowStatus,
  permAutoPrint,
  permCloseAccount,
  permTransferTables,
  permTransferItems,
  setConfigSalSubTab,
  configSalSubTab,
  updateConfiguracoes,
  permAddCharges,
  permOpenEmpty,
  permDiscount,
  permSurcharge,
  permPeopleCount,
  permClientCall,
  permShowIdleTables,
}: BoundaryProps) {
  return (
    <>
      {printingSettingsTab === 'garcom' && (
        <OperationalBanner
          id="waiter-app-title"
          eyebrow="CONFIGURAÇÕES / EQUIPE"
          title="Atendimento"
          accent="com autonomia controlada"
          description="Veja rapidamente o que a equipe pode fazer antes de ajustar cada permissão."
          metrics={[
            {
              label: 'permissões ativas',
              value: [
                permDelivery,
                permEdit,
                permCancel,
                permShowStatus,
                permAutoPrint,
                permCloseAccount,
                permTransferTables,
                permTransferItems,
              ].filter(Boolean).length,
            },
            { label: 'impressão de pedido', value: permAutoPrint ? 'Automática' : 'Manual' },
            { label: 'fechamento no app', value: permCloseAccount ? 'Permitido' : 'Bloqueado' },
            { label: 'integrações pendentes', value: 7 },
          ]}
        />
      )}
      {printingSettingsTab === 'garcom' && (
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

          {/* Switch list */}
          <div className={"flex-1 overflow-y-auto pr-1 space-y-3.5 pt-2"}>
            {configSalSubTab === 'pedido' && (
              <div className={"space-y-3.5 animate-scale-in"}>
                {[
                  {
                    title: 'Permitir que garçom faça lançamentos de pedidos de delivery',
                    desc: 'Ao ativar, garçons podem criar comandas com canais externos no salão.',
                    checked: permDelivery,
                    available: true,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_delivery: val }),
                  },
                  {
                    title: 'Permitir que Garçons editem pedidos',
                    desc: 'Permite atualizar observações ou acrescentar itens em comandas já enviadas.',
                    checked: permEdit,
                    available: true,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_editar: val }),
                  },
                  {
                    title: 'Permitir que Garçons editem cobranças adicionais',
                    desc: 'Permite retirar/colocar taxas extras, como couvert artístico ou consumação mínima.',
                    checked: permAddCharges,
                    available: false,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_taxas: val }),
                  },
                  {
                    title: 'Permitir que garçons cancelem pedidos',
                    desc: 'Permite o cancelamento direto de itens pelo aplicativo sem aprovação do gerente.',
                    checked: permCancel,
                    available: true,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_cancelar: val }),
                  },
                  {
                    title: 'Permitir exibição de status de pedidos no mapa de mesas',
                    desc: "Gera ícones de produção ('Em preparo', 'Pronto') sobre as mesas no mapa.",
                    checked: permShowStatus,
                    available: true,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_status: val }),
                  },
                  {
                    title: 'Permitir que garçons abram comandas sem pedido',
                    desc: "Permite reservar uma mesa com status 'ocupada' sem lançar nenhum item.",
                    checked: permOpenEmpty,
                    available: false,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_abrir_vazia: val }),
                  },
                  {
                    title: 'Permitir impressão automática dos pedidos feitos pelo Garçom',
                    desc: 'Dispara a via térmica de produção no balcão imediatamente após o garçom confirmar.',
                    checked: permAutoPrint,
                    available: true,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_print: val }),
                  },
                ].map((item, idx) => (
                  <div key={idx} className={"flex justify-between items-start gap-4"}>
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
                        {item.desc}
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
                        checked={item.checked}
                        disabled={!item.available}
                        onChange={(e) => item.onChange(e.target.checked)}
                        className={"sr-only peer"}
                      />
                      <div
                        className={"w-8 h-4.5 bg-koma-raised peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-600"}
                      ></div>
                    </label>
                  </div>
                ))}
              </div>
            )}

            {configSalSubTab === 'fechamento' && (
              <div className={"space-y-3.5 animate-scale-in"}>
                {[
                  {
                    title: 'Permitir que Garçom feche a conta',
                    desc: 'Autoriza o garçom a encerrar a mesa e dar a baixa definitiva no consumo.',
                    checked: permCloseAccount,
                    available: true,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_fechar: val }),
                  },
                  {
                    title: 'Permitir que Garçom aplique desconto',
                    desc: 'Habilita a aplicação de porcentagem de desconto na conta final direto pelo aplicativo.',
                    checked: permDiscount,
                    available: false,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_desconto: val }),
                  },
                  {
                    title: 'Permitir que Garçom aplique acréscimo',
                    desc: 'Habilita a adição de valores extras ou gorjetas no fechamento da conta pelo app.',
                    checked: permSurcharge,
                    available: false,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_acrescimo: val }),
                  },
                ].map((item, idx) => (
                  <div key={idx} className={"flex justify-between items-start gap-4"}>
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
                        {item.desc}
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
                        checked={item.checked}
                        disabled={!item.available}
                        onChange={(e) => item.onChange(e.target.checked)}
                        className={"sr-only peer"}
                      />
                      <div
                        className={"w-8 h-4.5 bg-koma-raised peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-600"}
                      ></div>
                    </label>
                  </div>
                ))}
              </div>
            )}

            {configSalSubTab === 'atendimento' && (
              <div className={"space-y-3.5 animate-scale-in"}>
                {[
                  {
                    title: 'Permitir que o garçom informe quantas pessoas vão sentar à mesa',
                    desc: 'Abre pergunta inicial na abertura da mesa para cálculo automático do consumo/taxa individual.',
                    checked: permPeopleCount,
                    available: false,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_pessoas: val }),
                  },
                  {
                    title: 'Permitir que Garçom transfira mesas e comandas',
                    desc: 'Permite realocar todo o consumo de uma mesa para outra mesa vazia.',
                    checked: permTransferTables,
                    available: true,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_transferir_mesa: val }),
                  },
                  {
                    title: 'Permitir que Garçom transfira pedidos e pagamentos para mesas ocupadas',
                    desc: 'Mover itens isolados ou repassar contas a pagar entre comanda de clientes sentados.',
                    checked: permTransferItems,
                    available: true,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_transferir_item: val }),
                  },
                  {
                    title: 'Permitir que Cliente chame Garçom na mesa',
                    desc: 'Dispara notificações no painel do garçom se o cliente apertar o botão no cardápio digital QR Code.',
                    checked: permClientCall,
                    available: false,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_chamar: val }),
                  },
                  {
                    title: 'Permitir exibição de mesas ociosas',
                    desc: 'Destaca no mapa mesas sem novos pedidos há mais tempo.',
                    checked: permShowIdleTables,
                    available: false,
                    onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_ociosas: val }),
                  },
                ].map((item, idx) => (
                  <div key={idx} className={"flex justify-between items-start gap-4"}>
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
                        {item.desc}
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
                        checked={item.checked}
                        disabled={!item.available}
                        onChange={(e) => item.onChange(e.target.checked)}
                        className={"sr-only peer"}
                      />
                      <div
                        className={"w-8 h-4.5 bg-koma-raised peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-600"}
                      ></div>
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
