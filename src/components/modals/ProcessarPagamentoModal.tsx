import React from 'react';
import { X, Check } from 'lucide-react';
import clsx from 'clsx';
import { Order } from '../../types';

export interface ProcessarPagamentoModalProps {
  selectedOrder: Order | null;
  showCheckoutModal: boolean;
  onClose: () => void;
  taxaServicoAtiva: boolean;
  serviceTaxRate: number;
  checkoutServiceTax: boolean;
  setCheckoutServiceTax: (v: boolean) => void;
  selectedItemIds: string[];
  setSelectedItemIds: React.Dispatch<React.SetStateAction<string[]>>;
  splitPeople: string;
  setSplitPeople: (v: string) => void;
  paymentValor: string;
  setPaymentValor: (v: string) => void;
  paymentMetodo: 'pix' | 'dinheiro' | 'cartao_debito' | 'cartao_credito';
  setPaymentMetodo: (v: 'pix' | 'dinheiro' | 'cartao_debito' | 'cartao_credito') => void;
  paymentCPF: string;
  setPaymentCPF: (v: string) => void;
  errorMsg: string;
  isTableCheckoutOrder: (order: Order | null | undefined) => boolean;
  getCheckoutBalance: (order: Order | null, includeServiceTax?: boolean) => number;
  getSelectedItemsTotal: (order: Order | null, itemIds: string[], includeServiceTax?: boolean) => number;
  getCheckoutTotals: (order: Order | null) => { subtotal: number; taxa: number };
  aplicarMascaraTelefoneInput: (valor: string) => string;
  handleProcessPayment: (e: React.FormEvent) => Promise<void>;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

export function ProcessarPagamentoModal({
  selectedOrder,
  showCheckoutModal,
  onClose,
  taxaServicoAtiva,
  serviceTaxRate,
  checkoutServiceTax,
  setCheckoutServiceTax,
  selectedItemIds,
  setSelectedItemIds,
  splitPeople,
  setSplitPeople,
  paymentValor,
  setPaymentValor,
  paymentMetodo,
  setPaymentMetodo,
  paymentCPF,
  setPaymentCPF,
  errorMsg,
  isTableCheckoutOrder,
  getCheckoutBalance,
  getSelectedItemsTotal,
  getCheckoutTotals,
  aplicarMascaraTelefoneInput,
  handleProcessPayment,
  apiBaseUrl,
  authHeaders
}: ProcessarPagamentoModalProps) {
  if (!selectedOrder || !showCheckoutModal) return null;

  return (
    <div
      className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'overflow-y-auto')}
      onClick={onClose}
    >
      <div
        className={clsx('bg-[#0D0D10]/95', 'backdrop-blur-xl', 'rounded-3xl', 'border', 'border-[#10b981]/15', 'shadow-2xl', 'w-full', 'max-w-3xl', 'overflow-hidden', 'max-h-[90vh]', 'flex', 'flex-col', 'my-4')}
        onClick={(e) => e.stopPropagation()}
      >

