import clsx from 'clsx';
import { Check, Printer, RefreshCw, Smartphone, User, X } from 'lucide-react';
import { isCashierTableOrder as isTableCheckoutOrder } from '../../../domain/cashierOrderProjection';
import { aplicarMascaraTelefoneInput } from '../../../utils/phonePresentation';
import MoneyInput from '../../MoneyInput';
import { formatCurrency } from '../cashierPresentation';
import type { useCashierSmartPos } from '../smartpos/useCashierSmartPos';
import type { CheckoutController } from './useCheckoutController';

interface Props {
  controller: CheckoutController;
  smartPos: Pick<
    ReturnType<typeof useCashierSmartPos>,
    | 'getSmartPosCardState'
    | 'smartPosRecoveryError'
    | 'isReconcilingSmartPos'
    | 'handleReconcileSmartPosPayment'
    | 'setSmartPosRecoveryError'
    | 'refreshSmartPosCashProjection'
  >;
  errorMsg: string;
  taxaServicoAtiva: boolean;
  serviceTaxRate: number;
}

/** Controlled payment view. Its always-mounted controller owns the transaction lifecycle. */
export function CheckoutDialog({ controller, smartPos, errorMsg, taxaServicoAtiva, serviceTaxRate }: Props) {
  const {
    isProcessingPayment,
    selectedOrder,
    showCheckoutModal,
    setShowCheckoutModal,
    identifiedCustomer,
    checkoutServiceTax,
    setCheckoutServiceTax,
    splitPeople,
    setSplitPeople,
    paymentMetodo,
    setPaymentMetodo,
    paymentValor,
    setPaymentValor,
    selectedItemIds,
    setSelectedItemIds,
    paymentCPF,
    setPaymentCPF,
    handleProcessPayment,
    isItemReadyForCheckout,
    getCheckoutTotals,
    getCheckoutBalance,
    getSelectedItemsTotal,
    printCheckoutReceipt,
    printCheckoutValues,
  } = controller;
  const {
    getSmartPosCardState,
    smartPosRecoveryError,
    isReconcilingSmartPos,
    handleReconcileSmartPosPayment,
    setSmartPosRecoveryError,
    refreshSmartPosCashProjection,
  } = smartPos;
  const selectedCheckoutSmartPosState = selectedOrder ? getSmartPosCardState(selectedOrder) : null;

  const currentBalance = selectedOrder ? getCheckoutBalance(selectedOrder) : 0;
  const inputVal = Number(paymentValor || 0);
  const selectedTotal =
    selectedOrder && selectedItemIds.length > 0 ? getSelectedItemsTotal(selectedOrder, selectedItemIds) : 0;

  const primaryButtonLabel = (() => {
    if (selectedItemIds.length > 0) {
      return `Receber itens selecionados · ${formatCurrency(selectedTotal)}`;
    }
    if (inputVal > 0) {
      if (Math.abs(inputVal - currentBalance) < 0.01) {
        return `Receber saldo total · ${formatCurrency(currentBalance)}`;
      }
      return `Receber parcial · ${formatCurrency(inputVal)}`;
    }
    if (currentBalance > 0) {
      return `Receber saldo total · ${formatCurrency(currentBalance)}`;
    }
    return 'Receber pagamento';
  })();

  return (
    selectedOrder &&
    showCheckoutModal && (
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-xs z-[80] flex items-center justify-center p-2 sm:p-4"
        onClick={() => setShowCheckoutModal(false)}
      >
        <div
          className="bg-koma-input/95 backdrop-blur-xl rounded-2xl sm:rounded-3xl border border-koma-accent/15 shadow-2xl w-full max-w-3xl overflow-hidden max-h-[92vh] sm:max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="bg-koma-raised text-koma-foreground px-4 py-3.5 sm:px-5 sm:py-4 flex justify-between items-center shrink-0 border-b border-koma-border"
          >
            <div>
              <span
                className={"text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block"}
              >
                Checkout / Caixa
              </span>
              <h3 className={"font-serif text-lg font-bold text-koma-foreground"}>
                {selectedOrder.mesaId > 0 ? `Mesa ${selectedOrder.mesaId}` : `Pedido Balcão`}
              </h3>
              {selectedOrder.mesaOrigemId && Number(selectedOrder.mesaOrigemId) !== Number(selectedOrder.mesaId) && (
                <span
                  className={"inline-flex items-center gap-1 mt-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/25 rounded-full"}
                >
                  🔗 Mesclado de Mesa {selectedOrder.mesaOrigemId}
                </span>
              )}
              {selectedOrder.mesaTransferidaDe &&
                Number(selectedOrder.mesaTransferidaDe) !== Number(selectedOrder.mesaId) && (
                  <span
                    className={"inline-flex items-center gap-1 mt-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-300 border border-purple-500/25 rounded-full"}
                  >
                    🔗 Transferido da Mesa {selectedOrder.mesaTransferidaDe}
                  </span>
                )}
            </div>
            <button
              type="button"
              onClick={() => setShowCheckoutModal(false)}
              className={"p-1.5 hover:bg-koma-raised rounded-full text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"}
              title="Fechar (o pedido permanece na fila)"
            >
              <X size={18} />
            </button>
          </div>

          {selectedCheckoutSmartPosState?.blocksPayment && (
            <div
              className={clsx(
                'mx-5',
                'mt-4',
                'rounded-2xl',
                'border',
                'p-4',
                'text-left',
                selectedCheckoutSmartPosState.canReconcile
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-amber-500/30 bg-amber-500/10'
              )}
            >
              <div className="flex items-start gap-3">
                <Smartphone size={18} className="mt-0.5 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <strong className="block text-sm text-koma-foreground">
                    {selectedCheckoutSmartPosState.canReconcile
                      ? 'Pagamento aprovado aguardando conclusão'
                      : 'Pagamento em andamento na maquininha'}
                  </strong>
                  <p className="mt-1 text-[11px] leading-relaxed text-koma-secondary">
                    {selectedCheckoutSmartPosState.canReconcile
                      ? 'A cobrança já foi aprovada. Conclua a liquidação idempotente antes de lançar outra baixa.'
                      : 'O Kôma bloqueia uma segunda cobrança, mas mantém esta tela aberta para acompanhamento e recuperação.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedCheckoutSmartPosState.canReconcile && selectedCheckoutSmartPosState.intentId && (
                      <button
                        type="button"
                        disabled={isReconcilingSmartPos}
                        onClick={() => handleReconcileSmartPosPayment(selectedCheckoutSmartPosState.intentId!)}
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white disabled:cursor-wait disabled:opacity-60"
                      >
                        {isReconcilingSmartPos ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                        Concluir pagamento aprovado
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSmartPosRecoveryError('');
                        void refreshSmartPosCashProjection();
                      }}
                      className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-koma-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-koma-secondary"
                    >
                      <RefreshCw size={13} /> Atualizar estado
                    </button>
                  </div>
                  {smartPosRecoveryError && (
                    <p className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-2.5 text-[10px] font-semibold text-rose-400">
                      {smartPosRecoveryError}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            className="p-3.5 sm:p-5 overflow-y-auto flex-1 min-h-0 bg-koma-raised grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5"
          >
            <div className="space-y-3 sm:space-y-4 flex flex-col min-h-0">
              <div
                className="flex items-center justify-between border-b border-koma-border pb-1.5 shrink-0"
              >
                <div>
                  <h4 className="font-serif font-bold text-koma-secondary">Extrato Consumo</h4>
                </div>
                {taxaServicoAtiva && (
                  <label
                    className={"flex items-center gap-1.5 text-[10px] text-koma-subtle font-bold uppercase tracking-wider cursor-pointer"}
                  >
                    <input
                      type="checkbox"
                      checked={checkoutServiceTax}
                      onChange={(e) => {
                        const includeServiceTax = e.target.checked;
                        setCheckoutServiceTax(includeServiceTax);
                        const nextValue =
                          selectedItemIds.length > 0
                            ? getSelectedItemsTotal(selectedOrder, selectedItemIds, includeServiceTax)
                            : getCheckoutBalance(selectedOrder, includeServiceTax);
                        setPaymentValor(nextValue);
                      }}
                      className={"rounded border-koma-border text-emerald-500 focus:ring-emerald-500 h-3.5 w-3.5 bg-koma-card"}
                    />
                    <span>Taxa de {serviceTaxRate}%</span>
                  </label>
                )}
              </div>

              <div className={"space-y-2.5 max-h-[40vh] overflow-y-auto pr-1"}>
                {selectedOrder.itens.map((item) => {
                  const isPaid = item.pago;
                  const isCancelled = (item.status as string) === 'cancelado';
                  const isReadyForCheckout = isItemReadyForCheckout(item);
                  const canSelect = !isPaid && !isCancelled && isReadyForCheckout;
                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        if (!canSelect) return;
                        setSplitPeople('1');
                        setSelectedItemIds((prev) => {
                          const copy = [...prev];
                          const idx = copy.indexOf(item.id);
                          if (idx >= 0) {
                            copy.splice(idx, 1);
                          } else {
                            copy.push(item.id);
                          }
                          const nextValue =
                            copy.length > 0
                              ? getSelectedItemsTotal(selectedOrder, copy)
                              : getCheckoutBalance(selectedOrder);
                          setPaymentValor(nextValue);
                          return copy;
                        });
                      }}
                      className={`flex items-start justify-between p-2.5 rounded-xl border border-transparent transition-all text-[11px] ${
                        isCancelled
                          ? 'bg-rose-500/5 border-rose-500/10 text-rose-400 opacity-60'
                          : isPaid
                            ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400'
                            : !isReadyForCheckout
                              ? 'bg-amber-500/5 border-amber-500/15 text-koma-secondary cursor-not-allowed opacity-80'
                              : selectedItemIds.includes(item.id)
                                ? 'bg-emerald-500/15 border-emerald-500/30 cursor-pointer shadow-inner'
                                : 'bg-koma-card/60 border-koma-border/50 hover:border-koma-border cursor-pointer'
                      }`}
                    >
                      <div className={"flex gap-2 items-start flex-1 min-w-0"}>
                        {canSelect && (
                          <div
                            className={`mt-0.5 h-3.5 w-3.5 rounded border border-koma-border flex items-center justify-center shrink-0 bg-koma-card ${
                              selectedItemIds.includes(item.id) ? 'border-[#10b981] bg-emerald-500/15' : ''
                            }`}
                          >
                            {selectedItemIds.includes(item.id) && (
                              <Check size={10} className="text-emerald-700 dark:text-emerald-400" />
                            )}
                          </div>
                        )}
                        <div className={"min-w-0 space-y-0.5"}>
                          <span className={"font-semibold text-koma-foreground block truncate"}>
                            {item.nome}
                          </span>
                          <span className={"text-[9px] text-koma-subtle block"}>
                            Cliente: {item.clienteNome}
                          </span>
                          {!isPaid && !isCancelled && !isReadyForCheckout && (
                            <span
                              className={"text-[8px] font-semibold text-amber-600 dark:text-amber-300 block"}
                            >
                              Em preparo · avance na cozinha antes de baixar este item
                            </span>
                          )}
                        </div>
                      </div>

                      <div className={"text-right pl-3 shrink-0 font-mono"}>
                        <span className={"font-bold text-koma-secondary"}>R$ {item.preco.toFixed(2)}</span>
                        {isPaid && (
                          <span
                            className={"text-[8px] uppercase tracking-wider block font-bold text-emerald-500 font-sans mt-0.5"}
                          >
                            Pago
                          </span>
                        )}
                        {isCancelled && (
                          <span
                            className={"text-[8px] uppercase tracking-wider block font-bold text-rose-500 font-sans mt-0.5"}
                          >
                            Cancelado
                          </span>
                        )}
                        {!isPaid && !isCancelled && !isReadyForCheckout && (
                          <span
                            className={"text-[8px] uppercase tracking-wider block font-bold text-amber-600 dark:text-amber-300 font-sans mt-0.5"}
                          >
                            Em preparo
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {(() => {
                const { subtotal, taxa } = getCheckoutTotals(selectedOrder);
                const currentBalance = getCheckoutBalance(selectedOrder);
                const selectedTotal =
                  selectedItemIds.length > 0 ? getSelectedItemsTotal(selectedOrder, selectedItemIds) : 0;
                const projectedBalance = Math.max(0, currentBalance - selectedTotal);
                return (
                  <div
                    className={"bg-koma-card/60 border border-koma-border p-4 rounded-2xl font-mono text-[11px] space-y-2"}
                  >
                    <div className={"flex justify-between"}>
                      <span className={"font-sans text-koma-subtle"}>
                        {isTableCheckoutOrder(selectedOrder) ? 'Consumo da Mesa:' : 'Total Itens em Aberto:'}
                      </span>
                      <span className="text-koma-secondary">R$ {subtotal.toFixed(2)}</span>
                    </div>
                    {taxaServicoAtiva && checkoutServiceTax && (
                      <div className={"flex justify-between"}>
                        <span className={"font-sans text-koma-subtle"}>Taxa Serviço ({serviceTaxRate}%):</span>
                        <span className="text-koma-secondary">R$ {taxa.toFixed(2)}</span>
                      </div>
                    )}
                    {selectedItemIds.length > 0 && (
                      <div
                        className={"flex justify-between text-emerald-700 dark:text-emerald-400 font-bold border-t border-koma-border/40 pt-2"}
                      >
                        <span className="font-sans">Total Selecionado:</span>
                        <span>R$ {selectedTotal.toFixed(2)}</span>
                      </div>
                    )}
                    {selectedOrder.valorPago && selectedOrder.valorPago > 0 ? (
                      <div className={"flex justify-between text-emerald-400"}>
                        <span className={"font-sans font-bold"}>Total Pago Parcial:</span>
                        <span className="font-bold">R$ {selectedOrder.valorPago.toFixed(2)}</span>
                      </div>
                    ) : null}
                    <div
                      className={"flex justify-between border-t border-koma-border pt-2 text-sm text-emerald-700 dark:text-emerald-400 font-bold"}
                    >
                      <span className="font-sans">
                        {selectedItemIds.length > 0 ? 'Restará após receber:' : 'Saldo restante:'}
                      </span>
                      <span>R$ {(selectedItemIds.length > 0 ? projectedBalance : currentBalance).toFixed(2)}</span>
                    </div>
                  </div>
                );
              })()}

              {/* BARRA COMPACTA DE IMPRESSÃO */}
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-koma-border/40 bg-koma-card/40 shrink-0">
                <span className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider flex items-center gap-1.5">
                  <Printer size={12} /> Impressão:
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={printCheckoutReceipt}
                    className="px-2.5 py-1 bg-koma-panel hover:bg-koma-raised border border-koma-border rounded-lg text-[10px] font-bold text-koma-foreground transition-all cursor-pointer text-center"
                    title="Imprime a via térmica completa com todos os itens consumidos"
                  >
                    Reimpressão total
                  </button>
                  <button
                    type="button"
                    onClick={printCheckoutValues}
                    className="px-2.5 py-1 bg-koma-panel hover:bg-koma-raised border border-koma-border rounded-lg text-[10px] font-bold text-koma-foreground transition-all cursor-pointer text-center"
                    title="Imprime a Conta da Mesa com subtotal e taxa de serviço"
                  >
                    Imprimir Conta
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-3 sm:space-y-4 flex flex-col min-h-0">
              <h4 className="font-serif font-bold text-koma-secondary border-b border-koma-border pb-1.5 shrink-0">
                Receber Pagamento
              </h4>

              {selectedItemIds.length > 0 ? (
                <div className="flex items-center justify-between p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/25 shrink-0">
                  <div>
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                      Itens Selecionados
                    </span>
                    <strong className="text-sm font-bold text-koma-foreground font-mono">
                      {selectedItemIds.length} {selectedItemIds.length === 1 ? 'item' : 'itens'}
                    </strong>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                        Valor dos Itens
                      </span>
                      <strong className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        R$ {selectedTotal.toFixed(2)}
                      </strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedItemIds([]);
                        setSplitPeople('1');
                        setPaymentValor(currentBalance);
                      }}
                      className="px-2.5 py-1 text-[10px] font-bold uppercase rounded-lg border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 transition-colors cursor-pointer"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 bg-koma-card/60 rounded-2xl border border-koma-border shrink-0 text-xs">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider">
                      Dividir por:
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="1"
                        value={splitPeople}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSplitPeople(val);
                          const peopleNum = Math.max(1, parseInt(val, 10) || 1);
                          setPaymentValor(currentBalance / peopleNum);
                        }}
                        className="w-12 px-2 py-1 text-center font-mono font-bold bg-koma-panel border border-koma-border rounded-lg text-koma-foreground text-xs focus:outline-none focus:border-emerald-500"
                      />
                      <span className="text-[10px] text-koma-muted">pessoa(s)</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                      {Number(splitPeople) > 1 ? 'Cada um paga:' : 'Saldo a receber:'}
                    </span>
                    <strong className="text-sm font-bold text-koma-foreground font-mono">
                      R$ {(currentBalance / Math.max(1, parseInt(splitPeople, 10) || 1)).toFixed(2)}
                    </strong>
                  </div>
                </div>
              )}

              <form
                onSubmit={handleProcessPayment}
                className="space-y-3.5 bg-koma-card/40 p-3.5 sm:p-4 rounded-2xl border border-koma-border/50 flex-1 flex flex-col justify-between"
              >
                <div className="space-y-3.5">
                  {/* Forma de Pagamento */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                        Forma de Pagamento:
                      </label>
                      {!paymentMetodo && errorMsg && (
                        <span className="text-[10px] font-bold text-rose-500 dark:text-rose-400 animate-pulse">
                          Selecione uma opção abaixo
                        </span>
                      )}
                    </div>
                    <div
                      className={clsx(
                        'grid grid-cols-2 sm:grid-cols-4 gap-2',
                        !paymentMetodo && errorMsg && 'p-1 rounded-2xl border border-rose-500/40 bg-rose-500/5'
                      )}
                    >
                      {[
                        { id: 'pix' as const, label: 'Pix' },
                        { id: 'dinheiro' as const, label: 'Dinheiro' },
                        { id: 'cartao_debito' as const, label: 'C. Débito' },
                        { id: 'cartao_credito' as const, label: 'C. Crédito' },
                      ].map((method) => (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => setPaymentMetodo(method.id)}
                          className={clsx(
                            'min-h-11 py-2.5 px-3 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center text-center',
                            paymentMetodo === method.id
                              ? 'bg-emerald-600 border border-emerald-500 text-white shadow-md ring-2 ring-emerald-500/30'
                              : 'bg-koma-card border border-koma-border text-koma-secondary hover:border-koma-accent/40 hover:text-koma-foreground'
                          )}
                        >
                          {method.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Valor a Lançar */}
                  <div className="space-y-1.5 font-sans">
                    <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                      Valor a Lançar (R$):
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3.5 top-2.5 text-koma-subtle font-mono text-[11px]">
                          R$
                        </span>
                        <MoneyInput
                          required
                          value={paymentValor}
                          onValueChange={setPaymentValor}
                          readOnly={selectedItemIds.length > 0}
                          title={
                            selectedItemIds.length > 0
                              ? 'O valor é calculado automaticamente pelos itens selecionados.'
                              : 'Digite qualquer valor para abater do saldo.'
                          }
                          className={clsx(
                            'w-full pl-9 pr-4 py-2 text-xs bg-koma-card border border-koma-border rounded-xl focus:outline-none focus:border-[#10b981] text-koma-foreground font-mono',
                            selectedItemIds.length > 0 && 'cursor-not-allowed text-emerald-600 dark:text-emerald-300'
                          )}
                        />
                      </div>
                      {selectedItemIds.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedItemIds([]);
                            setPaymentValor(currentBalance);
                          }}
                          className="px-3.5 py-2 bg-emerald-500/15 hover:bg-[#10b981]/25 border border-emerald-500/30 rounded-xl text-[10px] font-bold text-emerald-700 dark:text-emerald-400 transition-all cursor-pointer whitespace-nowrap"
                        >
                          Digitar outro valor
                        </button>
                      ) : Number(paymentValor || 0) !== currentBalance ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSplitPeople('1');
                            setPaymentValor(currentBalance);
                          }}
                          className="px-3.5 py-2 bg-emerald-500/15 hover:bg-[#10b981]/25 border border-emerald-500/30 rounded-xl text-[10px] font-bold text-emerald-700 dark:text-emerald-400 transition-all cursor-pointer whitespace-nowrap"
                        >
                          Usar saldo total
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Atalhos de Cédulas para Dinheiro */}
                  {paymentMetodo === 'dinheiro' && (
                    <div className="space-y-1" role="group" aria-label="Atalhos de cédulas">
                      <label className="text-[8px] font-bold text-koma-muted uppercase tracking-wider block">
                        Atalhos de Cédulas:
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {[2, 5, 10, 20, 50, 100, 200].map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => {
                              setSelectedItemIds([]);
                              setPaymentValor(val);
                            }}
                            className="px-2.5 py-1 bg-koma-panel hover:bg-koma-raised border border-koma-border rounded-lg text-[9px] font-bold text-koma-secondary font-mono transition-all cursor-pointer hover:border-gray-500 hover:text-koma-foreground"
                          >
                            R$ {val}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Celular / Fidelidade */}
                  {identifiedCustomer && identifiedCustomer.telefone ? (
                    <div className="p-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-koma-foreground space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-emerald-400">
                          <Check size={11} className="stroke-[3]" />
                          <span>Cliente Identificado</span>
                        </div>
                        {(Number(identifiedCustomer.saldoCashback || 0) > 0 ||
                          Number(identifiedCustomer.pontos || 0) > 0) && (
                          <span className="text-[9px] font-bold text-emerald-300">
                            Cashback: R$ {Number(identifiedCustomer.saldoCashback || 0).toFixed(2)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs font-bold pt-0.5">
                        <span className="text-white flex items-center gap-1.5 min-w-0">
                          <User size={12} className="text-emerald-400 shrink-0" />
                          <span className="truncate">{identifiedCustomer.nome}</span>
                        </span>
                        <span className="font-mono text-emerald-300 text-[11px] shrink-0 ml-2">
                          {aplicarMascaraTelefoneInput(identifiedCustomer.telefone)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5 font-sans">
                      <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                        Celular do cliente (Opcional - Fidelidade):
                      </label>
                      <input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        value={paymentCPF}
                        onChange={(e) => setPaymentCPF(aplicarMascaraTelefoneInput(e.target.value))}
                        placeholder="(00) 00000-0000"
                        className="w-full px-3 py-2 text-xs bg-koma-card border border-koma-border rounded-xl focus:outline-none focus:border-[#10b981] text-koma-foreground"
                      />
                    </div>
                  )}

                  {/* Troco em tempo real */}
                  {(() => {
                    if (!selectedOrder) return null;
                    const restante = currentBalance;
                    if (paymentMetodo === 'dinheiro' && inputVal > restante) {
                      const troco = inputVal - restante;
                      return (
                        <div className="bg-emerald-950/45 border border-emerald-800/40 text-emerald-600 dark:text-emerald-300 p-2.5 rounded-xl text-xs font-mono flex justify-between items-center shadow-md shadow-emerald-950/20">
                          <span className="font-bold uppercase text-[9px] tracking-wider text-emerald-400">
                            Troco devido:
                          </span>
                          <span className="font-extrabold text-sm text-emerald-600 dark:text-emerald-300">
                            R$ {troco.toFixed(2)}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div className="space-y-2 pt-2">
                  {errorMsg && (
                    <div className="bg-rose-500/10 border border-rose-500/25 text-rose-400 p-2.5 rounded-xl text-center text-xs font-semibold block">
                      {errorMsg}
                    </div>
                  )}

                  {/* Botão Principal sem ambiguidade com ação e valor explícitos */}
                  <button
                    type="submit"
                    disabled={selectedCheckoutSmartPosState?.blocksPayment || isProcessingPayment}
                    className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer uppercase tracking-wider text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check size={16} />
                    <span>{primaryButtonLabel}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    )
  );
}
