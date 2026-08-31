
import React from 'react';
import { OperationalBanner } from '../../shared/OperationalBanner';
import type { useCashierSettings } from './useCashierSettings';
type BoundaryProps = Pick<
  ReturnType<typeof useCashierSettings>,
  'taxaServicoAtiva' | 'serviceTaxRate' | 'setTaxaServicoAtiva' | 'updateConfiguracoes' | 'setServiceTaxRate'
> & {
  printingSettingsTab: 'impressao' | 'mesas' | 'garcom' | 'taxa';
  setCheckoutServiceTax: React.Dispatch<React.SetStateAction<boolean>>;
};

/** Service-tax presentation; checkout and settings use the same values and update action. */
export function CashierServiceTaxSettings({
  printingSettingsTab,
  taxaServicoAtiva,
  serviceTaxRate,
  setTaxaServicoAtiva,
  setCheckoutServiceTax,
  updateConfiguracoes,
  setServiceTaxRate,
}: BoundaryProps) {
  return (
    <>
      {printingSettingsTab === 'taxa' && (
        <OperationalBanner
          id="service-tax-title"
          eyebrow="CONFIGURAÇÕES / SERVIÇO"
          title="Taxa"
          accent={taxaServicoAtiva ? 'aplicada com clareza' : 'sob decisão do caixa'}
          description="A regra é única para o salão e chega ao fechamento sem cálculo paralelo."
          metrics={[
            { label: 'estado atual', value: taxaServicoAtiva ? 'Ativa' : 'Inativa' },
            { label: 'percentual padrão', value: taxaServicoAtiva ? `${serviceTaxRate}%` : '—' },
            { label: 'aplicação', value: 'Fechamento' },
            { label: 'alcance', value: 'Caixa e salão' },
          ]}
        />
      )}
      {printingSettingsTab === 'taxa' && (
        <div
          className={"lg:col-span-3 bg-koma-card border border-koma-border rounded-3xl p-5 space-y-3"}
        >
          <span
            className={"font-serif font-bold text-koma-secondary block pb-1 border-b border-koma-border"}
          >
            Taxa de Serviço do Salão
          </span>

          <div className={"flex justify-between items-center pt-1"}>
            <span className={"text-[10px] text-koma-secondary font-semibold"}>
              Ativar Taxa de 10% de Serviço
            </span>
            <label className={"relative inline-flex items-center cursor-pointer"}>
              <input
                type="checkbox"
                checked={taxaServicoAtiva}
                onChange={(e) => {
                  setTaxaServicoAtiva(e.target.checked);
                  setCheckoutServiceTax(e.target.checked);
                  updateConfiguracoes({ taxa_servico_ativa: e.target.checked });
                }}
                className={"sr-only peer"}
              />
              <div
                className={"w-9 h-5 bg-koma-raised peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"}
              ></div>
            </label>
          </div>

          {taxaServicoAtiva && (
            <div className={"space-y-1 pt-1.5 animate-scale-in max-w-xs"}>
              <label
                className={"text-[8px] text-koma-subtle font-bold uppercase tracking-wider block"}
              >
                Porcentagem Customizada (%):
              </label>
              <input
                type="number"
                min="1"
                max="30"
                value={serviceTaxRate}
                onChange={(e) => {
                  const val = Math.max(1, parseInt(e.target.value) || 1);
                  setServiceTaxRate(val);
                  updateConfiguracoes({ taxa_servico_padrao: val });
                }}
                className={"w-full px-3 py-1.5 bg-koma-page border border-koma-border rounded-xl text-koma-foreground font-mono text-[10px]"}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
