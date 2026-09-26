import { useState } from 'react';
import { Activity, ChevronDown, ChevronRight, Lock, Printer, Receipt, RefreshCw, Truck } from 'lucide-react';
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

/**
 * Configurações de impressão do Caixa estruturadas em três contextos operacionais:
 * 1. Estado e diagnóstico (status da fila, monitor e testes)
 * 2. Cupom (personalização do comprovante e prévia visual)
 * 3. Delivery (regra e efeito operacional da unificação de vias)
 */
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
  const [isTestingWaiterPrinter, setIsTestingWaiterPrinter] = useState(false);
  const [waiterTestFeedback, setWaiterTestFeedback] = useState('');
  const [showAdvancedTests, setShowAdvancedTests] = useState(false);

  if (printingSettingsTab !== 'impressao') {
    return null;
  }

  const handleTestWaiterPrinter = async () => {
    if (isTestingWaiterPrinter) return;
    setIsTestingWaiterPrinter(true);
    setWaiterTestFeedback('');
    try {
      const response = await fetch(`${apiBaseUrl}/impressao/teste-extremo-garcom`, {
        method: 'POST',
        headers: authHeaders,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Não foi possível enviar o teste extremo do garçom.');
      }
      window.dispatchEvent(new Event('koma_print_monitor_refresh'));
      setWaiterTestFeedback('Teste extremo do App do Garçom enviado para a impressora.');
    } catch (error) {
      setWaiterTestFeedback(
        error instanceof Error ? error.message : 'Não foi possível comunicar com a fila de impressão.',
      );
    } finally {
      setIsTestingWaiterPrinter(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Estado e diagnóstico */}
      <section className="space-y-3" aria-labelledby="printing-status-heading">
        <div>
          <h3 id="printing-status-heading" className="text-sm font-bold text-koma-foreground flex items-center gap-2">
            <Activity size={16} className="text-emerald-500" />
            Impressão
          </h3>
          <p className="text-[11px] text-koma-muted">
            Veja primeiro o que precisa de atenção: agente local, impressora física e fila pendente.
          </p>
        </div>

        {!hasPrinting ? (
          <div className="bg-koma-card border border-amber-500/20 rounded-3xl p-8 text-center max-w-xl mx-auto space-y-3">
            <Lock size={24} className="text-amber-400 mx-auto" />
            <h4 className="text-koma-foreground font-bold">Impressão não incluída no Kôma Pocket</h4>
            <p className="text-[11px] text-koma-subtle leading-relaxed">
              O Pocket acompanha o preparo pela tela, sem impressora. Migre para o Kôma Pro ou Premium para
              liberar impressão automática e monitoramento de fila.
            </p>
            <button
              type="button"
              onClick={() => {
                setActiveTab('assinatura_pix');
                setActiveSubTab('planos_upgrade');
              }}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider cursor-pointer transition"
            >
              Comparar planos
            </button>
          </div>
        ) : (
          <PrintMonitorPanel
            apiBaseUrl={apiBaseUrl}
            authHeaders={authHeaders}
            onTestPrint={handleTestPrinter}
            testInProgress={isTestingPrinter}
            advancedTestsSlot={
              <div className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel shadow-xs">
                <button
                  type="button"
                  onClick={() => setShowAdvancedTests(current => !current)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-koma-raised cursor-pointer"
                  aria-expanded={showAdvancedTests}
                >
                  <span>
                    <strong className="block text-xs font-bold text-koma-foreground">Testes avançados</strong>
                    <span className="block text-[10px] text-koma-muted">
                      Ferramentas de homologação; não são necessárias na operação diária.
                    </span>
                  </span>
                  {showAdvancedTests ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>

                {showAdvancedTests && (
                  <div className="flex flex-col gap-3 border-t border-koma-border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <strong className="text-xs font-bold text-koma-foreground">Teste extremo do App do Garçom</strong>
                      <p className="text-[11px] text-koma-muted leading-relaxed">
                        Gera uma comanda sintética extrema sem criar pedido real, estoque ou movimento de caixa.
                      </p>
                      {waiterTestFeedback && (
                        <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">
                          {waiterTestFeedback}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={isTestingWaiterPrinter}
                      onClick={() => void handleTestWaiterPrinter()}
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-card px-4 text-xs font-bold text-koma-foreground transition hover:border-emerald-500/40 hover:text-emerald-600 disabled:cursor-wait disabled:opacity-60 dark:hover:text-emerald-300 cursor-pointer"
                    >
                      {isTestingWaiterPrinter ? (
                        <RefreshCw size={15} className="animate-spin text-emerald-500" />
                      ) : (
                        <Printer size={15} />
                      )}
                      {isTestingWaiterPrinter ? 'Enviando…' : 'Gerar comanda de teste'}
                    </button>
                  </div>
                )}
              </div>
            }
          >
            {({ activePaperWidthMm }) => (
              <>
                {/* 3. Cupom */}
                <section className="space-y-3" aria-labelledby="printing-receipt-heading">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 id="printing-receipt-heading" className="text-sm font-bold text-koma-foreground flex items-center gap-2">
                        <Receipt size={16} className="text-emerald-500" />
                        Cupom
                      </h3>
                      <p className="text-[11px] text-koma-muted">
                        Cabeçalho, posição do nome e rodapé impressos nas comandas e comprovantes do restaurante.
                      </p>
                    </div>
                    <span
                      className={`self-start sm:self-auto shrink-0 rounded-full px-2.5 py-1 text-[8px] font-extrabold tracking-wider ${
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

                  <div className="bg-koma-panel border border-koma-border rounded-[22px] p-5 grid grid-cols-1 xl:grid-cols-2 gap-6 shadow-xs">
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label htmlFor="print-restaurant-name" className="text-[9px] font-bold text-koma-muted uppercase tracking-wider block">
                          Nome do restaurante no cupom:
                        </label>
                        <input
                          id="print-restaurant-name"
                          type="text"
                          value={printHeader}
                          maxLength={80}
                          placeholder="Ex.: Gourmet Bistrô"
                          onChange={(e) => {
                            setPrintHeader(e.target.value);
                            setPrintSettingsSaveState('dirty');
                          }}
                          onBlur={() => updateConfiguracoes({ impressao_nome_restaurante: printHeader })}
                          className="w-full px-3.5 py-2.5 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs font-medium focus:outline-none focus:border-emerald-500/60 transition"
                        />
                        <p className="text-[10px] text-koma-subtle">Identificador comercial exibido no impresso térmico.</p>
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="print-name-position" className="text-[9px] font-bold text-koma-muted uppercase tracking-wider block">
                          Onde imprimir o nome:
                        </label>
                        <select
                          id="print-name-position"
                          value={printNamePosition}
                          onChange={(e) =>
                            updateConfiguracoes({
                              impressao_nome_posicao: e.target.value as 'cabecalho' | 'rodape' | 'oculto',
                            })
                          }
                          className="w-full px-3.5 py-2.5 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs font-medium focus:outline-none focus:border-emerald-500/60 transition"
                        >
                          <option value="cabecalho">Cabeçalho — maior destaque</option>
                          <option value="rodape">Rodapé</option>
                          <option value="oculto">Não imprimir</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="print-footer-message" className="text-[9px] font-bold text-koma-muted uppercase tracking-wider block">
                          Mensagem adicional de rodapé:
                        </label>
                        <input
                          id="print-footer-message"
                          type="text"
                          value={printFooter}
                          maxLength={160}
                          placeholder="Ex.: Wi-Fi, chave PIX, endereço ou agradecimento"
                          onChange={(e) => {
                            setPrintFooter(e.target.value);
                            setPrintSettingsSaveState('dirty');
                          }}
                          onBlur={() => updateConfiguracoes({ impressao_mensagem_rodape: printFooter })}
                          className="w-full px-3.5 py-2.5 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-emerald-500/60 transition"
                        />
                        <p className="text-[10px] text-koma-subtle">Linhas extras no final da comanda térmica.</p>
                      </div>
                    </div>

                    {/* Prévia aproximada: adaptada à largura da impressora ativa (58 mm ou 80 mm). */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-serif font-bold text-koma-secondary">
                          Prévia aproximada
                        </span>
                        <span className="rounded-full border border-koma-border px-2 py-1 text-[8px] text-koma-muted">
                          {activePaperWidthMm ? `exemplo em escala (${activePaperWidthMm} mm)` : 'exemplo em escala'}
                        </span>
                      </div>
                      <div className={`mx-auto w-full ${activePaperWidthMm === 58 ? 'max-w-[285px] text-[9px]' : 'max-w-[380px] text-[10px]'} bg-[#FFFFFC] text-black px-5 py-4 rounded-sm border border-gray-300 font-mono leading-[1.25] shadow-[0_14px_30px_rgba(0,0,0,0.35)] transition-all`}>
                        {printNamePosition === 'cabecalho' && printHeader && (
                          <>
                            <div className="text-center font-bold uppercase text-[12px] leading-tight">
                              {printHeader}
                            </div>
                            <div className="border-t border-dashed border-gray-500 my-1.5" />
                          </>
                        )}

                        <div className="text-center font-bold text-[12px]">CONSUMO NO LOCAL</div>
                        <div className="border-t border-dashed border-gray-500 my-1.5" />
                        <div className="text-center font-bold text-[11px]">MESA: 3</div>
                        <div className="text-center font-bold text-[11px]">PEDIDO #305</div>
                        <div className="flex justify-between">
                          <span>DATA: 28/07/2026</span>
                          <span>HORA: 18:01</span>
                        </div>
                        <div>GARÇOM: GEORLAN</div>
                        <div className="border-t border-dashed border-gray-500 my-1.5" />

                        <div className="space-y-1">
                          <div className="flex justify-between gap-3">
                            <span>3x HAMBÚRGUER TRADICIONAL</span>
                            <span className="shrink-0">R$ 57,00</span>
                          </div>
                          <div className="pl-3 text-[8px] text-gray-700">OBS: SEM CHEDDAR</div>
                          <div className="flex justify-between gap-3">
                            <span>2x HEINEKEN LONG NECK</span>
                            <span className="shrink-0">R$ 24,00</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span>1x BAGUETE DE COSTELA</span>
                            <span className="shrink-0">R$ 36,00</span>
                          </div>
                          <div className="pl-3 text-[8px] text-gray-700">OBS: SEM SALADA</div>
                        </div>

                        <div className="border-t border-dashed border-gray-500 my-1.5" />
                        <div className="text-center font-bold">CLIENTE: PAULO</div>
                        <div className="flex justify-between gap-3">
                          <span>1x CHEESE BACON</span>
                          <span className="shrink-0">R$ 25,00</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>1x HAMBÚRGUER SUÍNO</span>
                          <span className="shrink-0">R$ 19,00</span>
                        </div>
                        <div className="border-t border-dashed border-gray-500 my-1.5" />
                        <div className="flex justify-between">
                          <span>SUBTOTAL CONSUMO GERAL</span>
                          <span>R$ 117,00</span>
                        </div>
                        <div className="flex justify-between">
                          <span>SUBTOTAL PAULO</span>
                          <span>R$ 44,00</span>
                        </div>
                        <div className="border-y border-double border-koma-border my-1.5 py-1 flex justify-between font-bold text-[11px]">
                          <span>TOTAL GERAL DA MESA</span>
                          <span>R$ 161,00</span>
                        </div>

                        <div className="text-center text-[9px] mt-2">
                          <span className="block">Gerenciado por Kôma</span>
                          <span className="block">Documento não fiscal</span>
                          {printFooter && <span className="block mt-1 uppercase">{printFooter}</span>}
                          {printNamePosition === 'rodape' && printHeader && (
                            <span className="block font-bold mt-1 uppercase">{printHeader}</span>
                          )}
                        </div>
                      </div>
                      <p className="text-[8px] leading-relaxed text-koma-muted">
                        O nome, a posição e o rodapé acima atualizam esta simulação. A impressão real usa o formatador
                        do servidor e ajusta as quebras à largura da térmica.
                      </p>
                    </div>
                  </div>
                </section>

                {/* 4. Delivery */}
                <section className="space-y-3" aria-labelledby="printing-delivery-heading">
                  <div>
                    <h3 id="printing-delivery-heading" className="text-sm font-bold text-koma-foreground flex items-center gap-2">
                      <Truck size={16} className="text-emerald-500" />
                      Delivery
                    </h3>
                    <p className="text-[11px] text-koma-muted">
                      Regra de vias para pedidos de entrega e viagem despachados pelo restaurante.
                    </p>
                  </div>

                  <div
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                    role="radiogroup"
                    aria-label="Formato das vias de delivery"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!unificarViasDelivery}
                      onClick={() => {
                        setUnificarViasDelivery(false);
                        updateConfiguracoes({ unificar_vias_delivery: false });
                      }}
                      className={`rounded-2xl border p-4 text-left transition cursor-pointer ${
                        !unificarViasDelivery
                          ? 'border-emerald-500/50 bg-emerald-500/10'
                          : 'border-koma-border bg-koma-panel hover:bg-koma-raised'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <strong className="text-xs text-koma-foreground">Vias separadas</strong>
                        {!unificarViasDelivery && (
                          <span className="rounded-full koma-badge-success px-2 py-0.5 text-[8px] font-extrabold">ATUAL</span>
                        )}
                      </span>
                      <span className="mt-1.5 block text-[10px] leading-relaxed text-koma-muted">
                        Produção recebe a via de cozinha/bar e a expedição recebe a via com cliente e endereço.
                      </span>
                    </button>

                    <button
                      type="button"
                      role="radio"
                      aria-checked={unificarViasDelivery}
                      onClick={() => {
                        setUnificarViasDelivery(true);
                        updateConfiguracoes({ unificar_vias_delivery: true });
                      }}
                      className={`rounded-2xl border p-4 text-left transition cursor-pointer ${
                        unificarViasDelivery
                          ? 'border-emerald-500/50 bg-emerald-500/10'
                          : 'border-koma-border bg-koma-panel hover:bg-koma-raised'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <strong className="text-xs text-koma-foreground">Via única</strong>
                        {unificarViasDelivery && (
                          <span className="rounded-full koma-badge-success px-2 py-0.5 text-[8px] font-extrabold">ATUAL</span>
                        )}
                      </span>
                      <span className="mt-1.5 block text-[10px] leading-relaxed text-koma-muted">
                        Um único cupom reúne cliente, endereço, itens e pagamento para reduzir papel e passos na expedição.
                      </span>
                    </button>
                  </div>
                </section>
              </>
            )}
          </PrintMonitorPanel>
        )}
      </section>
    </div>
  );
}
