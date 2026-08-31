
import React from 'react';
import type { useCashierOrders } from './useCashierOrders';

type BoundaryProps = Pick<
  ReturnType<typeof useCashierOrders>,
  | 'deliveryOrders'
  | 'selectedMotoboys'
  | 'setSelectedMotoboys'
  | 'motoboys'
  | 'handleDespacharKanban'
  | 'handleRevogarAcessoMotoboy'
  | 'handleFinalizarPedido'
  | 'handleAddMotoboy'
  | 'novoMotoboyNome'
  | 'novoMotoboyTelefone'
  | 'setNewMotoboyNome'
  | 'setNewMotoboyTelefone'
> & { activeSubTab: string };

/** Courier workspace; existing order controller owns data and access mutations. */
export function CashierCouriers({
  activeSubTab,
  deliveryOrders,
  selectedMotoboys,
  setSelectedMotoboys,
  motoboys,
  handleDespacharKanban,
  handleRevogarAcessoMotoboy,
  handleFinalizarPedido,
  handleAddMotoboy,
  novoMotoboyNome,
  novoMotoboyTelefone,
  setNewMotoboyNome,
  setNewMotoboyTelefone,
}: BoundaryProps) {
  return (
    <>
      {activeSubTab === 'entregadores' && (
        <div
          className={"grid grid-cols-1 lg:grid-cols-3 gap-5 animate-fade-in text-left"}
        >
          {/* Painel de Entregas (Colunas da Esquerda) */}
          <div
            className={"lg:col-span-2 bg-koma-card/60 border border-koma-border rounded-3xl p-5 space-y-5 flex flex-col overflow-hidden"}
          >
            <div className={"border-b border-koma-border pb-3 shrink-0"}>
              <span className={"font-serif font-bold text-koma-secondary block text-sm"}>
                Controle de Despacho e Entregas
              </span>
              <span className={"text-[9px] text-koma-muted block"}>
                Gerencie o fluxo de saída e entrega de pedidos de Delivery.
              </span>
            </div>

            {/* Pedidos Pendentes de Envio */}
            <div className={"space-y-3 flex-1 overflow-y-auto"}>
              <span
                className={"text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block"}
              >
                Pedidos para Despachar
              </span>

              {deliveryOrders.filter((o) => o.status === 'producao' || o.status === 'analise').length ===
              0 ? (
                <div
                  className={"py-8 text-center text-koma-muted text-xs italic bg-koma-panel/20 border border-koma-border/40 rounded-2xl"}
                >
                  Não há pedidos prontos ou em produção aguardando despacho no momento.
                </div>
              ) : (
                <div className="space-y-3">
                  {deliveryOrders
                    .filter((o) => o.status === 'producao' || o.status === 'analise')
                    .map((order) => {
                      const motoboyId = selectedMotoboys[order.id] || '';
                      return (
                        <div
                          key={order.id}
                          className={"p-4 bg-koma-panel border border-koma-border rounded-2xl flex flex-col sm:flex-row justify-between gap-3 text-xs"}
                        >
                          <div className={"space-y-1.5 flex-1"}>
                            <div className={"flex items-center gap-2"}>
                              <span className={"font-bold text-koma-foreground text-[11px]"}>
                                Pedido {order.id}
                              </span>
                              <span
                                className={"bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[8px] font-bold px-1.5 py-0.5 rounded border border-emerald-500/30 uppercase"}
                              >
                                {order.canal}
                              </span>
                            </div>
                            <span className={"text-koma-secondary font-bold block"}>
                              {order.cliente} • {order.telefone}
                            </span>
                            <span
                              className={"text-koma-subtle text-[10px] block leading-relaxed"}
                            >
                              {order.endereco}
                            </span>
                            <span className={"text-[9px] text-koma-muted block font-mono"}>
                              Itens: {order.itens}
                            </span>
                          </div>

                          <div
                            className={"flex flex-col sm:items-end justify-between gap-2 shrink-0"}
                          >
                            <span
                              className={"font-mono font-bold text-emerald-400 text-[11px]"}
                            >
                              R$ {order.total.toFixed(2)}
                            </span>

                            <div className={"flex items-center gap-2"}>
                              <select
                                value={motoboyId}
                                onChange={(e) =>
                                  setSelectedMotoboys((prev) => ({ ...prev, [order.id]: e.target.value }))
                                }
                                className={"py-1.5 px-2 bg-koma-card border border-koma-border text-koma-foreground rounded-xl text-[10px] focus:outline-none focus:border-[#10b981]"}
                              >
                                <option value="">Selecione o Entregador...</option>
                                {motoboys
                                  .filter((m) => m.ativo)
                                  .map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.nome}
                                    </option>
                                  ))}
                              </select>
                              <button
                                type="button"
                                disabled={!motoboyId}
                                onClick={() => handleDespacharKanban(order.id, motoboyId)}
                                className={"py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-colors cursor-pointer"}
                              >
                                Despachar
                              </button>
                              <button
                                type="button"
                                disabled={!motoboyId}
                                onClick={() => handleRevogarAcessoMotoboy(motoboyId)}
                                className={"py-1.5 px-2.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 disabled:opacity-40 text-rose-600 dark:text-rose-300 font-bold rounded-xl text-[10px] uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1"}
                                title="Revogar todos os links ativos do entregador selecionado"
                              >
                                Revogar
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Pedidos Em Trânsito */}
              <span
                className={"text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block pt-4"}
              >
                Em Trânsito (Entregas Ativas)
              </span>

              {deliveryOrders.filter((o) => o.status === 'pronto').length === 0 ? (
                <div
                  className={"py-8 text-center text-koma-muted text-xs italic bg-koma-panel/20 border border-koma-border/40 rounded-2xl"}
                >
                  Nenhum pedido em trânsito no momento.
                </div>
              ) : (
                <div className="space-y-3">
                  {deliveryOrders
                    .filter((o) => o.status === 'pronto')
                    .map((order) => {
                      return (
                        <div
                          key={order.id}
                          className={"p-4 bg-koma-panel/40 border border-koma-border/40 rounded-2xl flex flex-col sm:flex-row justify-between gap-3 text-xs"}
                        >
                          <div className={"space-y-1 flex-1"}>
                            <div className={"flex items-center gap-2"}>
                              <span className={"font-bold text-koma-foreground text-[11px]"}>
                                Pedido {order.id}
                              </span>
                              <span
                                className={"bg-emerald-500/10 text-emerald-400 text-[8px] font-bold px-1.5 py-0.5 rounded border border-emerald-500/20 uppercase tracking-wider"}
                              >
                                Em Trânsito
                              </span>
                            </div>
                            <span className={"text-koma-secondary font-bold block"}>
                              {order.cliente} • {order.telefone}
                            </span>
                            <span
                              className={"text-koma-subtle text-[10px] block leading-relaxed"}
                            >
                              {order.endereco}
                            </span>
                          </div>

                          <div
                            className={"flex flex-col sm:items-end justify-between gap-2 shrink-0"}
                          >
                            <span
                              className={"font-mono font-bold text-emerald-400 text-[11px]"}
                            >
                              R$ {order.total.toFixed(2)}
                            </span>

                            <button
                              type="button"
                              onClick={() => handleFinalizarPedido(order.id)}
                              className={"py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-colors cursor-pointer"}
                            >
                              Concluir Entrega
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Gerenciamento de Fretistas (Coluna da Direita) */}
          <div
            className={"bg-koma-card/60 border border-koma-border rounded-3xl p-5 space-y-4 flex flex-col justify-between overflow-hidden"}
          >
            <div className={"space-y-4 flex-1 flex flex-col overflow-hidden"}>
              <div className={"border-b border-koma-border pb-3 shrink-0"}>
                <span className={"font-serif font-bold text-koma-secondary block text-sm"}>
                  Fretistas Cadastrados
                </span>
                <span className={"text-[9px] text-koma-muted block"}>
                  Lista de motoboys e entregadores de plantão.
                </span>
              </div>

              <div className={"flex-1 overflow-y-auto space-y-2.5"}>
                {motoboys.length === 0 ? (
                  <span className={"text-xs text-koma-muted italic"}>
                    Nenhum fretista cadastrado.
                  </span>
                ) : (
                  motoboys.map((m) => (
                    <div
                      key={m.id}
                      className={"p-3 bg-koma-panel border border-koma-border rounded-xl flex items-center justify-between gap-2"}
                    >
                      <div className="text-xs">
                        <span className={"font-bold text-koma-foreground block"}>{m.nome}</span>
                        <span className={"text-[10px] text-koma-subtle block font-mono"}>
                          {m.telefone}
                        </span>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                          m.ativo
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}
                      >
                        {m.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Cadastro de novo Motoboy */}
            <form
              onSubmit={(e) => handleAddMotoboy(e, novoMotoboyNome, novoMotoboyTelefone)}
              className={"pt-4 border-t border-koma-border space-y-3 shrink-0"}
            >
              <span
                className={"text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block"}
              >
                Novo Fretista
              </span>

              <input
                type="text"
                required
                placeholder="Nome do Entregador"
                value={novoMotoboyNome}
                onChange={(e) => setNewMotoboyNome(e.target.value)}
                className={"w-full px-3 py-2 bg-koma-page border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-[#10b981]"}
              />
              <input
                type="text"
                required
                placeholder="Telefone (ex: 81 99999-8888)"
                value={novoMotoboyTelefone}
                onChange={(e) => setNewMotoboyTelefone(e.target.value)}
                className={"w-full px-3 py-2 bg-koma-page border border-koma-border rounded-xl text-koma-foreground text-xs font-mono focus:outline-none focus:border-[#10b981]"}
              />
              <button
                type="submit"
                className={"w-full py-2 bg-emerald-600 hover:bg-[#9d2b3c] text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-colors cursor-pointer"}
              >
                Adicionar Fretista
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
