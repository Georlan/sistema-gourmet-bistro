
import { Lock } from 'lucide-react';
import { PrintMonitorPanel } from '../../printing/PrintMonitorPanel';
import type { CashierTab } from '../cashierContracts';
import type { useCashierSettings } from './useCashierSettings';
type BoundaryProps = Pick<
  ReturnType<typeof useCashierSettings>,
  | 'handleTestPrinter'
  | 'isTestingPrinter'
  | 'printSettingsSaveState'
  | 'printHeader'
  | 'setPrintHeader'
  | 'setPrintSettingsSaveState'
  | 'updateConfiguracoes'
  | 'printNamePosition'
  | 'printFooter'
  | 'setPrintFooter'
  | 'unificarViasDelivery'
  | 'setUnificarViasDelivery'
> & {
  printingSettingsTab: 'impressao' | 'mesas' | 'garcom' | 'taxa';
  hasPrinting: boolean;
  setActiveTab: (tab: CashierTab) => void;
  setActiveSubTab: (tab: string) => void;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
};

/** Printing configuration and monitor; monitor unmounts when this section is inactive. */
export function CashierPrintingSettings({
  printingSettingsTab,
  hasPrinting,
  setActiveTab,
  setActiveSubTab,
  apiBaseUrl,
  authHeaders,
  handleTestPrinter,
  isTestingPrinter,
  printSettingsSaveState,
  printHeader,
  setPrintHeader,
  setPrintSettingsSaveState,
  updateConfiguracoes,
  printNamePosition,
  printFooter,
  setPrintFooter,
  unificarViasDelivery,
  setUnificarViasDelivery,
}: BoundaryProps) {
  return (
    <>
      {printingSettingsTab === 'impressao' && !hasPrinting && (
        <div
          className={"bg-koma-card border border-amber-500/20 rounded-3xl p-8 text-center max-w-xl mx-auto space-y-3"}
        >
          <Lock size={24} className={"text-amber-400 mx-auto"} />
          <h3 className={"text-koma-foreground font-bold"}>Impressão não incluída no Kôma Pocket</h3>
          <p className={"text-[10px] text-koma-subtle"}>
            App do Garçom e Taxa de Serviço continuam disponíveis nas abas acima. Migre para o Kôma Pro ou
            Premium para liberar impressão.
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveTab('assinatura_pix');
              setActiveSubTab('planos');
            }}
            className={"px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase cursor-pointer"}
          >
            Comparar planos
          </button>
        </div>
      )}
      {printingSettingsTab === 'impressao' && hasPrinting && (
        <PrintMonitorPanel
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          onTestPrint={handleTestPrinter}
          testInProgress={isTestingPrinter}
        />
      )}
      {printingSettingsTab === 'impressao' && hasPrinting && (
        <div
          className={"bg-koma-panel border border-koma-border rounded-[22px] p-5 grid grid-cols-1 xl:grid-cols-2 gap-6 shadow-xs"}
        >
          <div className="space-y-4">
            <div
              className={"flex items-start justify-between gap-3 border-b border-koma-border pb-3"}
            >
              <div>
                <h3 className={"text-sm font-bold text-koma-foreground"}>
                  Personalização do cupom
                </h3>
                <p className={"mt-1 text-[10px] text-koma-muted"}>
                  Uma configuração central para caixa, comandas e impressão automática.
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[8px] font-extrabold ${
                  printSettingsSaveState === 'error'
                    ? 'koma-badge-danger'
                    : printSettingsSaveState === 'dirty'
                      ? 'koma-badge-warning'
                      : 'koma-badge-success'
                }`}
              >
                {printSettingsSaveState === 'saving'
                  ? 'SALVANDO…'
                  : printSettingsSaveState === 'dirty'
                    ? 'ALTERAÇÕES PENDENTES'
                    : printSettingsSaveState === 'error'
                      ? 'NÃO FOI SALVO'
                      : 'SALVO NO RESTAURANTE'}
              </span>
            </div>

            <div className={"space-y-3 text-left"}>
              <div className="space-y-1">
                <label
                  className={"text-[9px] font-bold text-koma-muted uppercase tracking-wider block"}
                >
                  Nome do restaurante no cupom:
                </label>
                <input
                  type="text"
                  value={printHeader}
                  maxLength={80}
                  onChange={(e) => {
                    setPrintHeader(e.target.value);
                    setPrintSettingsSaveState('dirty');
                  }}
                  onBlur={() => updateConfiguracoes({ impressao_nome_restaurante: printHeader })}
                  className={"w-full px-3.5 py-2.5 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs font-medium focus:outline-none focus:border-emerald-500/60"}
                />
              </div>

              <div className="space-y-1">
                <label
                  className={"text-[9px] font-bold text-koma-muted uppercase tracking-wider block"}
                >
                  Onde imprimir o nome:
                </label>
                <select
                  value={printNamePosition}
                  onChange={(e) =>
                    updateConfiguracoes({
                      impressao_nome_posicao: e.target.value as 'cabecalho' | 'rodape' | 'oculto',
                    })
                  }
                  className={"w-full px-3.5 py-2.5 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs font-medium focus:outline-none focus:border-emerald-500/60"}
                >
                  <option value="cabecalho">Cabeçalho — maior destaque</option>
                  <option value="rodape">Rodapé</option>
                  <option value="oculto">Não imprimir</option>
                </select>
              </div>

              <div className="space-y-1">
                <label
                  className={"text-[9px] font-bold text-koma-muted uppercase tracking-wider block"}
                >
                  Mensagem adicional de rodapé:
                </label>
                <input
                  type="text"
                  value={printFooter}
                  maxLength={160}
                  placeholder="Ex.: endereço, telefone ou agradecimento"
                  onChange={(e) => {
                    setPrintFooter(e.target.value);
                    setPrintSettingsSaveState('dirty');
                  }}
                  onBlur={() => updateConfiguracoes({ impressao_mensagem_rodape: printFooter })}
                  className={"w-full px-3.5 py-2.5 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-emerald-500/60"}
                />
              </div>

              <div className={"flex justify-between items-center pt-2"}>
                <span className={"text-xs text-koma-foreground font-medium"}>
                  Unificar Vias de Delivery (Via Única)
                </span>
                <label className={"relative inline-flex items-center cursor-pointer"}>
                  <input
                    type="checkbox"
                    checked={unificarViasDelivery}
                    onChange={(e) => {
                      setUnificarViasDelivery(e.target.checked);
                      updateConfiguracoes({ unificar_vias_delivery: e.target.checked });
                    }}
                    className={"sr-only peer"}
                  />
                  <div
                    className={"w-9 h-5 bg-zinc-300 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"}
                  ></div>
                </label>
              </div>
            </div>
          </div>

          {/* Prévia aproximada: a largura final depende da impressora. */}
          <div className="space-y-2">
            <div className={"flex items-center justify-between gap-2"}>
              <span className={"font-serif font-bold text-koma-secondary"}>
                Prévia aproximada
              </span>
              <span
                className={"rounded-full border border-koma-border px-2 py-1 text-[8px] text-koma-muted"}
              >
                exemplo em escala
              </span>
            </div>
            <div
              className={"mx-auto w-full max-w-[380px] bg-[#FFFFFC] text-black px-5 py-4 rounded-sm border border-gray-300 font-mono text-[10px] leading-[1.25] shadow-[0_14px_30px_rgba(0,0,0,0.35)]"}
            >
              {printNamePosition === 'cabecalho' && printHeader && (
                <>
                  <div
                    className={"text-center font-bold uppercase text-[12px] leading-tight"}
                  >
                    {printHeader}
                  </div>
                  <div className={"border-t border-dashed border-gray-500 my-1.5"} />
                </>
              )}

              <div className={"text-center font-bold text-[12px]"}>CONSUMO NO LOCAL</div>
              <div className={"border-t border-dashed border-gray-500 my-1.5"} />
              <div className={"flex justify-between"}>
                <span>PEDIDO: #305</span>
                <span>MESA: 3</span>
              </div>
              <div className={"flex justify-between"}>
                <span>DATA: 28/07/2026</span>
                <span>HORA: 18:01</span>
              </div>
              <div>GARÇOM: GEORLAN</div>
              <div className={"border-t border-dashed border-gray-500 my-1.5"} />

              <div className="space-y-1">
                <div className={"flex justify-between gap-3"}>
                  <span>3x HAMBÚRGUER TRADICIONAL</span>
                  <span className="shrink-0">R$ 57,00</span>
                </div>
                <div className={"pl-3 text-[8px] text-gray-700"}>OBS: SEM CHEDDAR</div>
                <div className={"flex justify-between gap-3"}>
                  <span>2x HEINEKEN LONG NECK</span>
                  <span className="shrink-0">R$ 24,00</span>
                </div>
                <div className={"flex justify-between gap-3"}>
                  <span>1x BAGUETE DE COSTELA</span>
                  <span className="shrink-0">R$ 36,00</span>
                </div>
                <div className={"pl-3 text-[8px] text-gray-700"}>OBS: SEM SALADA</div>
              </div>

              <div className={"border-t border-dashed border-gray-500 my-1.5"} />
              <div className={"text-center font-bold"}>CLIENTE: PAULO</div>
              <div className={"flex justify-between gap-3"}>
                <span>1x CHEESE BACON</span>
                <span className="shrink-0">R$ 25,00</span>
              </div>
              <div className={"flex justify-between gap-3"}>
                <span>1x HAMBÚRGUER SUÍNO</span>
                <span className="shrink-0">R$ 19,00</span>
              </div>
              <div className={"border-t border-dashed border-gray-500 my-1.5"} />
              <div className={"flex justify-between"}>
                <span>SUBTOTAL CONSUMO GERAL</span>
                <span>R$ 117,00</span>
              </div>
              <div className={"flex justify-between"}>
                <span>SUBTOTAL PAULO</span>
                <span>R$ 44,00</span>
              </div>
              <div
                className={"border-y border-double border-koma-border my-1.5 py-1 flex justify-between font-bold text-[11px]"}
              >
                <span>TOTAL GERAL DA MESA</span>
                <span>R$ 161,00</span>
              </div>

              <div className={"text-center text-[9px] mt-2"}>
                <span className="block">Gerenciado por Kôma</span>
                <span className="block">Documento não fiscal</span>
                {printFooter && <span className={"block mt-1 uppercase"}>{printFooter}</span>}
                {printNamePosition === 'rodape' && printHeader && (
                  <span className={"block font-bold mt-1 uppercase"}>{printHeader}</span>
                )}
              </div>
            </div>
            <p className={"text-[8px] leading-relaxed text-koma-muted"}>
              O nome, a posição e o rodapé acima atualizam esta simulação. A impressão real usa o formatador
              do servidor e ajusta as quebras à largura da térmica.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
