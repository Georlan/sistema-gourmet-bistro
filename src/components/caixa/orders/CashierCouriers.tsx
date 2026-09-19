
import React, { useMemo } from 'react';
import { bucketCourierDeliveryOrders } from './deliveryOrderProjection';
import type { useCashierOrders } from './useCashierOrders';

type BoundaryProps = Pick<
  ReturnType<typeof useCashierOrders>,
  | 'deliveryOrders'
  | 'selectedMotoboys'
  | 'setSelectedMotoboys'
  | 'motoboys'
  | 'motoboysLoadState'
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
  motoboysLoadState,
  handleDespacharKanban,
  handleRevogarAcessoMotoboy,
  handleFinalizarPedido,
  handleAddMotoboy,
  novoMotoboyNome,
  novoMotoboyTelefone,
  setNewMotoboyNome,
  setNewMotoboyTelefone,
}: BoundaryProps) {
  const courierBuckets = useMemo(
    () => bucketCourierDeliveryOrders(deliveryOrders),
    [deliveryOrders],
  );
  const courierName = (motoboyId?: number | null) => {
    if (!motoboyId) return null;
    return motoboys.find((motoboy) => Number(motoboy.id) === Number(motoboyId))?.nome || null;
  };

  return (
    <>
      {activeSubTab === 'entregadores' && (
        <div className={"grid grid-cols-1 lg:grid-cols-3 gap-5 animate-fade-in text-left"}>
          <div className={"lg:col-span-2 bg-koma-card/60 border border-koma-border rounded-3xl p-5 space-y-5 flex flex-col overflow-hidden"}>
            <div className={"border-b border-koma-border pb-3 shrink-0 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2"}>
              <div>
                <span className={"font-serif font-bold text-koma-secondary block text-sm"}>
                  Controle de Despacho e Entregas
                </span>
                <span className={"text-[9px] text-koma-muted block"}>
                  Somente pedidos de delivery. Retiradas permanecem no fluxo de balcão.
                </span>
              </div>
              <div className={"flex gap-2 text-[9px] font-mono"}>
                <span className={"px-2 py-1 rounded-lg border border-koma-border bg-koma-panel text-koma-subtle"}>
                  {courierBuckets.preparing.length} preparando
                </span>
                <span className={"px-2 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-500"}>
                  {courierBuckets.ready.length} prontos
                </span>
                <span className={"px-2 py-1 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400"}>
                  {courierBuckets.inTransit.length} em rota
                </span>
              </div>
            </div>

            <div className={"space-y-5 flex-1 overflow-y-auto"}>
              <section className="space-y-3">
                <span className={"text-[10px] font-bold text-koma-muted uppercase tracking-wider block"}>
                  Aguardando preparo
                </span>

                {courierBuckets.preparing.length === 0 ? (
                  <div className={"py-5 text-center text-koma-muted text-xs italic bg-koma-panel/20 border border-koma-border/40 rounded-2xl"}>
                    Nenhuma entrega aguardando a cozinha.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {courierBuckets.preparing.map((order) => (
                      <div key={order.id} className={"p-3.5 bg-koma-panel/50 border border-l-4 border-koma-border/60 border-l-violet-500/70 rounded-2xl flex flex-col sm:flex-row justify-between gap-3 text-xs"}>
                        <div className={"space-y-1 flex-1 min-w-0"}>
                          <div className={"flex items-center gap-2 flex-wrap"}>
                            <span className={"font-bold text-koma-foreground text-[11px]"}>Pedido {order.numeroPedido ? `#${order.numeroPedido}` : order.id}</span>
                            <span className={"bg-koma-card text-koma-subtle text-[8px] font-bold px-1.5 py-0.5 rounded border border-koma-border uppercase"}>
                              {order.canal}
                            </span>
                            <span className={"text-[8px] font-bold uppercase tracking-wider text-amber-500"}>
                              {order.status === 'analise' || order.status === 'pendente' ? 'Aguardando aceite' : 'Em preparo'}
                            </span>
                          </div>
                          <span className={"text-koma-secondary font-bold block"}>{order.cliente} • {order.telefone}</span>
                          <span className={"text-koma-subtle text-[10px] block leading-relaxed break-words"}>{order.endereco || 'Endereço não informado'}</span>
                          {order.motoboyId && (
                            <span className={"text-[10px] text-emerald-600 dark:text-emerald-300 block"}>
                              Entregador pré-atribuído: {courierName(order.motoboyId) || `#${order.motoboyId}`}
                            </span>
                          )}
                          <span className={"text-[9px] text-koma-muted block font-mono truncate"}>Itens: {order.itens}</span>
                        </div>
                        <div className={"flex sm:flex-col sm:items-end justify-between gap-2 shrink-0"}>
                          <span className={"font-mono font-bold text-emerald-400 text-[11px]"}>R$ {order.total.toFixed(2)}</span>
                          <span className={"text-[9px] text-koma-muted"}>Despacho libera quando ficar pronto</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <span className={"text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block"}>
                  Prontos para sair
                </span>

                {courierBuckets.ready.length === 0 ? (
                  <div className={"py-5 text-center text-koma-muted text-xs italic bg-koma-panel/20 border border-koma-border/40 rounded-2xl"}>
                    Nenhuma entrega pronta aguardando entregador.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {courierBuckets.ready.map((order) => {
                      const motoboyId = selectedMotoboys[order.id] || '';
                      return (
                        <div key={order.id} className={"p-4 bg-koma-panel border border-l-4 border-emerald-500/20 border-l-violet-500/70 rounded-2xl flex flex-col sm:flex-row justify-between gap-3 text-xs"}>
                          <div className={"space-y-1.5 flex-1 min-w-0"}>
                            <div className={"flex items-center gap-2 flex-wrap"}>
                              <span className={"font-bold text-koma-foreground text-[11px]"}>Pedido {order.numeroPedido ? `#${order.numeroPedido}` : order.id}</span>
                              <span className={"bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[8px] font-bold px-1.5 py-0.5 rounded border border-emerald-500/30 uppercase"}>
                                {order.canal}
                              </span>
                              <span className={"text-[8px] font-bold uppercase tracking-wider text-emerald-400"}>Pronto</span>
                            </div>
                            <span className={"text-koma-secondary font-bold block"}>{order.cliente} • {order.telefone}</span>
                            <span className={"text-koma-subtle text-[10px] block leading-relaxed break-words"}>{order.endereco || 'Endereço não informado'}</span>
                            <span className={"text-[9px] text-koma-muted block font-mono truncate"}>Itens: {order.itens}</span>
                          </div>

                          <div className={"flex flex-col sm:items-end justify-between gap-2 shrink-0"}>
                            <span className={"font-mono font-bold text-emerald-400 text-[11px]"}>R$ {order.total.toFixed(2)}</span>
                            <div className={"flex items-center gap-2"}>
                              <select
                                value={motoboyId}
                                disabled={motoboysLoadState !== 'loaded'}
                                onChange={(e) => setSelectedMotoboys((prev) => ({ ...prev, [order.id]: e.target.value }))}
                                className={"py-1.5 px-2 bg-koma-card border border-koma-border text-koma-foreground rounded-xl text-[10px] focus:outline-none focus:border-[#10b981] disabled:opacity-60"}
                              >
                                <option value="">
                                  {motoboysLoadState === 'loaded' ? 'Selecione o entregador...' : 'Sincronizando entregadores...'}
                                </option>
                                {motoboys.filter((m) => m.ativo).map((m) => (
                                  <option key={m.id} value={m.id}>{m.nome}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={!motoboyId || motoboysLoadState !== 'loaded'}
                                onClick={() => handleDespacharKanban(order.id, motoboyId)}
                                className={"py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-colors cursor-pointer"}
                              >
                                Saiu para entrega
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <span className={"text-[10px] font-bold text-sky-500 uppercase tracking-wider block"}>
                  Em rota
                </span>

                {courierBuckets.inTransit.length === 0 ? (
                  <div className={"py-5 text-center text-koma-muted text-xs italic bg-koma-panel/20 border border-koma-border/40 rounded-2xl"}>
                    Nenhum pedido em rota no momento.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {courierBuckets.inTransit.map((order) => (
                      <div key={order.id} className={"p-4 bg-koma-panel/40 border border-sky-500/20 rounded-2xl flex flex-col sm:flex-row justify-between gap-3 text-xs"}>
                        <div className={"space-y-1 flex-1 min-w-0"}>
                          <div className={"flex items-center gap-2 flex-wrap"}>
                            <span className={"font-bold text-koma-foreground text-[11px]"}>Pedido {order.numeroPedido ? `#${order.numeroPedido}` : order.id}</span>
                            <span className={"bg-sky-500/10 text-sky-400 text-[8px] font-bold px-1.5 py-0.5 rounded border border-sky-500/20 uppercase tracking-wider"}>Em rota</span>
                          </div>
                          <span className={"text-koma-secondary font-bold block"}>{order.cliente} • {order.telefone}</span>
                          <span className={"text-koma-subtle text-[10px] block leading-relaxed break-words"}>{order.endereco || 'Endereço não informado'}</span>
                          <span className={"text-[10px] text-sky-400 block"}>
                            Entregador: {courierName(order.motoboyId) || (order.motoboyId ? `#${order.motoboyId}` : 'não identificado')}
                          </span>
                        </div>
                        <div className={"flex flex-col sm:items-end justify-between gap-2 shrink-0"}>
                          <span className={"font-mono font-bold text-emerald-400 text-[11px]"}>R$ {order.total.toFixed(2)}</span>
                          <button type="button" onClick={() => handleFinalizarPedido(order.id)} className={"py-1.5 px-3 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-colors cursor-pointer"}>
                            Marcar entregue
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>

          <div className={"bg-koma-card/60 border border-koma-border rounded-3xl p-5 space-y-4 flex flex-col justify-between overflow-hidden"}>
            <div className={"space-y-4 flex-1 flex flex-col overflow-hidden"}>
              <div className={"border-b border-koma-border pb-3 shrink-0"}>
                <span className={"font-serif font-bold text-koma-secondary block text-sm"}>Entregadores</span>
                <span className={"text-[9px] text-koma-muted block"}>Equipe disponível para despacho próprio do restaurante.</span>
              </div>

              <div className={"flex-1 overflow-y-auto space-y-2.5"}>
                {motoboysLoadState === 'loading' ? (
                  <span className={"text-xs text-koma-muted italic"}>Sincronizando entregadores...</span>
                ) : motoboysLoadState === 'error' ? (
                  <span className={"text-xs text-amber-600 dark:text-amber-300 italic"}>
                    Não foi possível confirmar a lista de entregadores.
                  </span>
                ) : motoboys.length === 0 ? (
                  <span className={"text-xs text-koma-muted italic"}>Nenhum entregador cadastrado.</span>
                ) : (
                  motoboys.map((m) => (
                    <div key={m.id} className={"p-3 bg-koma-panel border border-koma-border rounded-xl flex items-center justify-between gap-2"}>
                      <div className="text-xs min-w-0">
                        <span className={"font-bold text-koma-foreground block truncate"}>{m.nome}</span>
                        <span className={"text-[10px] text-koma-subtle block font-mono"}>{m.telefone}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${m.ativo ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                          {m.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                        {m.ativo && (
                          <button
                            type="button"
                            onClick={() => handleRevogarAcessoMotoboy(String(m.id))}
                            className={"px-2 py-1 rounded-lg border border-rose-500/30 text-[8px] font-bold uppercase text-rose-400 hover:bg-rose-500/10"}
                            title="Revogar links de acesso ativos deste entregador"
                          >
                            Revogar acesso
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <form
              onSubmit={(e) => handleAddMotoboy(e, novoMotoboyNome, novoMotoboyTelefone)}
              className={"pt-4 border-t border-koma-border space-y-3 shrink-0"}
            >
              <span className={"text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block"}>Novo entregador</span>
              <input type="text" required placeholder="Nome do entregador" value={novoMotoboyNome} onChange={(e) => setNewMotoboyNome(e.target.value)} className={"w-full px-3 py-2 bg-koma-page border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-[#10b981]"} />
              <input type="text" required placeholder="Telefone (ex: 81 99999-8888)" value={novoMotoboyTelefone} onChange={(e) => setNewMotoboyTelefone(e.target.value)} className={"w-full px-3 py-2 bg-koma-page border border-koma-border rounded-xl text-koma-foreground text-xs font-mono focus:outline-none focus:border-[#10b981]"} />
              <button type="submit" disabled={motoboysLoadState !== 'loaded'} className={"w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-colors cursor-pointer"}>
                Adicionar entregador
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
