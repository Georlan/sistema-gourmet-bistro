import { useState } from 'react';
import { Activity, Lock, Printer, Receipt, RefreshCw, Truck } from 'lucide-react';
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
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 id="printing-status-heading" className="text-sm font-bold text-koma-foreground flex items-center gap-2">
              <Activity size={16} className="text-emerald-500" />
              Estado e diagnóstico
            </h3>
            <p className="text-[11px] text-koma-muted">
              Status da fila de impressão, agentes conectados e ações de homologação.
            </p>
          </div>
          {hasPrinting && (
            <span className="self-start sm:self-auto rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
              Fila ativa
            </span>
          )}
        </div>

        {!hasPrinting ? (
          <div className="bg-koma-card border border-amber-500/20 rounded-3xl p-8 text-center max-w-xl mx-auto space-y-3">
            <Lock size={24} className="text-amber-400 mx-auto" />
            <h4 className="text-koma-foreground font-bold">Impressão não incluída no Kôma Pocket</h4>
            <p className="text-[11px] text-koma-subtle leading-relaxed">
              App do Garçom e Taxa de Serviço continuam disponíveis nas abas acima. Migre para o Kôma Pro ou
              Premium para liberar impressão automática e monitoramento de fila.
            </p>
            <button
              type="button"
              onClick={() => {
                setActiveTab('assinatura_pix');
                setActiveSubTab('planos');
              }}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider cursor-pointer transition"
            >
              Comparar planos
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <PrintMonitorPanel
              apiBaseUrl={apiBaseUrl}
              authHeaders={authHeaders}
              onTestPrint={handleTestPrinter}
              testInProgress={isTestingPrinter}
            />

            <div className="flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:flex-row sm:items-center sm:justify-between shadow-xs">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  <strong className="text-xs font-bold text-koma-foreground">Homologação do App do Garçom</strong>
                </div>
                <p className="text-[11px] text-koma-muted leading-relaxed">
                  Gera uma comanda sintética extrema de mesa, sem criar pedido real, estoque ou movimento de caixa.
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
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-card px-4 text-xs font-bold text-koma-foreground transition hover:border-emerald-500/40 hover:text-emerald-600 disabled:cursor-wait disabled:opacity-60 dark:hover:text-emerald-300"
              >
                {isTestingWaiterPrinter ? (
                  <RefreshCw size={15} className="animate-spin text-emerald-500" />
                ) : (
                  <Printer size={15} />
                )}
                {isTestingWaiterPrinter ? 'Enviando…' : 'Teste extremo — Garçom'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 2. Cupom */}
      {hasPrinting && (
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

            {/* Prévia aproximada: a largura final depende da impressora. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-serif font-bold text-koma-secondary">
                  Prévia aproximada
                </span>
                <span className="rounded-full border border-koma-border px-2 py-1 text-[8px] text-koma-muted">
                  exemplo em escala
                </span>
              </div>
              <div className="mx-auto w-full max-w-[380px] bg-[#FFFFFC] text-black px-5 py-4 rounded-sm border border-gray-300 font-mono text-[10px] leading-[1.25] shadow-[0_14px_30px_rgba(0,0,0,0.35)]">
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
                <div className="flex justify-between">
                  <span>PEDIDO: #305</span>
                  <span>MESA: 3</span>
                </div>
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
      )}

      {/* 3. Delivery */}
      {hasPrinting && (
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

          <div className="rounded-[22px] border border-koma-border bg-koma-panel p-5 space-y-4 shadow-xs">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold text-koma-foreground">
                    Unificar vias de delivery (via única)
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-wide ${
                      unificarViasDelivery ? 'koma-badge-success' : 'koma-badge-neutral'
                    }`}
                  >
                    {unificarViasDelivery ? 'VIA ÚNICA ATIVA' : 'VIAS SEPARADAS'}
                  </span>
                </div>
                <p className="text-[11px] text-koma-muted leading-relaxed">
                  {unificarViasDelivery
                    ? 'Imprime uma única comanda com dados do cliente, itens e entrega juntos. Economiza papel de bobina e simplifica a expedição.'
                    : 'Imprime vias separadas para produção (cozinha/bar) e entrega (motoboy/cliente com endereço e conferência).'}
                </p>
              </div>

              <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1 sm:mt-0">
                <input
                  type="checkbox"
                  checked={unificarViasDelivery}
                  onChange={(e) => {
                    setUnificarViasDelivery(e.target.checked);
                    updateConfiguracoes({ unificar_vias_delivery: e.target.checked });
                  }}
                  className="sr-only peer"
                  aria-label="Unificar vias de delivery"
                />
                <div className="w-9 h-5 bg-zinc-300 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
              </label>
            </div>

            <div className="border-t border-koma-border pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                <div
                  className={`p-3 rounded-xl border transition-colors ${
                    unificarViasDelivery ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-koma-border bg-koma-card'
                  }`}
                >
                  <span className="font-bold block text-koma-foreground mb-0.5">Via única (marcado)</span>
                  <span className="text-koma-muted">1 via unificada com cliente, endereço, itens e pagamento.</span>
                </div>
                <div
                  className={`p-3 rounded-xl border transition-colors ${
                    !unificarViasDelivery ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-koma-border bg-koma-card'
                  }`}
                >
                  <span className="font-bold block text-koma-foreground mb-0.5">Vias separadas (desmarcado)</span>
                  <span className="text-koma-muted">2 vias: 1 da cozinha para preparar + 1 de entrega para despachar.</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
