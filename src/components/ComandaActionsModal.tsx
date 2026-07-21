import React, { useState } from 'react';
import { Order } from '../types';

export interface ComandaActionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  comanda: Order | null;
  onPrintKitchen: (comandaId: string) => Promise<void>;
  onPrintBill: (comandaId: string) => Promise<void>;
  onFinalizeOrder: (comandaId: string, totalFinal: number, metodoPagamento: string) => Promise<void>;
}

export const ComandaActionsModal: React.FC<ComandaActionsModalProps> = ({
  isOpen,
  onClose,
  comanda,
  onPrintKitchen,
  onPrintBill,
  onFinalizeOrder,
}) => {
  if (!isOpen || !comanda) return null;

  const [descontoStr, setDescontoStr] = useState<string>('0');
  const [pessoasStr, setPessoasStr] = useState<string>('1');
  const [metodoPagamento, setMetodoPagamento] = useState<'pix' | 'dinheiro' | 'cartao'>('pix');

  const [loadingKitchen, setLoadingKitchen] = useState(false);
  const [loadingBill, setLoadingBill] = useState(false);
  const [loadingFinalize, setLoadingFinalize] = useState(false);

  const totalBase = comanda.itens ? comanda.itens.reduce((sum, item) => sum + (item.preco || 0), 0) : 0;
  const desconto = parseFloat(descontoStr) || 0;
  const totalFinal = Math.max(0, totalBase - desconto);
  const pessoas = Math.max(1, parseInt(pessoasStr, 10) || 1);
  const valorPorPessoa = totalFinal / pessoas;

  const handlePrintKitchen = async () => {
    if (loadingKitchen) return;
    setLoadingKitchen(true);
    try {
      await onPrintKitchen(comanda.id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingKitchen(false);
    }
  };

  const handlePrintBill = async () => {
    if (loadingBill) return;
    setLoadingBill(true);
    try {
      await onPrintBill(comanda.id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingBill(false);
    }
  };

  const handleFinalize = async () => {
    if (loadingFinalize) return;
    setLoadingFinalize(true);
    try {
      await onFinalizeOrder(comanda.id, totalFinal, metodoPagamento);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingFinalize(false);
    }
  };

  const isAnyLoading = loadingKitchen || loadingBill || loadingFinalize;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isAnyLoading) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4 animate-fade-in cursor-pointer"
    >
      <div className="w-full max-w-lg bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-5 text-left shadow-2xl relative animate-scale-in cursor-default my-auto max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center pb-3 border-b border-[#27272A]">
          <div>
            <h3 className="font-serif text-lg font-bold text-white tracking-tight">
              Ações Rápidas — Comanda {comanda.mesaId ? `Mesa ${comanda.mesaId}` : `#${comanda.id.slice(-4)}`}
            </h3>
            <span className="text-[10px] text-gray-400 font-mono block mt-0.5">
              Cliente: {comanda.identificador || 'Consumo Geral'} • {comanda.itens?.length || 0} item(ns)
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isAnyLoading}
            className="p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-[#27272A] transition-colors cursor-pointer disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Simulador de Desconto e Calculadora de Rateio */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-300 uppercase tracking-wider block">
              Desconto R$:
            </label>
            <input
              type="number"
              min="0"
              step="0.50"
              value={descontoStr}
              onChange={(e) => setDescontoStr(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2.5 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-300 uppercase tracking-wider block">
              Dividir Conta (Pessoas):
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={pessoasStr}
              onChange={(e) => setPessoasStr(e.target.value)}
              placeholder="1"
              className="w-full px-3 py-2.5 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Resumo de Calculo em Tempo Real */}
        <div className="bg-[#1C1C1F] p-4 rounded-2xl border border-[#27272A] space-y-2">
          <div className="flex justify-between text-xs text-gray-400">
            <span>Subtotal Consumido:</span>
            <span className="font-mono text-gray-300">R$ {totalBase.toFixed(2)}</span>
          </div>

          {desconto > 0 && (
            <div className="flex justify-between text-xs text-emerald-400 font-medium">
              <span>Desconto Aplicado:</span>
              <span className="font-mono">- R$ {desconto.toFixed(2)}</span>
            </div>
          )}

          <div className="flex justify-between text-sm font-bold text-white border-t border-[#27272A] pt-2">
            <span>Total Final:</span>
            <span className="font-mono text-emerald-400 text-base">R$ {totalFinal.toFixed(2)}</span>
          </div>

          {pessoas > 1 && (
            <div className="flex justify-between text-xs text-indigo-300 font-medium pt-1 border-t border-[#27272A]/50">
              <span>Por Pessoa ({pessoas}x):</span>
              <span className="font-mono font-bold text-indigo-200">R$ {valorPorPessoa.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Métodos de Recebimento */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-gray-300 uppercase tracking-wider block">
            Método de Pagamento:
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['pix', 'dinheiro', 'cartao'] as const).map((method) => {
              const selected = metodoPagamento === method;
              const label = method === 'pix' ? 'PIX' : method === 'dinheiro' ? 'Dinheiro' : 'Cartão';
              return (
                <button
                  key={method}
                  type="button"
                  onClick={() => setMetodoPagamento(method)}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                    selected
                      ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
                      : 'bg-[#1C1C1F] border-[#27272A] text-gray-400 hover:text-white hover:border-gray-600'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Ações de Impressão e Finalização */}
        <div className="space-y-2 pt-2 border-t border-[#27272A]">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isAnyLoading}
              onClick={handlePrintKitchen}
              className="py-3 px-3 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-gray-200 hover:text-white rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loadingKitchen ? (
                <svg className="animate-spin h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H7a2 2 0 00-2 2v4h10z" />
                </svg>
              )}
              Imprimir Cozinha
            </button>

            <button
              type="button"
              disabled={isAnyLoading}
              onClick={handlePrintBill}
              className="py-3 px-3 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-gray-200 hover:text-white rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loadingBill ? (
                <svg className="animate-spin h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              Cupom Pré-Conta
            </button>
          </div>

          <button
            type="button"
            disabled={isAnyLoading}
            onClick={handleFinalize}
            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-[#121214] font-bold text-sm rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 disabled:opacity-50"
          >
            {loadingFinalize ? (
              <svg className="animate-spin h-5 w-5 text-[#121214]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            Finalizar & Baixar Conta (R$ {totalFinal.toFixed(2)})
          </button>
        </div>
      </div>
    </div>
  );
};
