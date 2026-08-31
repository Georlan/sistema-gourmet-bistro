import clsx from 'clsx';
import { X } from 'lucide-react';
import type { useCashierIngredientEditor } from './useCashierIngredientEditor';
type BoundaryProps = Pick<
  ReturnType<typeof useCashierIngredientEditor>,
  | 'showAjusteInsumoModal'
  | 'selectedInsumo'
  | 'setShowAjusteInsumoModal'
  | 'ajusteQtd'
  | 'handleAjustarEstoque'
  | 'setAjusteTipo'
  | 'ajusteTipo'
  | 'setAjusteQtd'
  | 'ajusteJustificativa'
  | 'setAjusteJustificativa'
>;

/** Stock adjustment view; mutation and draft remain in the ingredient editor. */
export function CashierStockAdjustmentDialog({
  showAjusteInsumoModal,
  selectedInsumo,
  setShowAjusteInsumoModal,
  ajusteQtd,
  handleAjustarEstoque,
  setAjusteTipo,
  ajusteTipo,
  setAjusteQtd,
  ajusteJustificativa,
  setAjusteJustificativa,
}: BoundaryProps) {
  return (
    <>
      {showAjusteInsumoModal && selectedInsumo && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAjusteInsumoModal(false);
          }}
          className={"fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"}
        >
          <div
            className={"w-full max-w-md bg-koma-dialog border border-koma-border rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8"}
          >
            <div
              className={"flex justify-between items-center pb-2 border-b border-koma-border"}
            >
              <h3 className={"font-serif text-sm font-bold text-koma-foreground"}>
                Ajustar Estoque: {selectedInsumo.nome}
              </h3>
              <button
                type="button"
                onClick={() => setShowAjusteInsumoModal(false)}
                className={"p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (ajusteQtd <= 0) {
                  alert('A quantidade do ajuste deve ser maior que zero!');
                  return;
                }
                await handleAjustarEstoque();
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Tipo de Ajuste:
                </label>
                <div className={"grid grid-cols-2 gap-2"}>
                  <button
                    type="button"
                    onClick={() => setAjusteTipo('ENTRADA')}
                    className={clsx(
                      'py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer',
                      ajusteTipo === 'ENTRADA'
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 font-bold'
                        : 'bg-koma-raised border-koma-border text-koma-subtle hover:text-koma-foreground font-bold',
                    )}
                  >
                    Entrada (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAjusteTipo('SAIDA')}
                    className={clsx(
                      'py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer',
                      ajusteTipo === 'SAIDA'
                        ? 'bg-red-500/10 border-red-500/60 text-red-400 font-bold'
                        : 'bg-koma-raised border-koma-border text-koma-subtle hover:text-koma-foreground font-bold',
                    )}
                  >
                    Saída (-)
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Quantidade ({selectedInsumo.unidade_medida}):
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={ajusteQtd}
                  onChange={(e) => setAjusteQtd(Number(e.target.value))}
                  className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"}
                />
              </div>

              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Justificativa:
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: Ajuste de inventário / Perda por validade"
                  value={ajusteJustificativa}
                  onChange={(e) => setAjusteJustificativa(e.target.value)}
                  className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              <div className={"flex gap-2 pt-2"}>
                <button
                  type="button"
                  onClick={() => setShowAjusteInsumoModal(false)}
                  className={"flex-1 py-2 border border-koma-border hover:border-koma-border bg-koma-raised text-koma-subtle hover:text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={"flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-zinc-950 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
                >
                  Confirmar Ajuste
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
