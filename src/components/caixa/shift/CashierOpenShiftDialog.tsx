
import { X } from 'lucide-react';
import React from 'react';
import MoneyInput from '../../MoneyInput';
import type { useCashShift } from './useCashShift';

type BoundaryProps = Pick<
  ReturnType<typeof useCashShift>,
  'showAbrirModal' | 'setShowAbrirModal' | 'handleAbrirCaixa' | 'saldoInicial' | 'setSaldoInicial'
> & { errorMsg: string };

/** Open-shift view controlled by the persistent cash-shift owner. */
export function CashierOpenShiftDialog({
  showAbrirModal,
  setShowAbrirModal,
  handleAbrirCaixa,
  saldoInicial,
  setSaldoInicial,
  errorMsg,
}: BoundaryProps) {
  return (
    <>
      {showAbrirModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAbrirModal(false);
          }}
          className={"fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 cursor-pointer"}
        >
          <form
            onSubmit={handleAbrirCaixa}
            className={"bg-koma-panel border border-koma-border rounded-3xl w-full max-w-sm p-6 space-y-5 shadow-2xl animate-scale-in"}
          >
            <div
              className={"flex justify-between items-center border-b border-koma-border pb-3"}
            >
              <h3 className={"font-serif font-bold text-lg text-koma-foreground"}>
                Abertura de Caixa
              </h3>
              <button
                type="button"
                onClick={() => setShowAbrirModal(false)}
                className={"p-1 hover:bg-koma-raised rounded-full text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"}
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-1.5">
              <label
                className={"text-[10px] font-bold text-koma-secondary uppercase tracking-wider block"}
              >
                Fundo de Troco Inicial (R$):
              </label>
              <div className="relative">
                <span className={"absolute left-3.5 top-3 text-koma-subtle font-mono"}>
                  R$
                </span>
                <MoneyInput
                  required
                  value={saldoInicial}
                  onValueChange={setSaldoInicial}
                  className={"w-full pl-9 pr-4 py-2.5 bg-koma-card border border-koma-border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#10b981]/20 focus:border-[#10b981] text-koma-foreground font-mono"}
                />
              </div>
            </div>

            {errorMsg && (
              <div
                className={"bg-rose-500/10 border border-rose-500/25 text-rose-400 p-2.5 rounded-xl text-center font-medium block"}
              >
                {errorMsg}
              </div>
            )}

            <div className={"flex gap-2.5"}>
              <button
                type="button"
                onClick={() => setShowAbrirModal(false)}
                className={"flex-1 py-2.5 bg-koma-card hover:bg-koma-raised border border-koma-border text-koma-foreground rounded-xl transition-all cursor-pointer font-bold"}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={"flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-all cursor-pointer font-bold shadow-md"}
              >
                Confirmar Abertura
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
