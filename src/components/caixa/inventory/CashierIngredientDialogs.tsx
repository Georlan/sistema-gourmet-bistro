
import { X } from 'lucide-react';
import MoneyInput from '../../MoneyInput';
import type { useCashierIngredientEditor } from './useCashierIngredientEditor';
type BoundaryProps = Pick<
  ReturnType<typeof useCashierIngredientEditor>,
  | 'showNewInsumoModal'
  | 'setShowNewInsumoModal'
  | 'insumoFormNome'
  | 'insumoFormUnidade'
  | 'handleSaveInsumo'
  | 'setInsumoFormNome'
  | 'setInsumoFormUnidade'
  | 'insumoFormMinimo'
  | 'setInsumoFormMinimo'
  | 'insumoFormMaximo'
  | 'setInsumoFormMaximo'
  | 'insumoFormCusto'
  | 'setInsumoFormCusto'
  | 'showEditInsumoModal'
  | 'selectedInsumo'
  | 'setShowEditInsumoModal'
>;

/** Ingredient form views controlled by useCashierIngredientEditor. */
export function CashierIngredientDialogs({
  showNewInsumoModal,
  setShowNewInsumoModal,
  insumoFormNome,
  insumoFormUnidade,
  handleSaveInsumo,
  setInsumoFormNome,
  setInsumoFormUnidade,
  insumoFormMinimo,
  setInsumoFormMinimo,
  insumoFormMaximo,
  setInsumoFormMaximo,
  insumoFormCusto,
  setInsumoFormCusto,
  showEditInsumoModal,
  selectedInsumo,
  setShowEditInsumoModal,
}: BoundaryProps) {
  return (
    <>
      {showNewInsumoModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewInsumoModal(false);
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
                Cadastrar Novo Ingrediente
              </h3>
              <button
                type="button"
                onClick={() => setShowNewInsumoModal(false)}
                className={"p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!insumoFormNome.trim() || !insumoFormUnidade.trim()) {
                  alert('Preencha os campos obrigatórios!');
                  return;
                }
                await handleSaveInsumo(true);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Nome do Ingrediente:
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: Contra Filé"
                  value={insumoFormNome}
                  onChange={(e) => setInsumoFormNome(e.target.value)}
                  className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              <div className={"grid grid-cols-3 gap-4"}>
                <div className="space-y-1">
                  <label
                    className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                  >
                    Unidade:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: kg, un, l"
                    value={insumoFormUnidade}
                    onChange={(e) => setInsumoFormUnidade(e.target.value)}
                    className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                  >
                    Mínimo:
                  </label>
                  <input
                    type="number"
                    required
                    value={insumoFormMinimo}
                    onChange={(e) => setInsumoFormMinimo(Number(e.target.value))}
                    className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono"}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                  >
                    Máximo:
                  </label>
                  <input
                    type="number"
                    required
                    value={insumoFormMaximo}
                    onChange={(e) => setInsumoFormMaximo(Number(e.target.value))}
                    className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono"}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Preço de Custo Médio (R$):
                </label>
                <MoneyInput
                  required
                  value={insumoFormCusto}
                  onValueChange={(value) => setInsumoFormCusto(Number(value || 0))}
                  className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"}
                />
              </div>

              <div className={"flex gap-2 pt-2"}>
                <button
                  type="button"
                  onClick={() => setShowNewInsumoModal(false)}
                  className={"flex-1 py-2 border border-koma-border hover:border-koma-border bg-koma-raised text-koma-subtle hover:text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={"flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-zinc-950 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
                >
                  Criar Ingrediente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showEditInsumoModal && selectedInsumo && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEditInsumoModal(false);
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
                Editar Ingrediente
              </h3>
              <button
                type="button"
                onClick={() => setShowEditInsumoModal(false)}
                className={"p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!insumoFormNome.trim() || !insumoFormUnidade.trim()) {
                  alert('Preencha os campos obrigatórios!');
                  return;
                }
                await handleSaveInsumo(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Nome do Ingrediente:
                </label>
                <input
                  type="text"
                  required
                  value={insumoFormNome}
                  onChange={(e) => setInsumoFormNome(e.target.value)}
                  className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              <div className={"grid grid-cols-3 gap-4"}>
                <div className="space-y-1">
                  <label
                    className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                  >
                    Unidade:
                  </label>
                  <input
                    type="text"
                    required
                    value={insumoFormUnidade}
                    onChange={(e) => setInsumoFormUnidade(e.target.value)}
                    className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                  >
                    Mínimo:
                  </label>
                  <input
                    type="number"
                    required
                    value={insumoFormMinimo}
                    onChange={(e) => setInsumoFormMinimo(Number(e.target.value))}
                    className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono"}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                  >
                    Máximo:
                  </label>
                  <input
                    type="number"
                    required
                    value={insumoFormMaximo}
                    onChange={(e) => setInsumoFormMaximo(Number(e.target.value))}
                    className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono"}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Preço de Custo Médio (R$):
                </label>
                <MoneyInput
                  required
                  value={insumoFormCusto}
                  onValueChange={(value) => setInsumoFormCusto(Number(value || 0))}
                  className={"w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"}
                />
              </div>

              <div className={"flex gap-2 pt-2"}>
                <button
                  type="button"
                  onClick={() => setShowEditInsumoModal(false)}
                  className={"flex-1 py-2 border border-koma-border hover:border-koma-border bg-koma-raised text-koma-subtle hover:text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={"flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-zinc-950 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