        <div className={clsx('bg-[#18181B]', 'text-white', 'p-5', 'flex', 'justify-between', 'items-center', 'shrink-0', 'border-b', 'border-[#27272A]')}>
          <div>
            <span className={clsx('text-[10px]', 'font-bold', 'text-[#10b981]', 'uppercase', 'tracking-wider', 'block')}>Checkout / Caixa</span>
            <h3 className={clsx('font-serif', 'text-lg', 'font-bold', 'text-white')}>
              {selectedOrder.mesaId > 0 ? `Mesa ${selectedOrder.mesaId}` : `Pedido Balcão`}
            </h3>
            {selectedOrder.mesaOrigemId && Number(selectedOrder.mesaOrigemId) !== Number(selectedOrder.mesaId) && (
              <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 rounded-full">
                🔗 Mesclado de Mesa {selectedOrder.mesaOrigemId}
              </span>
            )}
            {selectedOrder.mesaTransferidaDe && Number(selectedOrder.mesaTransferidaDe) !== Number(selectedOrder.mesaId) && (
              <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-300 border border-purple-500/25 rounded-full">
                🔗 Transferido da Mesa {selectedOrder.mesaTransferidaDe}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={clsx('p-1.5', 'hover:bg-[#27272A]', 'rounded-full', 'text-gray-400', 'hover:text-white', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
            title="Fechar (o pedido permanece na fila)"
          >
            <X size={18} />
          </button>
        </div>

        <div className={clsx('p-5', 'overflow-y-auto', 'flex-1', 'bg-[#18181B]', 'grid', 'grid-cols-1', 'md:grid-cols-2', 'gap-5')}>
          <div className="space-y-4">
            <div className={clsx('flex', 'items-center', 'justify-between', 'border-b', 'border-[#27272A]', 'pb-1.5')}>
              <div>
                <h4 className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Extrato Consumo</h4>
                <span className="text-[8px] text-gray-500">
                  Marque itens para pagá-los juntos ou deixe tudo desmarcado para receber qualquer valor.
                </span>
              </div>
              {taxaServicoAtiva && (
                <label className={clsx('flex', 'items-center', 'gap-1.5', 'text-[10px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'cursor-pointer')}>
                  <input
                    type="checkbox"
                    checked={checkoutServiceTax}
                    onChange={(e) => {
                      const includeServiceTax = e.target.checked;
                      setCheckoutServiceTax(includeServiceTax);
                      const nextValue = selectedItemIds.length > 0
                        ? getSelectedItemsTotal(
                          selectedOrder,
                          selectedItemIds,
                          includeServiceTax
                        )
                        : getCheckoutBalance(
                          selectedOrder,
                          includeServiceTax
                        );
                      setPaymentValor(nextValue.toFixed(2));
                    }}
                    className={clsx('rounded', 'border-[#27272A]', 'text-emerald-500', 'focus:ring-emerald-500', 'h-3.5', 'w-3.5', 'bg-[#121214]')}
                  />
                  <span>Taxa de {serviceTaxRate}%</span>
                </label>
              )}
            </div>

            <div className={clsx('space-y-2.5', 'max-h-[40vh]', 'overflow-y-auto', 'pr-1')}>
              {selectedOrder.itens.map((item) => {
                const isPaid = item.pago;
                const isCancelled = (item.status as string) === 'cancelado';
                const canSelect = !isPaid && !isCancelled;
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (!canSelect) return;
                      setSplitPeople('1');
                      setSelectedItemIds(prev => {
                        const copy = [...prev];
                        const idx = copy.indexOf(item.id);
                        if (idx >= 0) {
                          copy.splice(idx, 1);
                        } else {
                          copy.push(item.id);
                        }
                        const nextValue = copy.length > 0
                          ? getSelectedItemsTotal(selectedOrder, copy)
                          : getCheckoutBalance(selectedOrder);
                        setPaymentValor(nextValue.toFixed(2));
                        return copy;
                      });
                    }}
                    className={`flex items-start justify-between p-2.5 rounded-xl border border-transparent transition-all text-[11px] ${isCancelled
                      ? 'bg-rose-500/5 border-rose-500/10 text-rose-400 opacity-60'
                      : isPaid
                      ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400'
                      : selectedItemIds.includes(item.id)
                        ? 'bg-[#10b981]/10 border-[#10b981]/30 cursor-pointer shadow-inner'
                        : 'bg-[#121214]/60 border-[#27272A]/50 hover:border-[#27272A] cursor-pointer'
                      }`}
                  >
                    <div className={clsx('flex', 'gap-2', 'items-start', 'flex-1', 'min-w-0')}>
                      {canSelect && (
                        <div className={`mt-0.5 h-3.5 w-3.5 rounded border border-[#27272A] flex items-center justify-center shrink-0 bg-[#121214] ${selectedItemIds.includes(item.id) ? 'border-[#10b981] bg-[#10b981]/10' : ''
                          }`}>
                          {selectedItemIds.includes(item.id) && <Check size={10} className="text-[#10b981]" />}
                        </div>
                      )}
                      <div className={clsx('min-w-0', 'space-y-0.5')}>
                        <span className={clsx('font-semibold', 'text-white', 'block', 'truncate')}>{item.nome}</span>
                        <span className={clsx('text-[9px]', 'text-gray-400', 'block')}>Cliente: {item.clienteNome}</span>
                      </div>
                    </div>

                    <div className={clsx('text-right', 'pl-3', 'shrink-0', 'font-mono')}>
                      <span className={clsx('font-bold', 'text-gray-300')}>R$ {item.preco.toFixed(2)}</span>
                      {isPaid && <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'block', 'font-bold', 'text-emerald-500', 'font-sans', 'mt-0.5')}>Pago</span>}
                      {isCancelled && <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'block', 'font-bold', 'text-rose-500', 'font-sans', 'mt-0.5')}>Cancelado</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {(() => {
              const { subtotal, taxa } = getCheckoutTotals(selectedOrder);
              return (
                <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'p-4', 'rounded-2xl', 'font-mono', 'text-[11px]', 'space-y-2')}>
                  <div className={clsx('flex', 'justify-between')}>
                    <span className={clsx('font-sans', 'text-gray-400')}>
                      {isTableCheckoutOrder(selectedOrder) ? 'Consumo da Mesa:' : 'Total Itens em Aberto:'}
                    </span>
                    <span className="text-gray-300">R$ {subtotal.toFixed(2)}</span>
                  </div>
                  {taxaServicoAtiva && checkoutServiceTax && (
                    <div className={clsx('flex', 'justify-between')}>
                      <span className={clsx('font-sans', 'text-gray-400')}>Taxa Serviço ({serviceTaxRate}%):</span>
                      <span className="text-gray-300">R$ {taxa.toFixed(2)}</span>
                    </div>
                  )}
                  {selectedItemIds.length > 0 && (
                    <div className={clsx('flex', 'justify-between', 'text-[#10b981]', 'font-bold', 'border-t', 'border-[#27272A]/40', 'pt-2')}>
                      <span className="font-sans">Total Selecionado:</span>
                      <span>R$ {getSelectedItemsTotal(
                        selectedOrder,
                        selectedItemIds
                      ).toFixed(2)}</span>
                    </div>
                  )}
                  {selectedOrder.valorPago && selectedOrder.valorPago > 0 ? (
                    <div className={clsx('flex', 'justify-between', 'text-emerald-400')}>
                      <span className={clsx('font-sans', 'font-bold')}>Total Pago Parcial:</span>
                      <span className="font-bold">R$ {selectedOrder.valorPago.toFixed(2)}</span>
                    </div>
                  ) : null}
                  <div className={clsx('flex', 'justify-between', 'border-t', 'border-[#27272A]', 'pt-2', 'text-sm', 'text-[#10b981]', 'font-bold')}>
                    <span className="font-sans">Saldo Restante:</span>
                    <span>R$ {getCheckoutBalance(selectedOrder).toFixed(2)}</span>
                  </div>
                </div>
              );
            })()}

            {/* BOTÕES DE REIMPRESSÃO DO EXTRATO */}
            <div className={clsx('bg-[#121214]/40', 'border', 'border-[#27272A]/50', 'p-4', 'rounded-2xl', 'space-y-3', 'text-left')}>
              <span className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Reimpressão de Extrato</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const printHeader = localStorage.getItem("koma_print_header") || "";
                      const printFooter = localStorage.getItem("koma_print_footer") || "";
                      let url = `${apiBaseUrl}/mesas/${selectedOrder.mesaId}/imprimir-recibo?apenas_valores=false`;
                      const params = new URLSearchParams();
                      if (printHeader) params.append("print_header", printHeader);
                      if (printFooter) params.append("print_footer", printFooter);
                      if (params.toString()) url += `&${params.toString()}`;
                      
                      const response = await fetch(url, {
                        method: 'POST',
                        headers: authHeaders
                      });
                      if (response.ok) {
                        window.dispatchEvent(
                          new Event('koma_print_monitor_refresh')
                        );
                      } else {
                        const err = await response.json();
                        alert(`Erro ao imprimir: ${err.detail}`);
                      }
                    } catch (err) {
                      console.error(err);
                      alert("Erro de conexão ao imprimir extrato.");
                    }
                  }}
                  className={clsx('flex-1', 'py-2', 'bg-[#1C1C1F]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-[10px]', 'font-bold', 'text-white', 'transition-all', 'cursor-pointer', 'text-center')}
                  title="Imprime a via térmica completa com todos os itens consumidos"
                >
                  🖨️ Completo
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const printHeader = localStorage.getItem("koma_print_header") || "";
                      const printFooter = localStorage.getItem("koma_print_footer") || "";
                      let url = `${apiBaseUrl}/mesas/${selectedOrder.mesaId}/imprimir-recibo?apenas_valores=true`;
                      const params = new URLSearchParams();
                      if (printHeader) params.append("print_header", printHeader);
                      if (printFooter) params.append("print_footer", printFooter);
                      if (params.toString()) url += `&${params.toString()}`;
                      
                      const response = await fetch(url, {
                        method: 'POST',
                        headers: authHeaders
                      });
                      if (response.ok) {
                        window.dispatchEvent(
                          new Event('koma_print_monitor_refresh')
                        );
                      } else {
                        const err = await response.json();
                        alert(`Erro ao imprimir: ${err.detail}`);
                      }
                    } catch (err) {
                      console.error(err);
                      alert("Erro de conexão ao imprimir extrato resumido.");
                    }
                  }}
                  className={clsx('flex-1', 'py-2', 'bg-[#1C1C1F]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-[10px]', 'font-bold', 'text-white', 'transition-all', 'cursor-pointer', 'text-center')}
                  title="Imprime apenas o resumo de subtotais e taxas de serviço para economizar papel"
                >
                  🖨️ Só Valores
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className={clsx('font-serif', 'font-bold', 'text-gray-300', 'border-b', 'border-[#27272A]', 'pb-1.5')}>Divisão e Recebimento</h4>

            <div className={clsx('grid', 'grid-cols-2', 'gap-3', 'bg-[#121214]', 'p-3', 'rounded-2xl', 'border', 'border-[#27272A]')}>
              <div className="space-y-1">
                <label className={clsx('text-[9px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Pessoas:</label>
                <input
                  type="number"
                  min="1"
                  value={splitPeople}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSplitPeople(val);
                    setSelectedItemIds([]);
                    const peopleNum = parseInt(val, 10) || 1;
                    setPaymentValor((getCheckoutBalance(selectedOrder) / peopleNum).toFixed(2));
                  }}
                  className={clsx('w-full', 'px-3', 'py-1.5', 'text-xs', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'text-white', 'text-center', 'font-mono')}
                />
              </div>
              <div className={clsx('space-y-1', 'flex', 'flex-col', 'justify-end', 'text-right')}>
                <span className={clsx('text-[9px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Valor por Pessoa:</span>
                <span className={clsx('text-sm', 'font-bold', 'text-white', 'font-mono', 'leading-relaxed')}>
                  R$ {(() => {
                    const peopleNum = parseInt(splitPeople, 10) || 1;
                    return (getCheckoutBalance(selectedOrder) / peopleNum).toFixed(2);
                  })()}
                </span>
              </div>
            </div>

            <form onSubmit={handleProcessPayment} className={clsx('space-y-4', 'bg-[#121214]/40', 'p-4', 'rounded-2xl', 'border', 'border-[#27272A]/50')}>
              <span className={clsx('text-[10px]', 'font-bold', 'text-[#10b981]', 'uppercase', 'tracking-wider', 'block')}>Receber Pagamento</span>

              <div className="space-y-1.5">
                <label className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Método de Baixa:</label>
                <div className={clsx('flex', 'gap-1.5', 'p-1', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'shrink-0', 'flex-wrap')}>
                  <button
                    type="button"
                    onClick={() => setPaymentMetodo('pix')}
                    className={`flex-1 min-w-[50px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'pix' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                      }`}
                  >
                    Pix
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMetodo('dinheiro')}
                    className={`flex-1 min-w-[60px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'dinheiro' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                      }`}
                  >
                    Dinheiro
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMetodo('cartao_debito')}
                    className={`flex-1 min-w-[70px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'cartao_debito' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                      }`}
                  >
                    C. Débito
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMetodo('cartao_credito')}
                    className={`flex-1 min-w-[70px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'cartao_credito' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                      }`}
                  >
                    C. Crédito
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 font-sans">
                <label className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Valor a Lançar (R$):</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className={clsx('absolute', 'left-3.5', 'top-2.5', 'text-gray-400', 'font-mono', 'text-[11px]')}>R$</span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={paymentValor}
                      onChange={(e) => setPaymentValor(e.target.value)}
                      readOnly={selectedItemIds.length > 0}
                      title={selectedItemIds.length > 0
                        ? 'O valor é calculated automaticamente pelos itens selecionados.'
                        : 'Digite qualquer valor para abater do saldo.'}
                      className={clsx(
                        'w-full',
                        'pl-9',
                        'pr-4',
                        'py-2',
                        'text-xs',
                        'bg-[#121214]',
                        'border',
                        'border-[#27272A]',
                        'rounded-xl',
                        'focus:outline-none',
                        'focus:border-[#10b981]',
                        'text-white',
                        'font-mono',
                        selectedItemIds.length > 0 && 'cursor-not-allowed text-emerald-300'
                      )}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedOrder) {
                        setSelectedItemIds([]);
                        setSplitPeople('1');
                        setPaymentValor(getCheckoutBalance(selectedOrder).toFixed(2));
                      }
                    }}
                    className={clsx(
                      'px-3.5',
                      'py-2',
                      'bg-[#10b981]/15',
                      'hover:bg-[#10b981]/25',
                      'border',
                      'border-[#10b981]/30',
                      'rounded-xl',
                      'text-[10px]',
                      'font-bold',
                      'text-[#10b981]',
                      'transition-all',
                      'cursor-pointer',
                      'whitespace-nowrap'
                    )}
                  >
                    {selectedItemIds.length > 0 ? 'Usar Saldo Total' : 'Pagar Valor Exato'}
                  </button>
                </div>
                <span className={clsx('text-[8px]', 'text-gray-500', 'block', 'mt-1.5', 'leading-normal')}>
                  💡 <strong>Dica:</strong> {selectedItemIds.length > 0
                    ? 'Os itens marcados serão baixados juntos. Use “Usar Saldo Total” ou desmarque-os para lançar um valor livre.'
                    : isTableCheckoutOrder(selectedOrder)
                      ? 'Sem itens marcados, qualquer baixa abate o saldo geral da mesa. Você pode receber uma parte no Pix e o restante no cartão.'
                      : 'Para pagamentos múltiplos, digite qualquer valor e faça as baixas em sequência.'}
                </span>
              </div>

              {/* BOTÕES DE ATALHO DE CÉDULAS */}
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-gray-500 uppercase tracking-wider block">Atalhos de Cédulas:</label>
                <div className="flex flex-wrap gap-1">
                  {[2, 5, 10, 20, 50, 100, 200].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => {
                        setSelectedItemIds([]);
                        setPaymentValor(val.toFixed(2));
                      }}
                      className="px-2.5 py-1 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] rounded-lg text-[9px] font-bold text-gray-300 font-mono transition-all cursor-pointer hover:border-gray-500 hover:text-white"
                    >
                      R$ {val}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 font-sans">
                <label className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Celular do cliente (Opcional - Fidelidade):</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={paymentCPF}
                  onChange={(e) => setPaymentCPF(aplicarMascaraTelefoneInput(e.target.value))}
                  placeholder="(00) 00000-0000"
                  className={clsx('w-full', 'px-3', 'py-2', 'text-xs', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white')}
                />
              </div>

              {/* TROCO EM TEMPO REAL */}
              {(() => {
                if (!selectedOrder) return null;
                const restante = getCheckoutBalance(selectedOrder);
                const inputVal = parseFloat(paymentValor) || 0;
                if (paymentMetodo === 'dinheiro' && inputVal > restante) {
                  const troco = inputVal - restante;
                  return (
                    <div className={clsx(
                      'bg-emerald-950/45',
                      'border',
                      'border-emerald-800/40',
                      'text-emerald-300',
                      'p-3',
                      'rounded-xl',
                      'text-xs',
                      'font-mono',
                      'flex',
                      'justify-between',
                      'items-center',
                      'shadow-md',
                      'shadow-emerald-950/20'
                    )}>
                      <span className="font-bold uppercase text-[9px] tracking-wider text-emerald-400">Troco devido:</span>
                      <span className="font-extrabold text-sm text-emerald-200">R$ {troco.toFixed(2)}</span>
                    </div>
                  );
                }
                return null;
              })()}

              {selectedItemIds.length > 0 && (
                <div className={clsx('bg-[#10b981]/15', 'border', 'border-[#10b981]/30', 'text-[#10b981]', 'p-2.5', 'rounded-xl', 'text-[10px]', 'flex', 'items-center', 'justify-between', 'gap-2')}>
                  <span>
                    Pagando <strong>{selectedItemIds.length} item(ns)</strong> selecionado(s).
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemIds([]);
                      setSplitPeople('1');
                      setPaymentValor(getCheckoutBalance(selectedOrder).toFixed(2));
                    }}
                    className="shrink-0 rounded-lg border border-[#10b981]/30 px-2 py-1 text-[8px] font-bold uppercase hover:bg-[#10b981]/10"
                  >
                    Limpar
                  </button>
                </div>
              )}

              {errorMsg && (
                <div className={clsx('bg-rose-500/10', 'border', 'border-rose-500/25', 'text-rose-400', 'p-2.5', 'rounded-xl', 'text-center', 'font-medium', 'block')}>
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                className={clsx('w-full', 'py-3', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded-xl', 'font-bold', 'flex', 'items-center', 'justify-center', 'gap-1.5', 'shadow-md', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'text-[10px]')}
              >
                <Check size={14} />
                <span>
                  {selectedItemIds.length > 0
                    ? 'Receber Itens Selecionados'
                    : 'Lançar Pagamento / Baixa'}
                </span>
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
