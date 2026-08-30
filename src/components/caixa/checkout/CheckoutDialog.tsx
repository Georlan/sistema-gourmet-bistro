import clsx from 'clsx';
import { Check, RefreshCw, Smartphone, User, X } from 'lucide-react';
import { isCashierTableOrder as isTableCheckoutOrder } from '../../../domain/cashierOrderProjection';
import { aplicarMascaraTelefoneInput } from '../../../utils/phonePresentation';
import MoneyInput from '../../MoneyInput';
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
  return (
    selectedOrder &&
    showCheckoutModal && (
      <div
        className={clsx(
          'fixed',
          'inset-0',
          'bg-black/85',
          'backdrop-blur-xs',
          'z-50',
          'flex',
          'items-center',
          'justify-center',
          'p-4',
          'overflow-y-auto'
        )}
        onClick={() => setShowCheckoutModal(false)}
      >
        <div
          className={clsx(
            'bg-koma-input/95',
            'backdrop-blur-xl',
            'rounded-3xl',
            'border',
            'border-koma-accent/15',
            'shadow-2xl',
            'w-full',
            'max-w-3xl',
            'overflow-hidden',
            'max-h-[90vh]',
            'flex',
            'flex-col',
            'my-4'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={clsx(
              'bg-koma-raised',
              'text-koma-foreground',
              'p-5',
              'flex',
              'justify-between',
              'items-center',
              'shrink-0',
              'border-b',
              'border-koma-border'
            )}
          >
            <div>
              <span
                className={clsx(
                  'text-[10px]',
                  'font-bold',
                  'text-emerald-700 dark:text-emerald-400',
                  'uppercase',
                  'tracking-wider',
                  'block'
                )}
              >
                Checkout / Caixa
              </span>
              <h3 className={clsx('font-serif', 'text-lg', 'font-bold', 'text-koma-foreground')}>
                {selectedOrder.mesaId > 0 ? `Mesa ${selectedOrder.mesaId}` : `Pedido Balcão`}
              </h3>
              {selectedOrder.mesaOrigemId && Number(selectedOrder.mesaOrigemId) !== Number(selectedOrder.mesaId) && (
                <span
                  className={clsx(
                    'inline-flex',
                    'items-center',
                    'gap-1',
                    'mt-1',
                    'px-2',
                    'py-0.5',
                    'text-[9px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'bg-emerald-500/10',
                    'text-emerald-600 dark:text-emerald-300',
                    'border',
                    'border-emerald-500/25',
                    'rounded-full'
                  )}
                >
                  🔗 Mesclado de Mesa {selectedOrder.mesaOrigemId}
                </span>
              )}
              {selectedOrder.mesaTransferidaDe &&
                Number(selectedOrder.mesaTransferidaDe) !== Number(selectedOrder.mesaId) && (
                  <span
                    className={clsx(
                      'inline-flex',
                      'items-center',
                      'gap-1',
                      'mt-1',
                      'px-2',
                      'py-0.5',
                      'text-[9px]',
                      'font-bold',
                      'uppercase',
                      'tracking-wider',
                      'bg-purple-500/10',
                      'text-purple-300',
                      'border',
                      'border-purple-500/25',
                      'rounded-full'
                    )}
                  >
                    🔗 Transferido da Mesa {selectedOrder.mesaTransferidaDe}
                  </span>
                )}
            </div>
            <button
              type="button"
              onClick={() => setShowCheckoutModal(false)}
              className={clsx(
                'p-1.5',
                'hover:bg-koma-raised',
                'rounded-full',
                'text-koma-subtle',
                'hover:text-koma-foreground',
                'transition-colors',
                'cursor-pointer',
                'border',
                'border-transparent'
              )}
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
            className={clsx(
              'p-5',
              'overflow-y-auto',
              'flex-1',
              'bg-koma-raised',
              'grid',
              'grid-cols-1',
              'md:grid-cols-2',
              'gap-5'
            )}
          >
            <div className="space-y-4">
              <div
                className={clsx('flex', 'items-center', 'justify-between', 'border-b', 'border-koma-border', 'pb-1.5')}
              >
                <div>
                  <h4 className={clsx('font-serif', 'font-bold', 'text-koma-secondary')}>Extrato Consumo</h4>
                  <span className={clsx('text-[8px]', 'text-koma-muted')}>
                    Itens prontos já podem ser recebidos. Itens em preparo ficam visíveis, mas bloqueados até avançarem
                    na cozinha.
                  </span>
                </div>
                {taxaServicoAtiva && (
                  <label
                    className={clsx(
                      'flex',
                      'items-center',
                      'gap-1.5',
                      'text-[10px]',
                      'text-koma-subtle',
                      'font-bold',
                      'uppercase',
                      'tracking-wider',
                      'cursor-pointer'
                    )}
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
                      className={clsx(
                        'rounded',
                        'border-koma-border',
                        'text-emerald-500',
                        'focus:ring-emerald-500',
                        'h-3.5',
                        'w-3.5',
                        'bg-koma-card'
                      )}
                    />
                    <span>Taxa de {serviceTaxRate}%</span>
                  </label>
                )}
              </div>

              <div className={clsx('space-y-2.5', 'max-h-[40vh]', 'overflow-y-auto', 'pr-1')}>
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
                      <div className={clsx('flex', 'gap-2', 'items-start', 'flex-1', 'min-w-0')}>
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
                        <div className={clsx('min-w-0', 'space-y-0.5')}>
                          <span className={clsx('font-semibold', 'text-koma-foreground', 'block', 'truncate')}>
                            {item.nome}
                          </span>
                          <span className={clsx('text-[9px]', 'text-koma-subtle', 'block')}>
                            Cliente: {item.clienteNome}
                          </span>
                          {!isPaid && !isCancelled && !isReadyForCheckout && (
                            <span
                              className={clsx(
                                'text-[8px]',
                                'font-semibold',
                                'text-amber-600',
                                'dark:text-amber-300',
                                'block'
                              )}
                            >
                              Em preparo · avance na cozinha antes de baixar este item
                            </span>
                          )}
                        </div>
                      </div>

                      <div className={clsx('text-right', 'pl-3', 'shrink-0', 'font-mono')}>
                        <span className={clsx('font-bold', 'text-koma-secondary')}>R$ {item.preco.toFixed(2)}</span>
                        {isPaid && (
                          <span
                            className={clsx(
                              'text-[8px]',
                              'uppercase',
                              'tracking-wider',
                              'block',
                              'font-bold',
                              'text-emerald-500',
                              'font-sans',
                              'mt-0.5'
                            )}
                          >
                            Pago
                          </span>
                        )}
                        {isCancelled && (
                          <span
                            className={clsx(
                              'text-[8px]',
                              'uppercase',
                              'tracking-wider',
                              'block',
                              'font-bold',
                              'text-rose-500',
                              'font-sans',
                              'mt-0.5'
                            )}
                          >
                            Cancelado
                          </span>
                        )}
                        {!isPaid && !isCancelled && !isReadyForCheckout && (
                          <span
                            className={clsx(
                              'text-[8px]',
                              'uppercase',
                              'tracking-wider',
                              'block',
                              'font-bold',
                              'text-amber-600',
                              'dark:text-amber-300',
                              'font-sans',
                              'mt-0.5'
                            )}
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
                    className={clsx(
                      'bg-koma-card/60',
                      'border',
                      'border-koma-border',
                      'p-4',
                      'rounded-2xl',
                      'font-mono',
                      'text-[11px]',
                      'space-y-2'
                    )}
                  >
                    <div className={clsx('flex', 'justify-between')}>
                      <span className={clsx('font-sans', 'text-koma-subtle')}>
                        {isTableCheckoutOrder(selectedOrder) ? 'Consumo da Mesa:' : 'Total Itens em Aberto:'}
                      </span>
                      <span className="text-koma-secondary">R$ {subtotal.toFixed(2)}</span>
                    </div>
                    {taxaServicoAtiva && checkoutServiceTax && (
                      <div className={clsx('flex', 'justify-between')}>
                        <span className={clsx('font-sans', 'text-koma-subtle')}>Taxa Serviço ({serviceTaxRate}%):</span>
                        <span className="text-koma-secondary">R$ {taxa.toFixed(2)}</span>
                      </div>
                    )}
                    {selectedItemIds.length > 0 && (
                      <div
                        className={clsx(
                          'flex',
                          'justify-between',
                          'text-emerald-700 dark:text-emerald-400',
                          'font-bold',
                          'border-t',
                          'border-koma-border/40',
                          'pt-2'
                        )}
                      >
                        <span className="font-sans">Total Selecionado:</span>
                        <span>R$ {selectedTotal.toFixed(2)}</span>
                      </div>
                    )}
                    {selectedOrder.valorPago && selectedOrder.valorPago > 0 ? (
                      <div className={clsx('flex', 'justify-between', 'text-emerald-400')}>
                        <span className={clsx('font-sans', 'font-bold')}>Total Pago Parcial:</span>
                        <span className="font-bold">R$ {selectedOrder.valorPago.toFixed(2)}</span>
                      </div>
                    ) : null}
                    <div
                      className={clsx(
                        'flex',
                        'justify-between',
                        'border-t',
                        'border-koma-border',
                        'pt-2',
                        'text-sm',
                        'text-emerald-700 dark:text-emerald-400',
                        'font-bold'
                      )}
                    >
                      <span className="font-sans">
                        {selectedItemIds.length > 0 ? 'Restará após receber:' : 'Saldo restante:'}
                      </span>
                      <span>R$ {(selectedItemIds.length > 0 ? projectedBalance : currentBalance).toFixed(2)}</span>
                    </div>
                  </div>
                );
              })()}

              {/* BOTÕES DE REIMPRESSÃO DO EXTRATO */}
              <div
                className={clsx(
                  'bg-koma-card/40',
                  'border',
                  'border-koma-border/50',
                  'p-4',
                  'rounded-2xl',
                  'space-y-3',
                  'text-left'
                )}
              >
                <span
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-subtle',
                    'uppercase',
                    'tracking-wider',
                    'block'
                  )}
                >
                  Reimpressão de Extrato
                </span>
                <div className={clsx('flex', 'gap-2')}>
                  <button
                    type="button"
                    onClick={printCheckoutReceipt}
                    className={clsx(
                      'flex-1',
                      'py-2',
                      'bg-koma-panel',
                      'hover:bg-koma-raised',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-[10px]',
                      'font-bold',
                      'text-koma-foreground',
                      'transition-all',
                      'cursor-pointer',
                      'text-center'
                    )}
                    title="Imprime a via térmica completa com todos os itens consumidos"
                  >
                    Extrato Completo
                  </button>
                  <button
                    type="button"
                    onClick={printCheckoutValues}
                    className={clsx(
                      'flex-1',
                      'py-2',
                      'bg-koma-panel',
                      'hover:bg-koma-raised',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-[10px]',
                      'font-bold',
                      'text-koma-foreground',
                      'transition-all',
                      'cursor-pointer',
                      'text-center'
                    )}
                    title="Imprime apenas o resumo de subtotais e taxas de serviço para economizar papel"
                  >
                    Apenas Valores
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4
                className={clsx(
                  'font-serif',
                  'font-bold',
                  'text-koma-secondary',
                  'border-b',
                  'border-koma-border',
                  'pb-1.5'
                )}
              >
                Divisão e Recebimento
              </h4>

              {selectedItemIds.length > 0 ? (
                <div
                  className={clsx(
                    'grid',
                    'grid-cols-2',
                    'gap-3',
                    'bg-koma-card',
                    'p-3',
                    'rounded-2xl',
                    'border',
                    'border-koma-border'
                  )}
                >
                  <div>
                    <span
                      className={clsx(
                        'text-[9px]',
                        'font-bold',
                        'text-koma-subtle',
                        'uppercase',
                        'tracking-wider',
                        'block'
                      )}
                    >
                      Itens prontos
                    </span>
                    <strong className={clsx('mt-1', 'block', 'text-sm', 'text-koma-foreground', 'font-mono')}>
                      {selectedItemIds.length}
                    </strong>
                  </div>
                  <div className="text-right">
                    <span
                      className={clsx(
                        'text-[9px]',
                        'font-bold',
                        'text-koma-subtle',
                        'uppercase',
                        'tracking-wider',
                        'block'
                      )}
                    >
                      Recebendo agora
                    </span>
                    <strong
                      className={clsx(
                        'mt-1',
                        'block',
                        'text-sm',
                        'text-emerald-700 dark:text-emerald-300',
                        'font-mono'
                      )}
                    >
                      R$ {getSelectedItemsTotal(selectedOrder, selectedItemIds).toFixed(2)}
                    </strong>
                  </div>
                </div>
              ) : (
                <div
                  className={clsx(
                    'grid',
                    'grid-cols-2',
                    'gap-3',
                    'bg-koma-card',
                    'p-3',
                    'rounded-2xl',
                    'border',
                    'border-koma-border'
                  )}
                >
                  <div className="space-y-1">
                    <label
                      className={clsx(
                        'text-[9px]',
                        'font-bold',
                        'text-koma-subtle',
                        'uppercase',
                        'tracking-wider',
                        'block'
                      )}
                    >
                      Pessoas:
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={splitPeople}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSplitPeople(val);
                        const peopleNum = parseInt(val, 10) || 1;
                        setPaymentValor(getCheckoutBalance(selectedOrder) / peopleNum);
                      }}
                      className={clsx(
                        'w-full',
                        'px-3',
                        'py-1.5',
                        'text-xs',
                        'bg-koma-panel',
                        'border',
                        'border-koma-border',
                        'rounded-xl',
                        'focus:outline-none',
                        'text-koma-foreground',
                        'text-center',
                        'font-mono'
                      )}
                    />
                  </div>
                  <div className={clsx('space-y-1', 'flex', 'flex-col', 'justify-end', 'text-right')}>
                    <span
                      className={clsx(
                        'text-[9px]',
                        'font-bold',
                        'text-koma-subtle',
                        'uppercase',
                        'tracking-wider',
                        'block'
                      )}
                    >
                      Valor por pessoa:
                    </span>
                    <span
                      className={clsx('text-sm', 'font-bold', 'text-koma-foreground', 'font-mono', 'leading-relaxed')}
                    >
                      R${' '}
                      {(() => {
                        const peopleNum = parseInt(splitPeople, 10) || 1;
                        return (getCheckoutBalance(selectedOrder) / peopleNum).toFixed(2);
                      })()}
                    </span>
                  </div>
                </div>
              )}

              <form
                onSubmit={handleProcessPayment}
                className={clsx(
                  'space-y-4',
                  'bg-koma-card/40',
                  'p-4',
                  'rounded-2xl',
                  'border',
                  'border-koma-border/50'
                )}
              >
                <span
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-emerald-700 dark:text-emerald-400',
                    'uppercase',
                    'tracking-wider',
                    'block'
                  )}
                >
                  Receber Pagamento
                </span>

                <div className="space-y-1.5">
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block'
                    )}
                  >
                    Método de Baixa:
                  </label>
                  <div
                    className={clsx(
                      'flex',
                      'gap-1.5',
                      'p-1',
                      'bg-koma-card',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'shrink-0',
                      'flex-wrap'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setPaymentMetodo('pix')}
                      className={`flex-1 min-w-[50px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${
                        paymentMetodo === 'pix'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-koma-subtle hover:text-white'
                      }`}
                    >
                      Pix
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMetodo('dinheiro')}
                      className={`flex-1 min-w-[60px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${
                        paymentMetodo === 'dinheiro'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-koma-subtle hover:text-white'
                      }`}
                    >
                      Dinheiro
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMetodo('cartao_debito')}
                      className={`flex-1 min-w-[70px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${
                        paymentMetodo === 'cartao_debito'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-koma-subtle hover:text-white'
                      }`}
                    >
                      C. Débito
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMetodo('cartao_credito')}
                      className={`flex-1 min-w-[70px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${
                        paymentMetodo === 'cartao_credito'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-koma-subtle hover:text-white'
                      }`}
                    >
                      C. Crédito
                    </button>
                  </div>
                </div>

                <div className={clsx('space-y-1.5', 'font-sans')}>
                  <label
                    className={clsx(
                      'text-[10px]',
                      'font-bold',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-wider',
                      'block'
                    )}
                  >
                    Valor a Lançar (R$):
                  </label>
                  <div className={clsx('flex', 'gap-2')}>
                    <div className={clsx('relative', 'flex-1')}>
                      <span
                        className={clsx(
                          'absolute',
                          'left-3.5',
                          'top-2.5',
                          'text-koma-subtle',
                          'font-mono',
                          'text-[11px]'
                        )}
                      >
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
                          'w-full',
                          'pl-9',
                          'pr-4',
                          'py-2',
                          'text-xs',
                          'bg-koma-card',
                          'border',
                          'border-koma-border',
                          'rounded-xl',
                          'focus:outline-none',
                          'focus:border-[#10b981]',
                          'text-koma-foreground',
                          'font-mono',
                          selectedItemIds.length > 0 && 'cursor-not-allowed text-emerald-600 dark:text-emerald-300'
                        )}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedOrder) return;
                        setSplitPeople('1');
                        if (selectedItemIds.length > 0) {
                          setSelectedItemIds([]);
                          setPaymentValor('');
                        } else {
                          setPaymentValor(getCheckoutBalance(selectedOrder));
                        }
                      }}
                      className={clsx(
                        'px-3.5',
                        'py-2',
                        'bg-emerald-500/15',
                        'hover:bg-[#10b981]/25',
                        'border',
                        'border-emerald-500/30',
                        'rounded-xl',
                        'text-[10px]',
                        'font-bold',
                        'text-emerald-700 dark:text-emerald-400',
                        'transition-all',
                        'cursor-pointer',
                        'whitespace-nowrap'
                      )}
                    >
                      {selectedItemIds.length > 0 ? 'Adiantar outro valor' : 'Usar saldo total'}
                    </button>
                  </div>
                  <span className={clsx('text-[8px]', 'text-koma-muted', 'block', 'mt-1.5', 'leading-normal')}>
                    <strong>Dica:</strong>{' '}
                    {selectedItemIds.length > 0
                      ? 'Os itens prontos marcados serão baixados juntos. “Adiantar outro valor” limpa a seleção e libera um valor manual.'
                      : isTableCheckoutOrder(selectedOrder)
                        ? 'Sem itens marcados, o lançamento é um adiantamento sobre o saldo geral da mesa; itens em preparo continuam sem baixa individual.'
                        : 'Para pagamentos múltiplos, digite qualquer valor e faça as baixas em sequência.'}
                  </span>
                </div>

                {/* BOTÕES DE ATALHO DE CÉDULAS (CASH SHORTCUTS) */}
                <div className="space-y-1">
                  <label
                    className={clsx(
                      'text-[8px]',
                      'font-bold',
                      'text-koma-muted',
                      'uppercase',
                      'tracking-wider',
                      'block'
                    )}
                  >
                    Atalhos de Cédulas:
                  </label>
                  <div className={clsx('flex', 'flex-wrap', 'gap-1')}>
                    {[2, 5, 10, 20, 50, 100, 200].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setSelectedItemIds([]);
                          setPaymentValor(val);
                        }}
                        className={clsx(
                          'px-2.5',
                          'py-1',
                          'bg-koma-panel',
                          'hover:bg-koma-raised',
                          'border',
                          'border-koma-border',
                          'rounded-lg',
                          'text-[9px]',
                          'font-bold',
                          'text-koma-secondary',
                          'font-mono',
                          'transition-all',
                          'cursor-pointer',
                          'hover:border-gray-500',
                          'hover:text-koma-foreground'
                        )}
                      >
                        R$ {val}
                      </button>
                    ))}
                  </div>
                </div>

                {identifiedCustomer && identifiedCustomer.telefone ? (
                  <div
                    className={clsx(
                      'p-2.5',
                      'rounded-xl',
                      'border',
                      'border-emerald-500/25',
                      'bg-emerald-500/10',
                      'text-koma-foreground',
                      'space-y-1'
                    )}
                  >
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
                  <div className={clsx('space-y-1.5', 'font-sans')}>
                    <label
                      className={clsx(
                        'text-[10px]',
                        'font-bold',
                        'text-koma-subtle',
                        'uppercase',
                        'tracking-wider',
                        'block'
                      )}
                    >
                      Celular do cliente (Opcional - Fidelidade):
                    </label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      value={paymentCPF}
                      onChange={(e) => setPaymentCPF(aplicarMascaraTelefoneInput(e.target.value))}
                      placeholder="(00) 00000-0000"
                      className={clsx(
                        'w-full',
                        'px-3',
                        'py-2',
                        'text-xs',
                        'bg-koma-card',
                        'border',
                        'border-koma-border',
                        'rounded-xl',
                        'focus:outline-none',
                        'focus:border-[#10b981]',
                        'text-koma-foreground'
                      )}
                    />
                  </div>
                )}

                {/* TROCO EM TEMPO REAL */}
                {(() => {
                  if (!selectedOrder) return null;
                  const restante = getCheckoutBalance(selectedOrder);
                  const inputVal = Number(paymentValor || 0) || 0;
                  if (paymentMetodo === 'dinheiro' && inputVal > restante) {
                    const troco = inputVal - restante;
                    return (
                      <div
                        className={clsx(
                          'bg-emerald-950/45',
                          'border',
                          'border-emerald-800/40',
                          'text-emerald-600 dark:text-emerald-300',
                          'p-3',
                          'rounded-xl',
                          'text-xs',
                          'font-mono',
                          'flex',
                          'justify-between',
                          'items-center',
                          'shadow-md',
                          'shadow-emerald-950/20'
                        )}
                      >
                        <span
                          className={clsx('font-bold', 'uppercase', 'text-[9px]', 'tracking-wider', 'text-emerald-400')}
                        >
                          Troco devido:
                        </span>
                        <span className={clsx('font-extrabold', 'text-sm', 'text-emerald-600 dark:text-emerald-300')}>
                          R$ {troco.toFixed(2)}
                        </span>
                      </div>
                    );
                  }
                  return null;
                })()}

                {selectedItemIds.length > 0 && (
                  <div
                    className={clsx(
                      'bg-emerald-500/15',
                      'border',
                      'border-emerald-500/30',
                      'text-emerald-700 dark:text-emerald-400',
                      'p-2.5',
                      'rounded-xl',
                      'text-[10px]',
                      'flex',
                      'items-center',
                      'justify-between',
                      'gap-2'
                    )}
                  >
                    <span>
                      Pagando <strong>{selectedItemIds.length} item(ns)</strong> selecionado(s).
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedItemIds([]);
                        setSplitPeople('1');
                        setPaymentValor('');
                      }}
                      className={clsx(
                        'shrink-0',
                        'rounded-lg',
                        'border',
                        'border-emerald-500/30',
                        'px-2',
                        'py-1',
                        'text-[8px]',
                        'font-bold',
                        'uppercase',
                        'hover:bg-emerald-500/15'
                      )}
                    >
                      Outro valor
                    </button>
                  </div>
                )}

                {errorMsg && (
                  <div
                    className={clsx(
                      'bg-rose-500/10',
                      'border',
                      'border-rose-500/25',
                      'text-rose-400',
                      'p-2.5',
                      'rounded-xl',
                      'text-center',
                      'font-medium',
                      'block'
                    )}
                  >
                    {errorMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={selectedCheckoutSmartPosState?.blocksPayment || isProcessingPayment}
                  className={clsx(
                    'w-full',
                    'py-3',
                    'bg-emerald-600',
                    'hover:bg-emerald-700',
                    'text-white',
                    'rounded-xl',
                    'font-bold',
                    'flex',
                    'items-center',
                    'justify-center',
                    'gap-1.5',
                    'shadow-md',
                    'transition-all',
                    'cursor-pointer',
                    'uppercase',
                    'tracking-wider',
                    'text-[10px]',
                    'disabled:cursor-not-allowed',
                    'disabled:opacity-50'
                  )}
                >
                  <Check size={14} />
                  <span>
                    {selectedItemIds.length > 0
                      ? isTableCheckoutOrder(selectedOrder)
                        ? 'Receber itens prontos'
                        : 'Receber itens selecionados'
                      : isTableCheckoutOrder(selectedOrder)
                        ? 'Registrar adiantamento'
                        : 'Lançar pagamento / baixa'}
                  </span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    )
  );
}
