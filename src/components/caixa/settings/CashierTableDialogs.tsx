
import { AlertTriangle, Check, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react';
import type { useCashierTableSettings } from './useCashierTableSettings';
type BoundaryProps = Pick<
  ReturnType<typeof useCashierTableSettings>,
  | 'handleDeleteMesa'
  | 'handleUpdateMesaSubmit'
  | 'showAddMesaModal'
  | 'tableMutation'
  | 'setShowAddMesaModal'
  | 'handleAddMesaSubmit'
  | 'newMesaId'
  | 'setNewMesaId'
  | 'setTableFormError'
  | 'newMesaCap'
  | 'setNewMesaCap'
  | 'newMesaNome'
  | 'setNewMesaNome'
  | 'tableFormError'
  | 'editingTable'
  | 'setEditingTable'
  | 'setIsConfirmingDelete'
  | 'editTableCap'
  | 'editTableNome'
  | 'editingTableRuntime'
  | 'isConfirmingDelete'
  | 'setEditTableNome'
  | 'setEditTableCap'
>;

/** Table dialogs controlled by the persistent table settings owner. */
export function CashierTableDialogs({
  handleDeleteMesa,
  handleUpdateMesaSubmit,
  showAddMesaModal,
  tableMutation,
  setShowAddMesaModal,
  handleAddMesaSubmit,
  newMesaId,
  setNewMesaId,
  setTableFormError,
  newMesaCap,
  setNewMesaCap,
  newMesaNome,
  setNewMesaNome,
  tableFormError,
  editingTable,
  setEditingTable,
  setIsConfirmingDelete,
  editTableCap,
  editTableNome,
  editingTableRuntime,
  isConfirmingDelete,
  setEditTableNome,
  setEditTableCap,
}: BoundaryProps) {
  return (
    <>
      {showAddMesaModal && (
        <div
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !tableMutation) setShowAddMesaModal(false);
          }}
          className={"fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"}
        >
          <form
            onSubmit={handleAddMesaSubmit}
            className={"w-full max-w-md overflow-hidden rounded-[24px] border border-[#2b312e] bg-koma-card shadow-2xl animate-scale-in"}
          >
            <div
              className={"flex items-start justify-between border-b border-[#2b312e] px-5 py-4 sm:px-6"}
            >
              <div className={"flex items-center gap-3"}>
                <span
                  className={"flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"}
                >
                  <Plus size={18} />
                </span>
                <div>
                  <span
                    className={"block font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400"}
                  >
                    Estrutura do salão
                  </span>
                  <h3 className={"mt-0.5 text-lg font-bold text-koma-foreground"}>
                    Adicionar mesa
                  </h3>
                  <p className={"mt-0.5 text-[10px] text-koma-muted"}>
                    Ela ficará disponível no caixa e no app do garçom.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={tableMutation !== null}
                onClick={() => setShowAddMesaModal(false)}
                aria-label="Fechar"
                className={"rounded-lg p-2 text-koma-muted transition-colors hover:bg-white/[0.05] hover:text-koma-foreground disabled:opacity-40"}
              >
                <X size={16} />
              </button>
            </div>

            <div className={"space-y-4 px-5 py-5 sm:px-6"}>
              <div className={"grid grid-cols-2 gap-3"}>
                <label className="space-y-1.5">
                  <span
                    className={"block text-[9px] font-bold uppercase tracking-wider text-koma-subtle"}
                  >
                    Número da mesa
                  </span>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Ex: 31"
                    value={newMesaId}
                    onChange={(e) => {
                      setNewMesaId(e.target.value);
                      setTableFormError('');
                    }}
                    className={"w-full rounded-xl border border-[#303633] bg-koma-panel px-3 py-3 font-mono text-sm text-koma-foreground outline-none transition-colors placeholder:text-zinc-700 focus:border-[#10b981]/60"}
                  />
                </label>
                <label className="space-y-1.5">
                  <span
                    className={"block text-[9px] font-bold uppercase tracking-wider text-koma-subtle"}
                  >
                    Lugares
                  </span>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Ex: 4"
                    value={newMesaCap}
                    onChange={(e) => {
                      setNewMesaCap(e.target.value);
                      setTableFormError('');
                    }}
                    className={"w-full rounded-xl border border-[#303633] bg-koma-panel px-3 py-3 font-mono text-sm text-koma-foreground outline-none transition-colors placeholder:text-zinc-700 focus:border-[#10b981]/60"}
                  />
                </label>
              </div>

              <label className={"block space-y-1.5"}>
                <span
                  className={"block text-[9px] font-bold uppercase tracking-wider text-koma-subtle"}
                >
                  Nome de referência{' '}
                  <span className={"normal-case text-koma-muted"}>(opcional)</span>
                </span>
                <input
                  type="text"
                  maxLength={80}
                  placeholder="Ex.: Varanda, Deck ou Mesa VIP"
                  value={newMesaNome}
                  onChange={(e) => {
                    setNewMesaNome(e.target.value);
                    setTableFormError('');
                  }}
                  className={"w-full rounded-xl border border-[#303633] bg-koma-panel px-3 py-3 text-sm text-koma-foreground outline-none transition-colors placeholder:text-zinc-700 focus:border-[#10b981]/60"}
                />
              </label>

              {tableFormError && (
                <div
                  role="alert"
                  className={"flex gap-2 rounded-xl border border-rose-900/40 bg-rose-950/20 p-3 text-[11px] leading-relaxed text-rose-600 dark:text-rose-300"}
                >
                  <AlertTriangle className={"mt-0.5 shrink-0"} size={14} />
                  {tableFormError}
                </div>
              )}

              <div className={"flex flex-col-reverse gap-2 pt-1 sm:flex-row"}>
                <button
                  type="button"
                  disabled={tableMutation !== null}
                  onClick={() => setShowAddMesaModal(false)}
                  className={"min-h-11 flex-1 rounded-xl border border-[#303633] bg-koma-panel px-4 text-xs font-bold text-koma-subtle transition-colors hover:text-koma-foreground disabled:opacity-40"}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={tableMutation !== null}
                  className={"flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#10b981] px-4 text-xs font-extrabold text-[#07110e] transition-colors hover:bg-[#35c99a] disabled:cursor-wait disabled:opacity-60"}
                >
                  {tableMutation === 'create' ? (
                    <RefreshCw className="animate-spin" size={14} />
                  ) : (
                    <Check size={14} />
                  )}
                  {tableMutation === 'create' ? 'Adicionando…' : 'Adicionar mesa'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
      {editingTable && (
        <div
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !tableMutation) {
              setEditingTable(null);
              setIsConfirmingDelete(false);
            }
          }}
          className={"fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"}
        >
          <form
            onSubmit={handleUpdateMesaSubmit}
            className={"w-full max-w-md overflow-hidden rounded-[24px] border border-[#2b312e] bg-koma-card shadow-2xl animate-scale-in"}
          >
            <div
              className={"flex items-start justify-between border-b border-[#2b312e] px-5 py-4 sm:px-6"}
            >
              <div className={"flex items-center gap-3"}>
                <span
                  className={"flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 font-mono text-base font-extrabold text-emerald-800 dark:text-emerald-300"}
                >
                  {editingTable.id}
                </span>
                <div>
                  <span
                    className={"block font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400"}
                  >
                    Configuração da mesa
                  </span>
                  <h3 className={"mt-0.5 text-lg font-bold text-koma-foreground"}>
                    Editar Mesa {editingTable.id}
                  </h3>
                  <p className={"mt-0.5 text-[10px] text-koma-muted"}>
                    {editingTableRuntime?.isOccupied ? 'Em atendimento agora' : 'Livre e disponível no salão'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={tableMutation !== null}
                onClick={() => {
                  setEditingTable(null);
                  setIsConfirmingDelete(false);
                }}
                aria-label="Fechar"
                className={"rounded-lg p-2 text-koma-muted transition-colors hover:bg-white/[0.05] hover:text-koma-foreground disabled:opacity-40"}
              >
                <X size={16} />
              </button>
            </div>

            <div className={"space-y-4 px-5 py-5 sm:px-6"}>
              {isConfirmingDelete ? (
                <div
                  className={"space-y-4 rounded-2xl border border-rose-900/40 bg-rose-950/20 p-4 text-center"}
                >
                  <span
                    className={"mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/10 text-rose-400"}
                  >
                    <Trash2 size={17} />
                  </span>
                  <div>
                    <strong className={"block text-sm text-koma-foreground"}>
                      Remover Mesa {editingTable.id}?
                    </strong>
                    <p className={"mt-1 text-[11px] leading-relaxed text-koma-subtle"}>
                      Ela sairá do salão em todos os dispositivos. O histórico de pedidos será preservado.
                    </p>
                  </div>
                  <div className={"flex gap-2"}>
                    <button
                      type="button"
                      onClick={() => setIsConfirmingDelete(false)}
                      disabled={tableMutation !== null}
                      className={"min-h-10 flex-1 rounded-xl border border-[#303633] bg-koma-panel text-xs font-bold text-koma-subtle transition-colors hover:text-koma-foreground disabled:opacity-40"}
                    >
                      Manter mesa
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteMesa}
                      disabled={tableMutation !== null}
                      className={"flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 text-xs font-bold text-koma-foreground transition-colors hover:bg-rose-500 disabled:cursor-wait disabled:opacity-60"}
                    >
                      {tableMutation === 'delete' && <RefreshCw className="animate-spin" size={13} />}
                      {tableMutation === 'delete' ? 'Removendo…' : 'Remover'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={"space-y-4 text-left"}>
                    <label className={"block space-y-1.5"}>
                      <span
                        className={"block text-[9px] font-bold uppercase tracking-wider text-koma-subtle"}
                      >
                        Nome de referência
                      </span>
                      <input
                        type="text"
                        maxLength={80}
                        placeholder={`Mesa ${editingTable.id}`}
                        value={editTableNome}
                        onChange={(e) => {
                          setEditTableNome(e.target.value);
                          setTableFormError('');
                        }}
                        className={"w-full rounded-xl border border-[#303633] bg-koma-panel px-3 py-3 text-sm text-koma-foreground outline-none transition-colors placeholder:text-zinc-700 focus:border-[#10b981]/60"}
                      />
                      <span className={"block text-[9px] text-koma-muted"}>
                        Use um nome simples, como “Varanda” ou “Deck”.
                      </span>
                    </label>

                    <label className={"block space-y-1.5"}>
                      <span
                        className={"block text-[9px] font-bold uppercase tracking-wider text-koma-subtle"}
                      >
                        Capacidade
                      </span>
                      <div className="relative">
                        <Users
                          className={"absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted"}
                          size={14}
                        />
                        <input
                          type="number"
                          min="1"
                          required
                          placeholder="Ex: 4"
                          value={editTableCap}
                          onChange={(e) => {
                            setEditTableCap(e.target.value);
                            setTableFormError('');
                          }}
                          className={"w-full rounded-xl border border-[#303633] bg-koma-panel py-3 pl-9 pr-3 font-mono text-sm text-koma-foreground outline-none transition-colors placeholder:text-zinc-700 focus:border-[#10b981]/60"}
                        />
                      </div>
                    </label>
                  </div>

                  {tableFormError && (
                    <div
                      role="alert"
                      className={"flex gap-2 rounded-xl border border-rose-900/40 bg-rose-950/20 p-3 text-[11px] leading-relaxed text-rose-600 dark:text-rose-300"}
                    >
                      <AlertTriangle className={"mt-0.5 shrink-0"} size={14} />
                      {tableFormError}
                    </div>
                  )}

                  <div className={"space-y-3 pt-1"}>
                    <div className={"flex flex-col-reverse gap-2 sm:flex-row"}>
                      <button
                        type="button"
                        onClick={() => setEditingTable(null)}
                        disabled={tableMutation !== null}
                        className={"min-h-11 flex-1 rounded-xl border border-[#303633] bg-koma-panel px-4 text-xs font-bold text-koma-subtle transition-colors hover:text-koma-foreground disabled:opacity-40"}
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={tableMutation !== null}
                        className={"flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#10b981] px-4 text-xs font-extrabold text-[#07110e] transition-colors hover:bg-[#35c99a] disabled:cursor-wait disabled:opacity-60"}
                      >
                        {tableMutation === 'update' ? (
                          <RefreshCw className="animate-spin" size={14} />
                        ) : (
                          <Check size={14} />
                        )}
                        {tableMutation === 'update' ? 'Salvando…' : 'Salvar alterações'}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsConfirmingDelete(true)}
                      disabled={Boolean(editingTableRuntime?.isOccupied) || tableMutation !== null}
                      className={"flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-rose-900/30 bg-rose-950/10 px-3 text-[10px] font-bold text-rose-400 transition-colors hover:bg-rose-950/25 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-transparent disabled:text-zinc-600"}
                    >
                      <Trash2 size={12} />
                      {editingTableRuntime?.isOccupied
                        ? 'Finalize o atendimento para remover'
                        : 'Remover mesa do salão'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  );
}
