
import { X } from 'lucide-react';
import type { CashierNotice } from '../cashierContracts';
import type { useCashierSupplierEditor } from './useCashierSupplierEditor';
type BoundaryProps = Pick<
  ReturnType<typeof useCashierSupplierEditor>,
  | 'showNewDistModal'
  | 'setShowNewDistModal'
  | 'distFormNomeFantasia'
  | 'handleSaveDistribuidor'
  | 'setDistFormNomeFantasia'
  | 'distFormRazaoSocial'
  | 'setDistFormRazaoSocial'
  | 'distFormCnpj'
  | 'setDistFormCnpj'
  | 'distFormLeadTime'
  | 'setDistFormLeadTime'
  | 'showEditDistModal'
  | 'selectedDist'
  | 'setShowEditDistModal'
> & {
  showToast: CashierNotice;
};

/** Supplier form views controlled by useCashierSupplierEditor. */
export function CashierSupplierDialogs({
  showNewDistModal,
  setShowNewDistModal,
  distFormNomeFantasia,
  handleSaveDistribuidor,
  setDistFormNomeFantasia,
  distFormRazaoSocial,
  setDistFormRazaoSocial,
  distFormCnpj,
  setDistFormCnpj,
  distFormLeadTime,
  setDistFormLeadTime,
  showEditDistModal,
  selectedDist,
  setShowEditDistModal,
  showToast,
}: BoundaryProps) {
  return (
    <>
      {showNewDistModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewDistModal(false);
          }}
          className={"fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"}
        >
          <div
            className={"w-full max-w-md bg-koma-card border border-koma-border rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8"}
          >
            <div
              className={"flex justify-between items-center pb-2 border-b border-koma-border"}
            >
              <h3 className={"font-serif text-sm font-bold text-koma-foreground"}>
                Cadastrar Novo Fornecedor
              </h3>
              <button
                type="button"
                onClick={() => setShowNewDistModal(false)}
                className={"p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!distFormNomeFantasia.trim()) {
                  alert('Preencha os campos obrigatórios!');
                  return;
                }
                await handleSaveDistribuidor(true);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Nome Fantasia:
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: Ambev"
                  value={distFormNomeFantasia}
                  onChange={(e) => setDistFormNomeFantasia(e.target.value)}
                  className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Razão Social:
                </label>
                <input
                  type="text"
                  placeholder="ex: Companhia de Bebidas das Américas"
                  value={distFormRazaoSocial}
                  onChange={(e) => setDistFormRazaoSocial(e.target.value)}
                  className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              <div className={"grid grid-cols-2 gap-4"}>
                <div className="space-y-1">
                  <label
                    className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                  >
                    CNPJ:
                  </label>
                  <input
                    type="text"
                    placeholder="00.000.000/0000-00"
                    value={distFormCnpj}
                    onChange={(e) => setDistFormCnpj(e.target.value)}
                    className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                  >
                    Lead Time (dias):
                  </label>
                  <input
                    type="number"
                    required
                    value={distFormLeadTime}
                    onChange={(e) => setDistFormLeadTime(Number(e.target.value))}
                    className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono"}
                  />
                </div>
              </div>

              <div className={"flex gap-2 pt-2"}>
                <button
                  type="button"
                  onClick={() => setShowNewDistModal(false)}
                  className={"flex-1 py-2 border border-koma-border hover:border-koma-border bg-zinc-955 text-koma-subtle hover:text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={"flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showEditDistModal && selectedDist && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEditDistModal(false);
          }}
          className={"fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"}
        >
          <div
            className={"w-full max-w-md bg-koma-card border border-koma-border rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8"}
          >
            <div
              className={"flex justify-between items-center pb-2 border-b border-koma-border"}
            >
              <h3 className={"font-serif text-sm font-bold text-koma-foreground"}>
                Editar Fornecedor: {selectedDist.nome_fantasia}
              </h3>
              <button
                type="button"
                onClick={() => setShowEditDistModal(false)}
                className={"p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!distFormNomeFantasia.trim()) {
                  showToast('Preencha o nome fantasia!', 'info');
                  return;
                }
                await handleSaveDistribuidor(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Nome Fantasia:
                </label>
                <input
                  type="text"
                  required
                  value={distFormNomeFantasia}
                  onChange={(e) => setDistFormNomeFantasia(e.target.value)}
                  className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Razão Social:
                </label>
                <input
                  type="text"
                  value={distFormRazaoSocial}
                  onChange={(e) => setDistFormRazaoSocial(e.target.value)}
                  className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              <div className={"grid grid-cols-2 gap-4"}>
                <div className="space-y-1">
                  <label
                    className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                  >
                    CNPJ:
                  </label>
                  <input
                    type="text"
                    value={distFormCnpj}
                    onChange={(e) => setDistFormCnpj(e.target.value)}
                    className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                  >
                    Lead Time (dias):
                  </label>
                  <input
                    type="number"
                    required
                    value={distFormLeadTime}
                    onChange={(e) => setDistFormLeadTime(Number(e.target.value))}
                    className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono"}
                  />
                </div>
              </div>

              <div className={"flex gap-2 pt-2"}>
                <button
                  type="button"
                  onClick={() => setShowEditDistModal(false)}
                  className={"flex-1 py-2 border border-koma-border hover:border-koma-border bg-zinc-950 text-koma-subtle hover:text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={"flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
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
